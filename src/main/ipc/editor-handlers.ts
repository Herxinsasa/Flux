import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { createHash } from 'crypto'
import { dirname, resolve } from 'path'
import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import log from '../logger'

/* ------------------------------------------------------------------ */
/*  Pending change store (in-memory)                                    */
/* ------------------------------------------------------------------ */

interface FileChange {
  id: string
  filePath: string
  newContent: string
  originalContent?: string
  mode: 'full' | 'edits'
  edits?: LineEdit[]
  transactionId: string
  createdAt: number
  originalHash: string
  originalMtimeMs: number | null
}

const pendingChanges = new Map<string, FileChange>()

interface AppliedJournalItem {
  filePath: string
  previousContent?: string
  existedBefore: boolean
}

const appliedJournal = new Map<string, AppliedJournalItem[]>()

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface PreviewChangePayload {
  changeId: string
  filePath: string
  newContent?: string
  edits?: LineEdit[]
  transactionId?: string
}

interface LineEdit {
  startLine: number
  endLine: number
  newText: string
}

interface PreviewDiffBlock {
  startLine: number
  endLine: number
  oldText: string
  newText: string
}

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function readFileSnapshot(filePath: string): {
  exists: boolean
  content?: string
  hash: string
  mtimeMs: number | null
} {
  try {
    const content = readFileSync(filePath, 'utf-8')
    const stat = statSync(filePath)
    return {
      exists: true,
      content,
      hash: hashContent(content),
      mtimeMs: stat.mtimeMs,
    }
  } catch {
    return {
      exists: false,
      hash: hashContent(''),
      mtimeMs: null,
    }
  }
}

function normalizeLineEdits(raw: PreviewChangePayload['edits']): LineEdit[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((e) => ({
      startLine: Number(e.startLine),
      endLine: Number(e.endLine),
      newText: typeof e.newText === 'string' ? e.newText : '',
    }))
    .filter((e) => Number.isFinite(e.startLine) && Number.isFinite(e.endLine))
    .map((e) => ({
      startLine: Math.max(1, Math.floor(e.startLine)),
      endLine: Math.max(1, Math.floor(e.endLine)),
      newText: e.newText,
    }))
}

function applyLineEditsToContent(original: string, edits: LineEdit[]): string {
  if (edits.length === 0) return original

  const lines = original.split('\n')
  const sorted = [...edits].sort((a, b) => b.startLine - a.startLine)

  for (const edit of sorted) {
    const startIdx = Math.max(0, Math.min(lines.length, edit.startLine - 1))
    const endIdxInclusive = Math.max(edit.startLine, edit.endLine)
    const endExclusive = Math.max(startIdx, Math.min(lines.length, endIdxInclusive))
    const replacement = edit.newText === '' ? [] : edit.newText.split('\n')
    lines.splice(startIdx, endExclusive - startIdx, ...replacement)
  }

  return lines.join('\n')
}

function buildPreviewDiffBlocks(original: string, edits: LineEdit[]): PreviewDiffBlock[] {
  if (edits.length === 0) return []
  const lines = original.split('\n')

  return edits.map((edit) => {
    const startIdx = Math.max(0, Math.min(lines.length, edit.startLine - 1))
    const endIdxInclusive = Math.max(edit.startLine, edit.endLine)
    const endExclusive = Math.max(startIdx, Math.min(lines.length, endIdxInclusive))
    const oldText = lines.slice(startIdx, endExclusive).join('\n')
    return {
      startLine: edit.startLine,
      endLine: edit.endLine,
      oldText,
      newText: edit.newText,
    }
  })
}

