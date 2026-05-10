// Renderer process logging via electron-log
// electron-log in the renderer process automatically forwards logs
// to the main process via IPC, which writes them to disk.
import log from 'electron-log'

// Renderer-specific log format
log.transports.console.format = '[{h}:{i}:{s}.{ms}] [renderer] [{level}] {text}'

export const logger = {
  error: (message: string, ...args: unknown[]) => log.error(message, ...args),
  warn: (message: string, ...args: unknown[]) => log.warn(message, ...args),
  info: (message: string, ...args: unknown[]) => log.info(message, ...args),
  debug: (message: string, ...args: unknown[]) => log.debug(message, ...args),
}
