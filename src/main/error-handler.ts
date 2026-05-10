import log from './logger'

/**
 * Wraps an IPC handler function so that any uncaught errors are logged
 * via electron-log before being re-thrown (which sends a failed IpcResponse
 * back to the renderer).
 *
 * Usage:
 * ```ts
 * ipcMain.handle(CHANNEL, wrapIpcHandler('CHANNEL_NAME', async (_event, arg) => {
 *   // handler logic
 * }))
 * ```
 */
export function wrapIpcHandler<TArgs extends unknown[], TReturn>(
  channel: string,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: TArgs) => Promise<TReturn>,
): (event: Electron.IpcMainInvokeEvent, ...args: TArgs) => Promise<TReturn> {
  return async (event, ...args) => {
    try {
      return await handler(event, ...args)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : undefined
      log.error(`[IPC] Handler "${channel}" failed: ${message}`, stack ? `\n${stack}` : '')
      throw err
    }
  }
}

export function setupErrorHandlers(): void {
  // electron-log errorHandler.startCatching() is already invoked in logger.ts
  // which handles uncaughtException and unhandledRejection globally.
  //
  // This file provides the `wrapIpcHandler` utility for logging IPC handler
  // errors with channel context — use it when registering handlers with
  // `ipcMain.handle()` for better debuggability.
  //
  // Additional custom error monitoring (e.g. crash reporting, analytics)
  // should be added here in the future.

  log.info('Error handlers ready')
}
