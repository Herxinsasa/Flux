import log from 'electron-log'
import { app } from 'electron'

// 开发/生产环境区分日志级别
const isDev = !app.isPackaged
log.transports.console.level = isDev ? 'debug' : 'warn'
log.transports.file.level = isDev ? 'debug' : 'info'

// 单文件最大 10MB，最多保留 7 个归档文件
log.transports.file.maxSize = 10 * 1024 * 1024
;(log.transports.file as unknown as Record<string, unknown>).maxFiles = 7

// 日志格式：时间 + 级别 + 进程类型 + 消息
log.transports.file.format =
  '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] [{processType}] {text}'
log.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}] [{processType}] {text}'

// 捕获未处理的异常——electron-log 内置，记录后正确退出进程
log.errorHandler.startCatching({
  showDialog: false,
  onError: ({ error }) => {
    log.error('Unhandled error:', error)
  },
})

export default log
