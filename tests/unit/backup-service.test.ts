import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BackupService } from '../../src/main/services/backup-service'
import { createHash } from 'crypto'

const roots: string[] = []
async function setup(policy = {}) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-backup-')); roots.push(root); return { root, service: new BackupService({ rootDir: root, policy }) } }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))) })
const version = { mtimeMs: 1, size: 1, contentHash: 'disk' }

async function fileVersion(filePath: string) {
  const [stat, bytes] = await Promise.all([fs.stat(filePath), fs.readFile(filePath)])
  return { mtimeMs: stat.mtimeMs, size: stat.size, contentHash: createHash('sha256').update(bytes).digest('hex') }
}

describe('BackupService', () => {
  it('deduplicates identical content and retains the per-source cap', async () => {
    const { root, service } = await setup({ maxSnapshotsPerSource: 2 }); const source = path.join(root, 'a.md'); await fs.writeFile(source, 'disk')
    const first = await service.create({ sourcePath: source, content: 'same', sourceVersion: version }); const again = await service.create({ sourcePath: source, content: 'same', sourceVersion: version })
    expect(again.id).toBe(first.id)
    await service.create({ sourcePath: source, content: 'two', sourceVersion: version }); await service.create({ sourcePath: source, content: 'three', sourceVersion: version })
    expect(await service.list(source)).toHaveLength(2)
  })
  it('returns only snapshots newer than their source and refuses overwrite recovery', async () => {
    const fixedNow = 1_700_000_000_000
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-backup-')); roots.push(root)
    const service = new BackupService({ rootDir: root, now: () => fixedNow })
    const source = path.join(root, 'a.md'); await fs.writeFile(source, 'disk'); await fs.utimes(source, fixedNow / 1000, fixedNow / 1000)
    const snapshot = await service.create({ sourcePath: source, content: 'draft', sourceVersion: await fileVersion(source) })
    const candidates = await service.findRecoveryCandidates(source); expect(candidates.map((item) => item.id)).toContain(snapshot.id)
    await expect(service.saveAs({ snapshotId: snapshot.id, targetPath: source })).rejects.toThrow('different path')
    const target = path.join(root, 'restored.md'); await service.saveAs({ snapshotId: snapshot.id, targetPath: target }); await expect(fs.readFile(target, 'utf8')).resolves.toBe('draft')
  })

  it('keeps a dirty snapshot recoverable when the source changed at the same filesystem timestamp', async () => {
    const fixedNow = 1_700_000_100_000
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-backup-')); roots.push(root)
    const service = new BackupService({ rootDir: root, now: () => fixedNow })
    const source = path.join(root, 'a.md'); await fs.writeFile(source, 'baseline'); await fs.utimes(source, fixedNow / 1000, fixedNow / 1000)
    const snapshot = await service.create({ sourcePath: source, content: 'unsaved draft', sourceVersion: await fileVersion(source) })
    await fs.writeFile(source, 'external edit'); await fs.utimes(source, fixedNow / 1000, fixedNow / 1000)
    expect((await service.findRecoveryCandidates(source)).map((item) => item.id)).toContain(snapshot.id)
  })

  it('does not offer recovery when disk content already equals the snapshot', async () => {
    const { root, service } = await setup(); const source = path.join(root, 'a.md'); await fs.writeFile(source, 'baseline')
    const snapshot = await service.create({ sourcePath: source, content: 'saved draft', sourceVersion: await fileVersion(source) })
    await fs.writeFile(source, 'saved draft')
    expect(await service.findRecoveryCandidates(source)).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: snapshot.id })]))
  })

  it('reads each source file once while checking multiple recovery snapshots', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-backup-')); roots.push(root)
    const source = path.join(root, 'a.md')
    await fs.writeFile(source, 'disk')
    const sourceVersion = await fileVersion(source)
    const sourceReader = vi.fn(async () => ({
      filePath: source,
      content: 'disk',
      encoding: 'utf8' as const,
      lineEnding: 'lf' as const,
      version: sourceVersion,
      sampled: false,
    }))
    const service = new BackupService({ rootDir: root, sourceReader })
    await service.create({ sourcePath: source, content: 'draft one', sourceVersion })
    await service.create({ sourcePath: source, content: 'draft two', sourceVersion })

    expect(await service.findRecoveryCandidates(source)).toHaveLength(2)
    expect(sourceReader).toHaveBeenCalledTimes(1)
  })
})
