import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { getSessionsDir } from '../paths'
import { parseSessionSummaryMarkdown } from '../../shared/session-summary'
import {
  SESSION_SCHEMA_VERSION,
  emptyStructuredSessionSummary,
  type LoadedSession,
  type SessionCheckpoint,
  type SessionCleanupOptions,
  type SessionCleanupResult,
  type SessionEvent,
  type SessionListItem,
  type SessionMeta,
  type SessionUsage,
} from '../../shared/session'
import type { FluxErrorCode } from '../../shared/types'

const DEFAULT_RETENTION_DAYS = 30
const DEFAULT_MAX_BYTES = 200 * 1024 * 1024
const SESSION_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/

export class SessionStoreError extends Error {
  constructor(
    public readonly code: FluxErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'SessionStoreError'
  }
}

interface SessionLocation {
  workspaceHash: string
  sessionId: string
  dir: string
}

interface SessionStoreOptions {
  sessionsRoot?: string
  now?: () => number
  idFactory?: () => string
}

interface CreateSessionInput {
  workspaceRoot: string
  sessionId?: string
  title?: string
  model?: string | null
}

interface AppendEventInput {
  workspaceRoot: string
  sessionId: string
  event: Omit<SessionEvent, 'schemaVersion' | 'sessionId' | 'sequence' | 'timestamp'> & {
    timestamp?: number
  }
}

interface WriteCheckpointInput {
  workspaceRoot: string
  sessionId: string
  checkpoint: Omit<SessionCheckpoint, 'schemaVersion' | 'checkpointId' | 'sessionId' | 'createdAt'> & {
    checkpointId?: string
    createdAt?: number
  }
}

interface SessionDiskEntry {
  location: SessionLocation
  meta: SessionMeta
  size: number
}

function stableWorkspaceHash(workspaceRoot: string): string {
  const normalized = path.resolve(workspaceRoot).replace(/\\/g, '/').toLowerCase()
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32)
}

function fileHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function assertAbsoluteWorkspace(workspaceRoot: string): string {
  if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot)) {
    throw new SessionStoreError('INVALID_DATA', 'Workspace root must be an absolute path')
  }
  return path.resolve(workspaceRoot)
}

function assertSessionId(sessionId: string): string {
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
    throw new SessionStoreError('INVALID_DATA', 'Invalid session id')
  }
  return sessionId
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validateMeta(value: unknown, expectedSessionId?: string): SessionMeta {
  if (!isRecord(value) || value.schemaVersion !== SESSION_SCHEMA_VERSION) {
    throw new SessionStoreError('INVALID_DATA', 'Invalid session metadata')
  }
  const sessionId = assertSessionId(String(value.sessionId ?? ''))
  if (expectedSessionId && sessionId !== expectedSessionId) {
    throw new SessionStoreError('INVALID_DATA', 'Session metadata does not match directory')
  }
  if (
    typeof value.workspaceHash !== 'string' ||
    typeof value.workspaceRoot !== 'string' ||
    typeof value.currentCheckpointId !== 'string'
  ) {
    throw new SessionStoreError('INVALID_DATA', 'Session metadata is incomplete')
  }
  return value as unknown as SessionMeta
}

function validateCheckpoint(value: unknown, sessionId: string): SessionCheckpoint {
  if (
    !isRecord(value) ||
    value.schemaVersion !== SESSION_SCHEMA_VERSION ||
    value.sessionId !== sessionId ||
    typeof value.checkpointId !== 'string' ||
    typeof value.throughSequence !== 'number' ||
    !isRecord(value.summary)
  ) {
    throw new SessionStoreError('INVALID_DATA', 'Invalid session checkpoint')
  }
  return value as unknown as SessionCheckpoint
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new SessionStoreError('NOT_FOUND', `Session file not found: ${path.basename(filePath)}`)
    }
    if (error instanceof SessionStoreError) throw error
    throw new SessionStoreError('INVALID_DATA', `Invalid session file: ${path.basename(filePath)}`)
  }
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
  const handle = await fs.promises.open(tempPath, 'wx')
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await fs.promises.rename(tempPath, filePath)
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function directorySize(dir: string): Promise<number> {
  let total = 0
  const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) total += await directorySize(entryPath)
    else if (entry.isFile()) total += (await fs.promises.stat(entryPath)).size
  }
  return total
}

export class SessionStoreService {
  private readonly sessionsRoot: string
  private readonly now: () => number
  private readonly idFactory: () => string
  private readonly writerQueues = new Map<string, Promise<unknown>>()

