import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { IpcResponse } from '../../shared/types'
import type {
  ReviewExportRequest,
  ReviewExportResult,
  ReviewLoadRequest,
  ReviewLoadResult,
  ReviewSaveRequest,
  ReviewSaveResult,
} from '../../shared/review'
import { exportReviewDocument } from '../services/review-export-service'
import { loadReviewSidecar, ReviewServiceError, saveReviewSidecar } from '../services/review-service'

export function registerReviewHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.REVIEW_LOAD, async (_event, request: ReviewLoadRequest): Promise<IpcResponse<ReviewLoadResult>> => {
    try {
      return { success: true, data: loadReviewSidecar(request.sourcePath, request.sourceContent) }
    } catch (error) {
      return { success: false, code: error instanceof ReviewServiceError ? error.code : 'IO_ERROR', error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle(IPC_CHANNELS.REVIEW_SAVE, async (_event, request: ReviewSaveRequest): Promise<IpcResponse<ReviewSaveResult>> => {
    try {
      return { success: true, data: await saveReviewSidecar(request) }
    } catch (error) {
      return { success: false, code: error instanceof ReviewServiceError ? error.code : 'IO_ERROR', error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle(IPC_CHANNELS.REVIEW_EXPORT, async (_event, request: ReviewExportRequest): Promise<IpcResponse<ReviewExportResult>> => {
    try {
      return { success: true, data: await exportReviewDocument(request) }
    } catch (error) {
      return { success: false, code: 'IO_ERROR', error: error instanceof Error ? error.message : String(error) }
    }
  })
}
