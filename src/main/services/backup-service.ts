import { createHash, randomUUID } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import type {
  BackupPolicy,
  BackupRecoveryCandidate,
  BackupSnapshotContent,
  BackupSnapshotInput,
  BackupSnapshotSummary,
  SaveBackupAsRequest,
} from '../../shared/attachment-backup'
import { DEFAULT_BACKUP_POLICY } from '../../shared/attachment-backup'
import type { FluxErrorCode, TextDocumentSnapshot } from '../../shared/types'
import { getBackupCacheDir } from '../paths'
import { readTextAsync } from './file-service'

interface BackupManifest {
  version: 1
  snapshots: BackupSnapshotSummary[]
}

interface BackupServiceOptions {
  rootDir?: string
  policy?: Partial<BackupPolicy>
  now?: () => number
  sourceReader?: (filePath: string) => Promise<TextDocumentSnapshot>
}

function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(tempPath, content, 'utf8')
    await fs.rename(tempPath, filePath)
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function normalizePolicy(policy: Partial<BackupPolicy>): BackupPolicy {
  return {
    maxSnapshotsPerSource: Math.max(1, Math.min(100, Math.round(policy.maxSnapshotsPerSource ?? DEFAULT_BACKUP_POLICY.maxSnapshotsPerSource))),
    maxStorageMb: Math.max(10, Math.min(10_240, Math.round(policy.maxStorageMb ?? DEFAULT_BACKUP_POLICY.maxStorageMb))),
  }
}

export class BackupService {
  private readonly rootDir: string
  private policy: BackupPolicy
  private writeQueue: Promise<void> = Promise.resolve()
  private readonly now: () => number
  private readonly sourceReader: (filePath: string) => Promise<TextDocumentSnapshot>

  constructor(options: BackupServiceOptions = {}) {
    this.rootDir = options.rootDir ?? this.resolveDefaultRoot()
    this.policy = normalizePolicy(options.policy ?? {})
    this.now = options.now ?? Date.now
    this.sourceReader = options.sourceReader ?? readTextAsync
  }

  private resolveDefaultRoot(): string {
    return getBackupCacheDir()
  }

  setPolicy(policy: Partial<BackupPolicy>): void {
    this.policy = normalizePolicy({ ...this.policy, ...policy })
  }

  private get manifestPath(): string { return path.join(this.rootDir, 'manifest.json') }
  private snapshotPath(id: string): string { return path.join(this.rootDir, 'snapshots', `${id}.txt`) }