  constructor(options: SessionStoreOptions = {}) {
    this.sessionsRoot = path.resolve(options.sessionsRoot ?? getSessionsDir())
    this.now = options.now ?? Date.now
    this.idFactory = options.idFactory ?? crypto.randomUUID
  }

  workspaceHash(workspaceRoot: string): string {
    return stableWorkspaceHash(assertAbsoluteWorkspace(workspaceRoot))
  }

  private location(workspaceRoot: string, sessionId: string): SessionLocation {
    const safeRoot = assertAbsoluteWorkspace(workspaceRoot)
    const safeId = assertSessionId(sessionId)
    const workspaceHash = stableWorkspaceHash(safeRoot)
    return {
      workspaceHash,
      sessionId: safeId,
      dir: path.join(this.sessionsRoot, workspaceHash, safeId),
    }
  }

  private enqueue<T>(location: SessionLocation, operation: () => Promise<T>): Promise<T> {
    const key = `${location.workspaceHash}/${location.sessionId}`
    const previous = this.writerQueues.get(key) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    this.writerQueues.set(key, current)
    void current.finally(() => {
      if (this.writerQueues.get(key) === current) this.writerQueues.delete(key)
    }).catch(() => undefined)
    return current
  }

  private async readMeta(location: SessionLocation): Promise<SessionMeta> {
    return validateMeta(await readJson(path.join(location.dir, 'meta.json')), location.sessionId)
  }

