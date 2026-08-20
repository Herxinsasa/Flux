import type { FluxErrorCode } from './types'

export const SESSION_SCHEMA_VERSION = 1 as const
export const SESSION_HOT_MESSAGE_COUNT = 16

export interface SessionDocumentReference {
  path: string
  contentHash: string
  mtimeMs?: number
  size?: number
}

export interface StructuredSessionSummary {
  taskGoal: string | null
  confirmedFacts: string[]
  userConstraints: string[]
  documentReferences: SessionDocumentReference[]
  openQuestions: string[]
  nextSteps: string[]
}

export interface SessionCheckpoint {
  schemaVersion: typeof SESSION_SCHEMA_VERSION
  checkpointId: string
  sessionId: string
  createdAt: number
  throughSequence: number
  model: string | null
  summary: StructuredSessionSummary
  pinnedFacts: string[]
  documentReferences: SessionDocumentReference[]
  focus?: string
  source: 'initial' | 'compact' | 'automatic' | 'legacy'
}

export interface SessionMeta {
  schemaVersion: typeof SESSION_SCHEMA_VERSION
  sessionId: string
  workspaceHash: string
  workspaceRoot: string
  title: string
  model: string | null
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
  currentCheckpointId: string
  previousCheckpointId: string | null
  legacyMigration?: {
    sourcePath: string
    sourceHash: string
    migratedAt: number
  }
}

export type SessionEventKind = 'message' | 'tool' | 'document' | 'system'

export interface SessionEvent {
  schemaVersion: typeof SESSION_SCHEMA_VERSION
  sessionId: string
  sequence: number
  timestamp: number
  kind: SessionEventKind
  role?: 'user' | 'assistant' | 'tool' | 'system'
  content?: string
  model?: string | null
  documentReferences?: SessionDocumentReference[]
  data?: Record<string, unknown>
}

export interface SessionListItem {
  sessionId: string
  workspaceHash: string
  title: string
  model: string | null
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
}

export interface LoadedSession {
  meta: SessionMeta
  checkpoint: SessionCheckpoint
  events: SessionEvent[]
  recoveredTail: boolean
  checkpointRecoveredFromPrevious: boolean
}

export interface SessionUsage {
  totalBytes: number
  sessionCount: number
  workspaceCount: number
}

export interface SessionCleanupOptions {
  retentionDays?: number
  maxBytes?: number
  protectedSessionIds?: string[]
  now?: number
}

export interface SessionCleanupResult extends SessionUsage {
  removedSessionIds: string[]
  removedBytes: number
}

export interface SessionOperationError {
  code: FluxErrorCode
  message: string
}

export function emptyStructuredSessionSummary(): StructuredSessionSummary {
  return {
    taskGoal: null,
    confirmedFacts: [],
    userConstraints: [],
    documentReferences: [],
    openQuestions: [],
    nextSteps: [],
  }
}
