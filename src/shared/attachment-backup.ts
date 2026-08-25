import type { FileVersion } from './types'

export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export type SupportedImageMime = (typeof IMAGE_MIME_TYPES)[number]

export interface SaveImageAttachmentRequest {
  sourcePath: string
  bytes: Uint8Array
  mime: string
  alt?: string
}

export interface SaveImageAttachmentResult {
  relativePath: string
  alt: string
}

export interface BackupPolicy {
  maxSnapshotsPerSource: number
  maxStorageMb: number
}

export const DEFAULT_BACKUP_POLICY: BackupPolicy = {
  maxSnapshotsPerSource: 1,
  maxStorageMb: 500,
}

export interface BackupSnapshotInput {
  sourcePath: string
  content: string
  sourceVersion: FileVersion | null
}

export interface BackupSnapshotSummary {
  id: string
  sourcePath: string
  createdAt: number
  contentHash: string
  sizeBytes: number
  sourceMtimeMs: number | null
  sourceSize?: number | null
  sourceVersionHash?: string | null
}

export interface BackupRecoveryCandidate extends BackupSnapshotSummary {
  sourceExists: boolean
}

export interface BackupSnapshotContent extends BackupSnapshotSummary {
  content: string
}

export interface SaveBackupAsRequest {
  snapshotId: string
  targetPath: string
}