  private async readEventsFile(location: SessionLocation): Promise<{
    events: SessionEvent[]
    recoveredTail: boolean
  }> {
    const eventPath = path.join(location.dir, 'events.jsonl')
    let raw: string
    try {
      raw = await fs.promises.readFile(eventPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { events: [], recoveredTail: false }
      }
      throw error
    }

    const lines = raw.split('\n')
    const events: SessionEvent[] = []
    let recoveredTail = false
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!.trim()
      if (!line) continue
      try {
        const value = JSON.parse(line) as unknown
        if (
          !isRecord(value) ||
          value.schemaVersion !== SESSION_SCHEMA_VERSION ||
          value.sessionId !== location.sessionId ||
          typeof value.sequence !== 'number' ||
          typeof value.timestamp !== 'number'
        ) {
          throw new Error('invalid event')
        }
        const expectedSequence = events.length === 0 ? 1 : events[events.length - 1]!.sequence + 1
        if (value.sequence !== expectedSequence) throw new Error('event sequence gap')
        events.push(value as unknown as SessionEvent)
      } catch {
        const isTail = index === lines.length - 1 && !raw.endsWith('\n')
        if (isTail) {
          recoveredTail = true
          break
        }
        throw new SessionStoreError('INVALID_DATA', 'Session event log is corrupted')
      }
    }
    return { events, recoveredTail }
  }

  async createSession(input: CreateSessionInput): Promise<LoadedSession> {
    const workspaceRoot = assertAbsoluteWorkspace(input.workspaceRoot)
    const sessionId = assertSessionId(input.sessionId ?? this.idFactory())
    const location = this.location(workspaceRoot, sessionId)
    return this.enqueue(location, async () => {
      if (await fs.promises.stat(location.dir).then(() => true).catch(() => false)) {
        throw new SessionStoreError('VERSION_CONFLICT', 'Session already exists')
      }
      await fs.promises.mkdir(path.join(location.dir, 'checkpoints'), { recursive: true })
      await fs.promises.writeFile(path.join(location.dir, 'events.jsonl'), '', { flag: 'wx' })
      const now = this.now()
      const checkpointId = this.idFactory()
      const checkpoint: SessionCheckpoint = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        checkpointId,
        sessionId,
        createdAt: now,
        throughSequence: 0,
        model: input.model ?? null,
        summary: emptyStructuredSessionSummary(),
        pinnedFacts: [],
        documentReferences: [],
        source: 'initial',
      }
      await atomicWriteJson(path.join(location.dir, 'checkpoints', `${checkpointId}.json`), checkpoint)
      const meta: SessionMeta = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId,
        workspaceHash: location.workspaceHash,
        workspaceRoot,
        title: input.title?.trim().slice(0, 120) || '新对话',
        model: input.model ?? null,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: now,
        currentCheckpointId: checkpointId,
        previousCheckpointId: null,
      }
      await atomicWriteJson(path.join(location.dir, 'meta.json'), meta)
      return {
        meta,
        checkpoint,
        events: [],
        recoveredTail: false,
        checkpointRecoveredFromPrevious: false,
      }
    })
  }

  async loadSession(workspaceRoot: string, sessionId: string): Promise<LoadedSession> {
    const location = this.location(workspaceRoot, sessionId)
    const meta = await this.readMeta(location)
    const eventsResult = await this.readEventsFile(location)
    const checkpointPath = (id: string) => path.join(location.dir, 'checkpoints', `${id}.json`)
    let checkpoint: SessionCheckpoint
    let recovered = false
    try {
      checkpoint = validateCheckpoint(await readJson(checkpointPath(meta.currentCheckpointId)), sessionId)
    } catch (currentError) {
      if (!meta.previousCheckpointId) throw currentError
      checkpoint = validateCheckpoint(await readJson(checkpointPath(meta.previousCheckpointId)), sessionId)
      recovered = true
    }
    return {
      meta,
      checkpoint,
      events: eventsResult.events,
      recoveredTail: eventsResult.recoveredTail,
      checkpointRecoveredFromPrevious: recovered,
    }
  }

  async appendEvent(input: AppendEventInput): Promise<SessionEvent> {
    const location = this.location(input.workspaceRoot, input.sessionId)
    return this.enqueue(location, async () => {
      await this.readMeta(location)
      const { events } = await this.readEventsFile(location)
      const event: SessionEvent = {
        ...input.event,
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: location.sessionId,
        sequence: (events[events.length - 1]?.sequence ?? 0) + 1,
        timestamp: input.event.timestamp ?? this.now(),
      }
      const serialized = `${JSON.stringify(event)}\n`
      const handle = await fs.promises.open(path.join(location.dir, 'events.jsonl'), 'a')
      try {
        await handle.writeFile(serialized, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      return event
    })
  }

  async writeCheckpoint(input: WriteCheckpointInput): Promise<SessionCheckpoint> {
    const location = this.location(input.workspaceRoot, input.sessionId)
    return this.enqueue(location, async () => {
      const meta = await this.readMeta(location)
      const checkpoint: SessionCheckpoint = {
        ...input.checkpoint,
        schemaVersion: SESSION_SCHEMA_VERSION,
        checkpointId: assertSessionId(input.checkpoint.checkpointId ?? this.idFactory()),
        sessionId: location.sessionId,
        createdAt: input.checkpoint.createdAt ?? this.now(),
      }
      const checkpointFile = path.join(location.dir, 'checkpoints', `${checkpoint.checkpointId}.json`)
      await atomicWriteJson(checkpointFile, checkpoint)
      const nextMeta: SessionMeta = {
        ...meta,
        model: checkpoint.model,
        updatedAt: checkpoint.createdAt,
        lastOpenedAt: checkpoint.createdAt,
        previousCheckpointId: meta.currentCheckpointId,
        currentCheckpointId: checkpoint.checkpointId,
      }
      await atomicWriteJson(path.join(location.dir, 'meta.json'), nextMeta)
      return checkpoint
    })
  }

  async listSessions(workspaceRoot: string): Promise<SessionListItem[]> {
    const safeRoot = assertAbsoluteWorkspace(workspaceRoot)
    const workspaceHash = stableWorkspaceHash(safeRoot)
    const workspaceDir = path.join(this.sessionsRoot, workspaceHash)
    const entries = await fs.promises.readdir(workspaceDir, { withFileTypes: true }).catch(() => [])
    const sessions: SessionListItem[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !SESSION_ID_RE.test(entry.name)) continue
      try {
        const meta = validateMeta(await readJson(path.join(workspaceDir, entry.name, 'meta.json')), entry.name)
        sessions.push({
          sessionId: meta.sessionId,
          workspaceHash: meta.workspaceHash,
          title: meta.title,
          model: meta.model,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          lastOpenedAt: meta.lastOpenedAt,
        })
      } catch {
        continue
      }
    }
    return sessions.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  }

  async deleteSession(workspaceRoot: string, sessionId: string): Promise<void> {
    const location = this.location(workspaceRoot, sessionId)
    await this.enqueue(location, async () => {
      await fs.promises.rm(location.dir, { recursive: true, force: true })
    })
  }

  private async allDiskEntries(): Promise<SessionDiskEntry[]> {
    const entries: SessionDiskEntry[] = []
    const workspaces = await fs.promises.readdir(this.sessionsRoot, { withFileTypes: true }).catch(() => [])
    for (const workspace of workspaces) {
      if (!workspace.isDirectory()) continue
      const workspaceDir = path.join(this.sessionsRoot, workspace.name)
      const sessions = await fs.promises.readdir(workspaceDir, { withFileTypes: true }).catch(() => [])
      for (const session of sessions) {
        if (!session.isDirectory() || !SESSION_ID_RE.test(session.name)) continue
        const location = { workspaceHash: workspace.name, sessionId: session.name, dir: path.join(workspaceDir, session.name) }
        try {
          const meta = validateMeta(await readJson(path.join(location.dir, 'meta.json')), session.name)
          entries.push({ location, meta, size: await directorySize(location.dir) })
        } catch {
          continue
        }
      }
    }
    return entries
  }

  async usage(): Promise<SessionUsage> {
    const entries = await this.allDiskEntries()
    return {
      totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
      sessionCount: entries.length,
      workspaceCount: new Set(entries.map((entry) => entry.location.workspaceHash)).size,
    }
  }

  async cleanup(options: SessionCleanupOptions = {}): Promise<SessionCleanupResult> {
    const retentionDays = Math.max(0, options.retentionDays ?? DEFAULT_RETENTION_DAYS)
    const maxBytes = Math.max(0, options.maxBytes ?? DEFAULT_MAX_BYTES)
    const protectedIds = new Set(options.protectedSessionIds ?? [])
    const cutoff = (options.now ?? this.now()) - retentionDays * 24 * 60 * 60 * 1000
    const entries = (await this.allDiskEntries()).sort((a, b) => a.meta.lastOpenedAt - b.meta.lastOpenedAt)
    let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0)
    let removedBytes = 0
    const removedSessionIds: string[] = []
    const removed = new Set<string>()

    const remove = async (entry: SessionDiskEntry) => {
      if (protectedIds.has(entry.meta.sessionId) || removed.has(entry.location.dir)) return
      await fs.promises.rm(entry.location.dir, { recursive: true, force: true })
      removed.add(entry.location.dir)
      removedSessionIds.push(entry.meta.sessionId)
      removedBytes += entry.size
      totalBytes -= entry.size
    }

    for (const entry of entries) {
      if (entry.meta.lastOpenedAt < cutoff) await remove(entry)
    }
    for (const entry of entries) {
      if (totalBytes <= maxBytes) break
      await remove(entry)
    }

    const remaining = entries.filter((entry) => !removed.has(entry.location.dir))
    return {
      totalBytes,
      sessionCount: remaining.length,
      workspaceCount: new Set(remaining.map((entry) => entry.location.workspaceHash)).size,
      removedSessionIds,
      removedBytes,
    }
  }

  async clearAll(protectedSessionIds: string[] = []): Promise<SessionCleanupResult> {
    return this.cleanup({ retentionDays: 0, maxBytes: 0, protectedSessionIds, now: this.now() + 1 })
  }

  async migrateLegacy(workspaceRoot: string, targetSessionId?: string): Promise<LoadedSession | null> {
    const safeRoot = assertAbsoluteWorkspace(workspaceRoot)
    const legacyPath = path.join(safeRoot, '.flux', 'session-summary.md')
    let raw: string
    try {
      raw = await fs.promises.readFile(legacyPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }

    const sourceHash = fileHash(raw)
    const sessions = await this.listSessions(safeRoot)
    for (const item of sessions) {
      const loaded = await this.loadSession(safeRoot, item.sessionId)
      if (loaded.meta.legacyMigration?.sourceHash === sourceHash) return loaded
    }

    const loaded = targetSessionId
      ? await this.loadSession(safeRoot, targetSessionId)
      : await this.createSession({ workspaceRoot: safeRoot, title: '旧版上下文' })
    const parsed = parseSessionSummaryMarkdown(raw)
    const checkpoint = await this.writeCheckpoint({
      workspaceRoot: safeRoot,
      sessionId: loaded.meta.sessionId,
      checkpoint: {
        throughSequence: loaded.events[loaded.events.length - 1]?.sequence ?? 0,
        model: loaded.meta.model,
        summary: {
          ...emptyStructuredSessionSummary(),
          taskGoal: parsed.workingSummary?.trim() || null,
          confirmedFacts: parsed.pinnedFacts,
        },
        pinnedFacts: parsed.pinnedFacts,
        documentReferences: [],
        source: 'legacy',
      },
    })
    const location = this.location(safeRoot, loaded.meta.sessionId)
    await this.enqueue(location, async () => {
      const meta = await this.readMeta(location)
      await atomicWriteJson(path.join(location.dir, 'meta.json'), {
        ...meta,
        legacyMigration: {
          sourcePath: legacyPath,
          sourceHash,
          migratedAt: this.now(),
        },
      } satisfies SessionMeta)
    })
    return this.loadSession(safeRoot, checkpoint.sessionId)
  }
}

let defaultSessionStore: SessionStoreService | null = null

export function getSessionStore(): SessionStoreService {
  defaultSessionStore ??= new SessionStoreService()
  return defaultSessionStore
}
