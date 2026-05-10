import { useCallback, useState } from 'react'

interface IpcCallState<T> {
  data: T | null
  error: string | null
  loading: boolean
}

interface UseIpcCallOptions {
  /** Max wait time before rejecting with a timeout error (default 30s). */
  timeoutMs?: number
  /** Max number of retry attempts on timeout or failure (default 3). */
  retries?: number
}

/**
 * Hook that wraps IPC calls with timeout, retry, loading state, and error handling.
 *
 * Features:
 * - Configurable timeout (default 30s)
 * - Automatic retry with exponential backoff (1s, 2s, 4s, ...) up to `maxRetries`
 * - Abort support via optional `AbortSignal` passed to `call()`
 * - State tracking: `data`, `error`, `loading`
 *
 * Usage:
 * ```ts
 * const { data, error, loading, call } = useIpcCall<string>({ timeoutMs: 15000, retries: 2 })
 * const controller = new AbortController()
 * const handleClick = async () => {
 *   const content = await call(() => window.electronAPI.file.read(path), controller.signal)
 *   if (content) { ... }
 * }
 * ```
 */
export function useIpcCall<T>(options?: UseIpcCallOptions) {
  const timeoutMs = options?.timeoutMs ?? 30000
  const maxRetries = options?.retries ?? 3

  const [state, setState] = useState<IpcCallState<T>>({
    data: null,
    error: null,
    loading: false,
  })

  const call = useCallback(
    async (fn: () => Promise<T>, signal?: AbortSignal): Promise<T | null> => {
      setState({ data: null, error: null, loading: true })

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        // Check abort flag before each attempt (including the first)
        if (signal?.aborted) {
          setState({ data: null, error: 'Aborted', loading: false })
          return null
        }

        try {
          const result = await Promise.race([
            fn(),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error(`IPC call timed out after ${timeoutMs}ms`)),
                timeoutMs,
              ),
            ),
          ])

          setState({ data: result as T, error: null, loading: false })
          return result as T
        } catch (err) {
          // Last attempt — surface the error
          if (attempt === maxRetries) {
            const message = err instanceof Error ? err.message : 'Unknown IPC error'
            setState({ data: null, error: message, loading: false })
            return null
          }

          // Exponential backoff: 1s, 2s, 4s, ... (abortable)
          await new Promise<void>((resolve, reject) => {
            if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
            const id = setTimeout(resolve, 1000 * Math.pow(2, attempt))
            signal?.addEventListener('abort', () => { clearTimeout(id); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
          })
        }
      }

      return null
    },
    [timeoutMs, maxRetries],
  )

  return { ...state, call }
}
