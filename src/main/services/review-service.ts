import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { FileVersion, FluxErrorCode } from '../../shared/types'
import {
  REVIEW_SCHEMA_VERSION,
  createEmptyReviewSidecar,
  reanchorReviewSidecar,
  sortReviewComments,
  type ReviewComment,
  type ReviewReply,
  type ReviewLoadResult,
  type ReviewSaveRequest,
  type ReviewSaveResult,
  type ReviewSidecar,
} from '../../shared/review'

export class ReviewServiceError extends Error {
  constructor(message: string, readonly code: FluxErrorCode) {
    super(message)
    this.name = 'ReviewServiceError'
  }
}

const reviewWriteQueues = new Map<string, Promise<void>>()

const REVIEW_LOCK_STALE_MS = 30_000
const REVIEW_LOCK_RETRY_MS = 25
const REVIEW_LOCK_ATTEMPTS = 100

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function withCrossProcessReviewLock<T>(sidecarPath: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${sidecarPath}.lock`
  const lockToken = crypto.randomBytes(16).toString('hex')
  const lockContent = `${process.pid}\n${lockToken}\n`
  let handle: fs.promises.FileHandle | null = null
  for (let attempt = 0; attempt < REVIEW_LOCK_ATTEMPTS; attempt += 1) {
    try {
      handle = await fs.promises.open(lockPath, 'wx')
      await handle.writeFile(lockContent, 'utf8')
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = await fs.promises.readFile(lockPath, 'utf8').catch(() => '')
      const ownerPid = Number(existing.split(/\r?\n/, 1)[0])
      const stat = await fs.promises.stat(lockPath).catch(() => null)
      const malformedAndStale = !Number.isInteger(ownerPid) && stat && Date.now() - stat.mtimeMs > REVIEW_LOCK_STALE_MS
      if ((!isProcessAlive(ownerPid) && Number.isInteger(ownerPid)) || malformedAndStale) {
        await fs.promises.unlink(lockPath).catch(() => undefined)
        continue
      }
      await new Promise((resolve) => setTimeout(resolve, REVIEW_LOCK_RETRY_MS))
    }
  }
  if (!handle) throw new ReviewServiceError('批注文件正被另一个进程写入，请稍后重试', 'VERSION_CONFLICT')
  try {
    return await operation()
  } finally {
    await handle.close().catch(() => undefined)
    const currentContent = await fs.promises.readFile(lockPath, 'utf8').catch(() => '')
    if (currentContent === lockContent) await fs.promises.unlink(lockPath).catch(() => undefined)
  }
}

async function withReviewWriteLock<T>(sidecarPath: string, operation: () => Promise<T>): Promise<T> {
  const previous = reviewWriteQueues.get(sidecarPath) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const queued = previous.then(() => gate)
  reviewWriteQueues.set(sidecarPath, queued)
  await previous
  try {
    return await withCrossProcessReviewLock(sidecarPath, operation)
  } finally {
    release()
    if (reviewWriteQueues.get(sidecarPath) === queued) reviewWriteQueues.delete(sidecarPath)
  }
}

export function getReviewSidecarPath(sourcePath: string): string {
  return `${sourcePath}.review.json`
}

function hashBuffer(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function getVersion(filePath: string): FileVersion {
  const content = fs.readFileSync(filePath)
  const stat = fs.statSync(filePath)
  return { mtimeMs: stat.mtimeMs, size: stat.size, contentHash: hashBuffer(content) }
}

function sameVersion(left: FileVersion, right: FileVersion): boolean {
  return left.mtimeMs === right.mtimeMs && left.size === right.size && left.contentHash === right.contentHash
}

function assertAbsoluteSourcePath(sourcePath: string): void {
  if (!path.isAbsolute(sourcePath)) throw new ReviewServiceError('源文件路径必须为绝对路径', 'INVALID_DATA')
}

function sameSourcePath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
}

function samePortableSource(left: string, right: string): boolean {
  return sameSourcePath(left, right) || path.basename(left).toLowerCase() === path.basename(right).toLowerCase()
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isReviewReply(value: unknown): value is ReviewReply {
  if (!value || typeof value !== 'object') return false
  const reply = value as Partial<ReviewReply>
  return typeof reply.id === 'string' && reply.id.length > 0 &&
    typeof reply.body === 'string' && reply.body.trim().length > 0 && reply.body.length <= 100_000 &&
    (reply.role === 'reviewer' || reply.role === 'modifier') &&
    isIsoDate(reply.createdAt)
}

function isReviewComment(value: unknown): value is ReviewComment {
  if (!value || typeof value !== 'object') return false
  const comment = value as Partial<ReviewComment>
  const anchor = comment.anchor
  return typeof comment.id === 'string' && comment.id.length > 0 &&
    typeof comment.body === 'string' && comment.body.trim().length > 0 && comment.body.length <= 100_000 &&
    (comment.author === 'user' || comment.author === 'ai') &&
    (comment.status === 'open' || comment.status === 'resolved') &&
    (comment.anchorStatus === 'valid' || comment.anchorStatus === 'relocated' || comment.anchorStatus === 'orphaned') &&
    isIsoDate(comment.createdAt) && isIsoDate(comment.updatedAt) &&
    !!anchor && Number.isInteger(anchor.start) && Number.isInteger(anchor.end) &&
    anchor.start >= 0 && anchor.end > anchor.start &&
    typeof anchor.quote === 'string' && anchor.quote.length > 0 && typeof anchor.prefix === 'string' &&
    typeof anchor.suffix === 'string' && typeof anchor.sourceHash === 'string' &&
    (comment.replies === undefined || (Array.isArray(comment.replies) && comment.replies.length <= 1_000 &&
      comment.replies.every(isReviewReply) && new Set(comment.replies.map((reply) => reply.id)).size === comment.replies.length))
}

export function parseReviewSidecar(raw: string, expectedSourcePath: string): ReviewSidecar {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new ReviewServiceError('批注侧车 JSON 已损坏', 'INVALID_DATA')
  }
  if (!value || typeof value !== 'object') throw new ReviewServiceError('批注侧车结构无效', 'INVALID_DATA')
  const sidecar = value as Partial<ReviewSidecar>
  if (sidecar.schemaVersion !== REVIEW_SCHEMA_VERSION ||
      typeof sidecar.sourcePath !== 'string' || !samePortableSource(sidecar.sourcePath, expectedSourcePath) ||
      typeof sidecar.sourceHash !== 'string' || !Array.isArray(sidecar.comments) ||
      sidecar.comments.length > 5_000 || !sidecar.comments.every(isReviewComment) ||
      new Set(sidecar.comments.map((comment) => comment.id)).size !== sidecar.comments.length ||
      !isIsoDate(sidecar.updatedAt)) {
    throw new ReviewServiceError('批注侧车结构无效或版本不受支持', 'INVALID_DATA')
  }
  return { ...(sidecar as ReviewSidecar), sourcePath: expectedSourcePath }
}

export function stableReviewSidecar(sidecar: ReviewSidecar): ReviewSidecar {
  return {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    sourcePath: sidecar.sourcePath,
    sourceHash: sidecar.sourceHash,
    comments: sortReviewComments(sidecar.comments).map((comment) => ({
      id: comment.id,
      anchor: {
        start: comment.anchor.start,
        end: comment.anchor.end,
        quote: comment.anchor.quote,
        prefix: comment.anchor.prefix,
        suffix: comment.anchor.suffix,
        sourceHash: comment.anchor.sourceHash,
      },
      body: comment.body,
      author: comment.author,
      status: comment.status,
      anchorStatus: comment.anchorStatus,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      replies: (comment.replies ?? []).map((reply) => ({
        id: reply.id,
        body: reply.body,
        role: reply.role,
        createdAt: reply.createdAt,
      })),
    })),
    updatedAt: sidecar.updatedAt,
  }
}

export function serializeReviewSidecar(sidecar: ReviewSidecar): string {
  return `${JSON.stringify(stableReviewSidecar(sidecar), null, 2)}\n`
}

export function loadReviewSidecar(sourcePath: string, sourceContent: string): ReviewLoadResult {
  assertAbsoluteSourcePath(sourcePath)
  const sidecarPath = getReviewSidecarPath(sourcePath)
  if (!fs.existsSync(sidecarPath)) {
    return { sidecar: createEmptyReviewSidecar(sourcePath, sourceContent), sidecarVersion: null, readOnly: false }
  }
  const version = getVersion(sidecarPath)
  try {
    const sidecar = parseReviewSidecar(fs.readFileSync(sidecarPath, 'utf8'), sourcePath)
    return { sidecar: reanchorReviewSidecar(sidecar, sourceContent), sidecarVersion: version, readOnly: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      sidecar: createEmptyReviewSidecar(sourcePath, sourceContent),
      sidecarVersion: version,
      readOnly: true,
      errorCode: 'INVALID_DATA',
      error: `${message}。原文件已保留，请先修复或备份该侧车文件。`,
    }
  }
}

async function assertExpectedVersion(sidecarPath: string, expected: FileVersion | null): Promise<void> {
  const exists = fs.existsSync(sidecarPath)
  if (!expected) {
    if (exists) throw new ReviewServiceError('批注已被其他进程修改，请重新加载', 'VERSION_CONFLICT')
    return
  }
  if (!exists || !sameVersion(getVersion(sidecarPath), expected)) {
    throw new ReviewServiceError('批注已被其他进程修改，请重新加载', 'VERSION_CONFLICT')
  }
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  let handle: fs.promises.FileHandle | null = null
  try {
    handle = await fs.promises.open(tempPath, 'wx')
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await fs.promises.rename(tempPath, filePath)
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined)
    await fs.promises.unlink(tempPath).catch(() => undefined)
    throw error
  }
}

export async function saveReviewSidecar(request: ReviewSaveRequest): Promise<ReviewSaveResult> {
  const { sidecar, sourceContent, expectedVersion } = request
  assertAbsoluteSourcePath(sidecar.sourcePath)
  const sidecarPath = getReviewSidecarPath(sidecar.sourcePath)
  return withReviewWriteLock(sidecarPath, async () => {
    if (fs.existsSync(sidecarPath)) parseReviewSidecar(fs.readFileSync(sidecarPath, 'utf8'), sidecar.sourcePath)
    await assertExpectedVersion(sidecarPath, expectedVersion)

    if (sidecar.comments.length === 0) {
      if (fs.existsSync(sidecarPath)) await fs.promises.unlink(sidecarPath)
      return { sidecar: createEmptyReviewSidecar(sidecar.sourcePath, sourceContent), sidecarVersion: null }
    }

    const now = new Date().toISOString()
    const normalized = stableReviewSidecar(reanchorReviewSidecar({
      ...sidecar,
      schemaVersion: REVIEW_SCHEMA_VERSION,
      updatedAt: now,
    }, sourceContent))
    parseReviewSidecar(serializeReviewSidecar(normalized), sidecar.sourcePath)
    await atomicWrite(sidecarPath, serializeReviewSidecar(normalized))
    return { sidecar: normalized, sidecarVersion: getVersion(sidecarPath) }
  })
}
