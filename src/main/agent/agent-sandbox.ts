import type { StreamEvent } from './provider-router'
import log from '../logger'

// ----------------------------------------------------------------- Types

export type AgentProcessStatus = 'idle' | 'running' | 'restarting' | 'error'

export interface AgentProcessOptions {
  /** Max crash-restart retries, default 3 */
  maxRetries?: number
  /** Timeout before forced abort, default 5 minutes */
  timeout?: number
}

// ----------------------------------------------------------------- AgentProcessManager

/**
 * Wraps agent execution with timeout, crash-retry, and status tracking.
 *
 * Instead of spawning a real child process, this uses AbortController +
 * setTimeout for isolation. Every execution attempt gets its own abort
 * controller — timeout or crash triggers abort, then a fresh retry.
 *
 * After maxRetries consecutive failures, the manager stops retrying and
 * emits `error` status.
 */
export class AgentProcessManager {
  private abortController: AbortController | null = null
  private timeoutId: ReturnType<typeof setTimeout> | undefined
  private retryCount = 0
  private readonly maxRetries: number
  private readonly timeout: number
  private isRunning = false

  constructor(options?: AgentProcessOptions) {
    this.maxRetries = options?.maxRetries ?? 3
    this.timeout = options?.timeout ?? 5 * 60 * 1000 // 5 min
  }

  /**
   * Run the agent task with retry + timeout isolation.
   *
   * @param task     Factory that creates an async generator from an AbortSignal.
   * @param onEvent  Called for every StreamEvent yielded by the generator.
   * @param onStatus Called whenever the process status changes.
   */
  async run(
    task: (signal: AbortSignal) => AsyncGenerator<StreamEvent>,
    onEvent: (event: StreamEvent) => void,
    onStatusChange: (status: AgentProcessStatus) => void,
  ): Promise<void> {
    if (this.isRunning) {
      throw new Error('Agent is already running. Cancel the current run first.')
    }

    this.isRunning = true
    this.retryCount = 0

    try {
      while (this.retryCount <= this.maxRetries) {
        const isRetry = this.retryCount > 0
        onStatusChange(isRetry ? 'restarting' : 'running')

        // Fresh abort controller per attempt
        this.abortController = new AbortController()
        const signal = this.abortController.signal

        // Arm timeout
        this.timeoutId = setTimeout(() => {
          log.warn(
            `Agent timeout after ${this.timeout / 1000}s (attempt ${this.retryCount + 1}), aborting`,
          )
          this.abortController?.abort()
        }, this.timeout)

        try {
          const generator = task(signal)

          for await (const evt of generator) {
            if (signal.aborted) break

            onEvent(evt)

            // Error events bubble up as thrown errors so they trigger retry
            if (evt.type === 'error') {
              throw new Error(evt.message)
            }
          }

          // Success — generator exhausted normally
          clearTimeout(this.timeoutId)
          this.timeoutId = undefined
          this.retryCount = 0
          onStatusChange('idle')
          return
        } catch (err) {
          clearTimeout(this.timeoutId)
          this.timeoutId = undefined

          this.retryCount++
          log.warn(
            `Agent attempt ${this.retryCount}/${this.maxRetries} failed: ${err instanceof Error ? err.message : String(err)}`,
          )

          if (this.retryCount > this.maxRetries) {
            log.error('Agent max retries exceeded, stopping')
            onStatusChange('error')

            const message =
              err instanceof Error ? err.message : String(err)
            onEvent({
              type: 'error',
              message: `Agent failed after ${this.maxRetries} retries: ${message}`,
            })
            return
          }

          // Loop continues → next iteration emits 'restarting' and retries
        }
      }
    } finally {
      this.isRunning = false
      this.abortController = null
      this.timeoutId = undefined
    }
  }

  /**
   * Cancel the currently-running agent task.
   * Aborts the active controller, which causes the generator loop to
   * break. The run() promise resolves after cleanup sets status to 'idle'.
   */
  cancel(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
      this.timeoutId = undefined
    }
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }
}