  private async loadManifest(): Promise<BackupManifest> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.manifestPath, 'utf8')) as BackupManifest
      if (parsed.version !== 1 || !Array.isArray(parsed.snapshots)) throw new Error('Invalid manifest')
      return parsed
    } catch (error: any) {
      if (error?.code === 'ENOENT') return { version: 1, snapshots: [] }
      return { version: 1, snapshots: [] }
    }
  }

  private async saveManifest(manifest: BackupManifest): Promise<void> {
    await atomicWrite(this.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(work, work)
    this.writeQueue = result.then(() => undefined, () => undefined)
    return result
  }

  async create(input: BackupSnapshotInput): Promise<BackupSnapshotSummary> {
    return this.enqueue(async () => {
      if (!path.isAbsolute(input.sourcePath)) throw Object.assign(new Error('Invalid source path'), { code: 'INVALID_DATA' satisfies FluxErrorCode })
      await fs.mkdir(path.join(this.rootDir, 'snapshots'), { recursive: true })
      const hash = contentHash(input.content)
      const manifest = await this.loadManifest()
      const existing = manifest.snapshots.find((item) => item.sourcePath === input.sourcePath && item.contentHash === hash)
      if (existing) return existing

      const snapshot: BackupSnapshotSummary = {
        id: randomUUID(),
        sourcePath: input.sourcePath,
        createdAt: this.now(),
        contentHash: hash,
        sizeBytes: Buffer.byteLength(input.content, 'utf8'),
        sourceMtimeMs: input.sourceVersion?.mtimeMs ?? null,
        sourceSize: input.sourceVersion?.size ?? null,
        sourceVersionHash: input.sourceVersion?.contentHash ?? null,
      }
      await atomicWrite(this.snapshotPath(snapshot.id), input.content)
      manifest.snapshots.push(snapshot)
      await this.prune(manifest)
      await this.saveManifest(manifest)
      return snapshot
    })
  }

  async list(sourcePath?: string): Promise<BackupSnapshotSummary[]> {
    return this.enqueue(async () => {
      const manifest = await this.loadManifest()
      const before = manifest.snapshots.length
      await this.prune(manifest)
      if (manifest.snapshots.length !== before) await this.saveManifest(manifest)
      return manifest.snapshots.filter((item) => !sourcePath || item.sourcePath === sourcePath).sort((a, b) => b.createdAt - a.createdAt)
    })
  }

  async read(snapshotId: string): Promise<BackupSnapshotContent | null> {
    const manifest = await this.loadManifest()
    const snapshot = manifest.snapshots.find((item) => item.id === snapshotId)
    if (!snapshot) return null
    try { return { ...snapshot, content: await fs.readFile(this.snapshotPath(snapshotId), 'utf8') } } catch { return null }
  }

  async findRecoveryCandidates(sourcePath?: string): Promise<BackupRecoveryCandidate[]> {
    const snapshots = await this.list(sourcePath)
    const candidates: BackupRecoveryCandidate[] = []
    const currentBySource = new Map<string, Promise<TextDocumentSnapshot>>()
    for (const snapshot of snapshots) {
      try {
        let currentPromise = currentBySource.get(snapshot.sourcePath)
        if (!currentPromise) {
          currentPromise = this.sourceReader(snapshot.sourcePath)
          currentBySource.set(snapshot.sourcePath, currentPromise)
        }
        const current = await currentPromise
        const currentContentHash = contentHash(current.content)
        if (snapshot.contentHash === currentContentHash) continue

        const hasRecordedBaseline = typeof snapshot.sourceVersionHash === 'string' && snapshot.sourceVersionHash.length > 0
        const baselineMatches = hasRecordedBaseline && snapshot.sourceVersionHash === current.version.contentHash
        const legacySnapshotIsCurrent = !hasRecordedBaseline && snapshot.createdAt >= current.version.mtimeMs
        if (baselineMatches || legacySnapshotIsCurrent) {
          candidates.push({ ...snapshot, sourceExists: true })
        }
      } catch (error: any) {
        if (error?.code === 'ENOENT') candidates.push({ ...snapshot, sourceExists: false })
      }
    }
    return candidates
  }

  async discard(snapshotId: string): Promise<boolean> {
    return this.enqueue(async () => {
      const manifest = await this.loadManifest()
      const before = manifest.snapshots.length
      manifest.snapshots = manifest.snapshots.filter((item) => item.id !== snapshotId)
      if (manifest.snapshots.length === before) return false
      await fs.rm(this.snapshotPath(snapshotId), { force: true })
      await this.saveManifest(manifest)
      return true
    })
  }

  async discardSource(sourcePath: string): Promise<number> {
    return this.enqueue(async () => {
      const manifest = await this.loadManifest()
      const removed = manifest.snapshots.filter((item) => item.sourcePath === sourcePath)
      if (removed.length === 0) return 0
      manifest.snapshots = manifest.snapshots.filter((item) => item.sourcePath !== sourcePath)
      await Promise.all(removed.map((item) => fs.rm(this.snapshotPath(item.id), { force: true })))
      await this.saveManifest(manifest)
      return removed.length
    })
  }

  async saveAs(request: SaveBackupAsRequest): Promise<void> {
    const snapshot = await this.read(request.snapshotId)
    if (!snapshot) throw new Error('Backup snapshot not found')
    if (!path.isAbsolute(request.targetPath) || path.resolve(request.targetPath) === path.resolve(snapshot.sourcePath)) {
      throw new Error('A recovery snapshot must be saved to a different path')
    }
    await fs.mkdir(path.dirname(request.targetPath), { recursive: true })
    await atomicWrite(request.targetPath, snapshot.content)
  }

  private async prune(manifest: BackupManifest): Promise<void> {
    const remove = new Set<string>()
    const bySource = new Map<string, BackupSnapshotSummary[]>()
    for (const snapshot of manifest.snapshots) {
      const entries = bySource.get(snapshot.sourcePath) ?? []
      entries.push(snapshot)
      bySource.set(snapshot.sourcePath, entries)
    }
    for (const entries of bySource.values()) {
      entries.sort((a, b) => a.createdAt - b.createdAt)
      while (entries.length > this.policy.maxSnapshotsPerSource) remove.add(entries.shift()!.id)
    }
    let retained = manifest.snapshots.filter((item) => !remove.has(item.id)).sort((a, b) => a.createdAt - b.createdAt)
    let total = retained.reduce((sum, item) => sum + item.sizeBytes, 0)
    const limit = this.policy.maxStorageMb * 1024 * 1024
    while (total > limit && retained.length > 0) {
      const oldest = retained.shift()!
      remove.add(oldest.id)
      total -= oldest.sizeBytes
    }
    if (remove.size === 0) return
    manifest.snapshots = manifest.snapshots.filter((item) => !remove.has(item.id))
    await Promise.all([...remove].map((id) => fs.rm(this.snapshotPath(id), { force: true })))
  }
}

let defaultBackupService: BackupService | null = null

export function getBackupService(): BackupService {
  defaultBackupService ??= new BackupService()
  return defaultBackupService
}
