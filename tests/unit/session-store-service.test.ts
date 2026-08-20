import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyStructuredSessionSummary } from '../../src/shared/session'
import { SessionStoreService } from '../../src/main/services/session-store-service'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => os.tmpdir(),
    getAppPath: () => process.cwd(),
  },
}))

const SESSION_A = 'session_A000001'
const SESSION_B = 'session_B000001'

describe('SessionStoreService', () => {
  let root: string
  let sessionsRoot: string
  let workspaceA: string
  let workspaceB: string
  let now: number
  let nextId: number
  let service: SessionStoreService

  beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'flux-session-'))
    sessionsRoot = path.join(root, 'private-sessions')
    workspaceA = path.join(root, 'workspace-a')
    workspaceB = path.join(root, 'workspace-b')
    await Promise.all([
      fs.promises.mkdir(workspaceA, { recursive: true }),
      fs.promises.mkdir(workspaceB, { recursive: true }),
    ])
    now = Date.UTC(2026, 7, 6)
    nextId = 0
    service = new SessionStoreService({
      sessionsRoot,
      now: () => now,
      idFactory: () => `generated_${String(++nextId).padStart(8, '0')}`,
    })
  })

  afterEach(async () => {
    await fs.promises.rm(root, { recursive: true, force: true })
  })

  it('isolates sessions by workspace and session id', async () => {
    await service.createSession({ workspaceRoot: workspaceA, sessionId: SESSION_A })
    await service.createSession({ workspaceRoot: workspaceA, sessionId: SESSION_B })
    await service.createSession({ workspaceRoot: workspaceB, sessionId: SESSION_A })

    await service.appendEvent({
      workspaceRoot: workspaceA,
      sessionId: SESSION_A,
      event: { kind: 'message', role: 'user', content: 'workspace A' },
    })
    await service.appendEvent({
      workspaceRoot: workspaceB,
      sessionId: SESSION_A,
      event: { kind: 'message', role: 'user', content: 'workspace B' },
    })

    expect((await service.loadSession(workspaceA, SESSION_A)).events[0]?.content).toBe('workspace A')
    expect((await service.loadSession(workspaceB, SESSION_A)).events[0]?.content).toBe('workspace B')
    expect((await service.loadSession(workspaceA, SESSION_B)).events).toEqual([])
  })

  it('serializes concurrent JSONL appends and recovers an incomplete tail', async () => {
    const created = await service.createSession({ workspaceRoot: workspaceA, sessionId: SESSION_A })
    await Promise.all(Array.from({ length: 12 }, (_, index) => service.appendEvent({
      workspaceRoot: workspaceA,
      sessionId: SESSION_A,
      event: { kind: 'message', role: 'user', content: `event-${index}` },
    })))

    const sessionDir = path.join(sessionsRoot, created.meta.workspaceHash, SESSION_A)
    await fs.promises.appendFile(path.join(sessionDir, 'events.jsonl'), '{"schemaVersion":1', 'utf8')
    const loaded = await service.loadSession(workspaceA, SESSION_A)

    expect(loaded.events.map((event) => event.sequence)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
    expect(loaded.recoveredTail).toBe(true)
  })

  it('falls back to the previous checkpoint when current is corrupt', async () => {
    const created = await service.createSession({ workspaceRoot: workspaceA, sessionId: SESSION_A })
    const checkpoint = await service.writeCheckpoint({
      workspaceRoot: workspaceA,
      sessionId: SESSION_A,
      checkpoint: {
        throughSequence: 0,
        model: 'test-model',
        summary: { ...emptyStructuredSessionSummary(), taskGoal: 'goal' },
        pinnedFacts: [],
        documentReferences: [],
        source: 'compact',
      },
    })
    const sessionDir = path.join(sessionsRoot, created.meta.workspaceHash, SESSION_A)
    await fs.promises.writeFile(
      path.join(sessionDir, 'checkpoints', `${checkpoint.checkpointId}.json`),
      '{broken',
      'utf8',
    )

    const loaded = await service.loadSession(workspaceA, SESSION_A)
    expect(loaded.checkpoint.checkpointId).toBe(created.checkpoint.checkpointId)
    expect(loaded.checkpointRecoveredFromPrevious).toBe(true)
  })

  it('does not switch meta when checkpoint persistence fails', async () => {
    const created = await service.createSession({ workspaceRoot: workspaceA, sessionId: SESSION_A })
    const checkpointDir = path.join(sessionsRoot, created.meta.workspaceHash, SESSION_A, 'checkpoints')
    await fs.promises.chmod(checkpointDir, 0o444)
    try {
      await expect(service.writeCheckpoint({
        workspaceRoot: workspaceA,
        sessionId: SESSION_A,
        checkpoint: {
          checkpointId: 'bad/checkpoint',
          throughSequence: 0,
          model: null,
          summary: emptyStructuredSessionSummary(),
          pinnedFacts: [],
          documentReferences: [],
          source: 'compact',
        },
      })).rejects.toThrow()
    } finally {
      await fs.promises.chmod(checkpointDir, 0o755)
    }

    const loaded = await service.loadSession(workspaceA, SESSION_A)
    expect(loaded.meta.currentCheckpointId).toBe(created.meta.currentCheckpointId)
  })

  it('migrates the legacy summary once and never deletes the source file', async () => {
    const legacyDir = path.join(workspaceA, '.flux')
    const legacyPath = path.join(legacyDir, 'session-summary.md')
    await fs.promises.mkdir(legacyDir, { recursive: true })
    await fs.promises.writeFile(
      legacyPath,
      '# Flux Session Context\n\n## Pinned\n- keep this\n\n## Working Summary\nlegacy goal\n',
      'utf8',
    )

    const first = await service.migrateLegacy(workspaceA)
    const second = await service.migrateLegacy(workspaceA)

    expect(first?.checkpoint.source).toBe('legacy')
    expect(first?.checkpoint.summary.taskGoal).toBe('legacy goal')
    expect(first?.checkpoint.pinnedFacts).toEqual(['keep this'])
    expect(second?.meta.sessionId).toBe(first?.meta.sessionId)
    expect(await fs.promises.readFile(legacyPath, 'utf8')).toContain('legacy goal')
    expect(await service.listSessions(workspaceA)).toHaveLength(1)
  })

  it('evicts expired and over-quota sessions without deleting a protected current session', async () => {
    await service.createSession({ workspaceRoot: workspaceA, sessionId: SESSION_A })
    now += 31 * 24 * 60 * 60 * 1000
    await service.createSession({ workspaceRoot: workspaceA, sessionId: SESSION_B })

    const result = await service.cleanup({
      retentionDays: 30,
      maxBytes: 0,
      protectedSessionIds: [SESSION_A],
      now,
    })

    expect(result.removedSessionIds).toEqual([SESSION_B])
    expect((await service.listSessions(workspaceA)).map((item) => item.sessionId)).toEqual([SESSION_A])
  })
})