function writeFileAtomically(filePath: string, content: string): void {
  const normalized = resolve(filePath)
  const dir = dirname(normalized)
  mkdirSync(dir, { recursive: true })

  const tmpPath = `${normalized}.flux-tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmpPath, content, 'utf-8')
  try {
    renameSync(tmpPath, normalized)
  } catch (err) {
    try {
      unlinkSync(tmpPath)
    } catch {
      // ignore cleanup error
    }
    throw err
  }
}

function pushAppliedJournal(transactionId: string, item: AppliedJournalItem): void {
  const list = appliedJournal.get(transactionId) ?? []
  list.push(item)
  appliedJournal.set(transactionId, list)
}

function rollbackTransaction(transactionId: string): void {
  const list = appliedJournal.get(transactionId)
  if (!list || list.length === 0) return

  for (let i = list.length - 1; i >= 0; i--) {
    const entry = list[i]
    if (entry.existedBefore) {
      writeFileAtomically(entry.filePath, entry.previousContent ?? '')
    }
  }
  appliedJournal.delete(transactionId)
}

function computeChangedLineRange(beforeText: string, afterText: string): {
  startLine: number
  endLine: number
  changed: boolean
} {
  if (beforeText === afterText) {
    return { startLine: 1, endLine: 1, changed: false }
  }

  const before = beforeText.split('\n')
  const after = afterText.split('\n')

  let prefix = 0
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  ) {
    prefix++
  }

  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++
  }

  const startLine = prefix + 1
  const endLine = Math.max(startLine, after.length - suffix)
  return { startLine, endLine, changed: true }
}

export function registerEditorHandlers(): void {
  const {
    EDITOR_JUMP_TO_LINE,
    EDITOR_PREVIEW_CHANGE,
    EDITOR_APPLY_CHANGE,
    EDITOR_REJECT_CHANGE,
    EDITOR_CHANGE_APPLIED,
    EDITOR_APPLY_TRANSACTION,
    EDITOR_REJECT_TRANSACTION,
  } = IPC_CHANNELS

  /* ── Jump to line ─────────────────────────────────────────────── */

  ipcMain.handle(EDITOR_JUMP_TO_LINE, async (_event, line: number, filePath?: string) => {
    log.info(`editor:jump-to-line line=${line} file=${filePath ?? 'current'}`)
    // The actual jump is handled renderer-side via editorStore.
    // This handler exists for main-process-initiated jumps in the future.
    return { success: true }
  })

  /* ── Preview change (AI-generated file edit) ──────────────────── */

  ipcMain.handle(EDITOR_PREVIEW_CHANGE, async (_event, payload: PreviewChangePayload) => {
    try {
      log.info(`editor:preview-change id=${payload.changeId} file=${payload.filePath}`)

      const normalizedPath = resolve(payload.filePath)
      const snap = readFileSnapshot(normalizedPath)
      const edits = normalizeLineEdits(payload.edits)
      const mode: FileChange['mode'] = edits.length > 0 ? 'edits' : 'full'
      const newContent =
        mode === 'edits'
          ? applyLineEditsToContent(snap.content ?? '', edits)
          : (payload.newContent ?? '')

      const transactionId =
        typeof payload.transactionId === 'string' && payload.transactionId.trim().length > 0
          ? payload.transactionId.trim()
          : payload.changeId

      const lineRange = computeChangedLineRange(snap.content ?? '', newContent)
      const diffBlocks = buildPreviewDiffBlocks(snap.content ?? '', edits)

      const totalEditedLines = diffBlocks.reduce((acc, b) => {
        if (!b.oldText) return acc
        return acc + b.oldText.split('\n').length
      }, 0)

      const addedLines = diffBlocks.reduce((acc, b) => {
        if (!b.newText) return acc
        return acc + b.newText.split('\n').length
      }, 0)

      const deletedLines = diffBlocks.reduce((acc, b) => {
        if (!b.oldText) return acc
        return acc + b.oldText.split('\n').length
      }, 0)

      pendingChanges.set(payload.changeId, {
        id: payload.changeId,
        filePath: normalizedPath,
        newContent,
        originalContent: snap.content,
        mode,
        edits: edits.length > 0 ? edits : undefined,
        transactionId,
        createdAt: Date.now(),
        originalHash: snap.hash,
        originalMtimeMs: snap.mtimeMs,
      })

      return {
        success: true,
        data: {
          changeId: payload.changeId,
          transactionId,
          filePath: normalizedPath,
          mode,
          editsCount: edits.length,
          editedLineCount: totalEditedLines,
          changed: lineRange.changed,
          startLine: lineRange.startLine,
          endLine: lineRange.endLine,
          content: newContent,
          baseHash: snap.hash,
          baseMtimeMs: snap.mtimeMs,
          bytesBefore: (snap.content ?? '').length,
          bytesAfter: newContent.length,
          addedLines,
          deletedLines,
          diffBlocks,
        },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('editor:preview-change error:', message)
      return { success: false, error: message }
    }
  })

  /* ── Apply change (confirm preview) ───────────────────────────── */

  ipcMain.handle(EDITOR_APPLY_CHANGE, async (event, changeId: string) => {
    try {
      const change = pendingChanges.get(changeId)
      if (!change) {
        return { success: false, error: `Change not found: ${changeId}` }
      }

      log.info(`editor:apply-change id=${changeId} file=${change.filePath}`)

      const applyStartedAt = Date.now()
      const currentSnap = readFileSnapshot(change.filePath)

      if (currentSnap.hash !== change.originalHash) {
        return {
          success: false,
          error:
            'File changed since preview was created. Please regenerate edits on latest content.',
        }
      }

      const existedBefore = currentSnap.exists
      const previousContent = currentSnap.content

      // Atomic write to avoid partially-written files.
      writeFileAtomically(change.filePath, change.newContent)

      pushAppliedJournal(change.transactionId, {
        filePath: change.filePath,
        previousContent,
        existedBefore,
      })

      const lineRange = computeChangedLineRange(
        change.originalContent ?? '',
        change.newContent,
      )

      // Notify renderer to reload the file
      const senderWindow = BrowserWindow.fromWebContents(event.sender)
      senderWindow?.webContents.send(EDITOR_CHANGE_APPLIED, {
        changeId,
        transactionId: change.transactionId,
        filePath: change.filePath,
        content: change.newContent,
        startLine: lineRange.startLine,
        endLine: lineRange.endLine,
        changed: lineRange.changed,
      })

      pendingChanges.delete(changeId)
      appliedJournal.delete(change.transactionId)

      log.info('editor:apply-change done', {
        changeId,
        transactionId: change.transactionId,
        mode: change.mode,
        editsCount: change.edits?.length ?? 0,
        durationMs: Date.now() - applyStartedAt,
        bytesAfter: change.newContent.length,
      })

      return {
        success: true,
        data: {
          changeId,
          transactionId: change.transactionId,
          filePath: change.filePath,
          content: change.newContent,
          startLine: lineRange.startLine,
          endLine: lineRange.endLine,
          changed: lineRange.changed,
          mode: change.mode,
          editsCount: change.edits?.length ?? 0,
        },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('editor:apply-change error:', message)
      return { success: false, error: message }
    }
  })

  /* ── Reject change ────────────────────────────────────────────── */

  ipcMain.handle(EDITOR_REJECT_CHANGE, async (_event, changeId: string) => {
    log.info(`editor:reject-change id=${changeId}`)
    const existing = pendingChanges.get(changeId)
    pendingChanges.delete(changeId)
    return {
      success: true,
      data: {
        changeId,
        transactionId: existing?.transactionId ?? changeId,
      },
    }
  })

  ipcMain.handle(EDITOR_APPLY_TRANSACTION, async (event, transactionId: string) => {
    const changes = [...pendingChanges.values()]
      .filter((c) => c.transactionId === transactionId)
      .sort((a, b) => a.createdAt - b.createdAt)

    if (changes.length === 0) {
      return { success: false, error: `Transaction not found: ${transactionId}` }
    }

    const results: Array<{ changeId: string; filePath: string }> = []
    try {
      for (const change of changes) {
        const currentSnap = readFileSnapshot(change.filePath)
        if (currentSnap.hash !== change.originalHash) {
          throw new Error(`Conflict at ${change.filePath}: file changed since preview.`)
        }

        writeFileAtomically(change.filePath, change.newContent)
        pushAppliedJournal(transactionId, {
          filePath: change.filePath,
          previousContent: currentSnap.content,
          existedBefore: currentSnap.exists,
        })

        const lineRange = computeChangedLineRange(change.originalContent ?? '', change.newContent)

        const senderWindow = BrowserWindow.fromWebContents(event.sender)
        senderWindow?.webContents.send(EDITOR_CHANGE_APPLIED, {
          changeId: change.id,
          transactionId,
          filePath: change.filePath,
          content: change.newContent,
          startLine: lineRange.startLine,
          endLine: lineRange.endLine,
          changed: lineRange.changed,
        })

        pendingChanges.delete(change.id)
        results.push({ changeId: change.id, filePath: change.filePath })
      }

      appliedJournal.delete(transactionId)
      return { success: true, data: { transactionId, applied: results } }
    } catch (err) {
      rollbackTransaction(transactionId)
      const message = err instanceof Error ? err.message : String(err)
      log.error('editor:apply-transaction error:', message)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(EDITOR_REJECT_TRANSACTION, async (_event, transactionId: string) => {
    const removed: string[] = []
    for (const [id, change] of pendingChanges.entries()) {
      if (change.transactionId === transactionId) {
        removed.push(id)
        pendingChanges.delete(id)
      }
    }
    return {
      success: true,
      data: {
        transactionId,
        removed,
      },
    }
  })
}
