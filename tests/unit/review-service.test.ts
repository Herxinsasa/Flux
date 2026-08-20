import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  getReviewSidecarPath,
  loadReviewSidecar,
  saveReviewSidecar,
  serializeReviewSidecar,
} from '../../src/main/services/review-service'
import {
  REVIEW_SCHEMA_VERSION,
  createEmptyReviewSidecar,
  createReviewAnchor,
  reanchorReviewComment,
  type ReviewComment,
  type ReviewSidecar,
} from '../../src/shared/review'

function comment(source: string, start: number, body: string, id: string): ReviewComment {
  const anchor = createReviewAnchor(source, start, start + 5)!
  return {
    id,
    anchor,
    body,
    author: 'user',
    status: 'open',
    anchorStatus: 'valid',
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
  }
}

describe('review sidecar service', () => {
  let tempDir: string
  let sourcePath: string
  const source = 'alpha middle omega'

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-review-'))
    sourcePath = path.join(tempDir, 'note.md')
    fs.writeFileSync(sourcePath, source)
  })

  afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  it('serializes comments deterministically by source position', () => {
    const sidecar: ReviewSidecar = {
      schemaVersion: REVIEW_SCHEMA_VERSION,
      sourcePath,
      sourceHash: 'hash',
      comments: [comment(source, 13, 'second', 'b'), comment(source, 0, 'first', 'a')],
      updatedAt: '2026-08-06T00:00:00.000Z',
    }
    const first = serializeReviewSidecar(sidecar)
    const second = serializeReviewSidecar({ ...sidecar, comments: [...sidecar.comments].reverse() })
    expect(first).toBe(second)
    expect(first.indexOf('first')).toBeLessThan(first.indexOf('second'))
    expect(first.endsWith('\n')).toBe(true)
  })

  it('keeps old sidecars compatible and persists reviewer/modifier replies', () => {
    const legacy = comment(source, 0, 'review', 'a')
    const legacySidecar: ReviewSidecar = {
      schemaVersion: REVIEW_SCHEMA_VERSION,
      sourcePath,
      sourceHash: 'hash',
      comments: [legacy],
      updatedAt: '2026-08-06T00:00:00.000Z',
    }
    fs.writeFileSync(getReviewSidecarPath(sourcePath), JSON.stringify(legacySidecar), 'utf8')
    expect(loadReviewSidecar(sourcePath, source).readOnly).toBe(false)

    legacy.replies = [{ id: 'reply-1', body: '已完成修改', role: 'modifier', createdAt: '2026-08-06T00:01:00.000Z' }]
    const serialized = serializeReviewSidecar({ ...legacySidecar, comments: [legacy] })
    expect(serialized).toContain('"role": "modifier"')
    expect(serialized).toContain('已完成修改')
  })

  it('loads a sidecar moved with the markdown file to another folder', () => {
    const oldPath = path.join(tempDir, 'old', 'note.md')
    const portableSidecar: ReviewSidecar = {
      schemaVersion: REVIEW_SCHEMA_VERSION,
      sourcePath: oldPath,
      sourceHash: 'hash',
      comments: [comment(source, 0, 'portable', 'a')],
      updatedAt: '2026-08-06T00:00:00.000Z',
    }
    fs.writeFileSync(getReviewSidecarPath(sourcePath), serializeReviewSidecar(portableSidecar), 'utf8')

    const loaded = loadReviewSidecar(sourcePath, source)

    expect(loaded.readOnly).toBe(false)
    expect(loaded.sidecar.sourcePath).toBe(sourcePath)
    expect(loaded.sidecar.comments[0].body).toBe('portable')
  })

  it('rejects an external sidecar change instead of overwriting it', async () => {
    const initial = createEmptyReviewSidecar(sourcePath, source)
    initial.comments = [comment(source, 0, 'initial', 'a')]
    const saved = await saveReviewSidecar({ sidecar: initial, sourceContent: source, expectedVersion: null })
    const external = { ...saved.sidecar, updatedAt: '2026-08-06T01:00:00.000Z' }
    fs.writeFileSync(getReviewSidecarPath(sourcePath), serializeReviewSidecar(external))

    await expect(saveReviewSidecar({
      sidecar: { ...saved.sidecar, comments: [comment(source, 0, 'local', 'b')] },
      sourceContent: source,
      expectedVersion: saved.sidecarVersion,
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    expect(fs.readFileSync(getReviewSidecarPath(sourcePath), 'utf8')).toContain('2026-08-06T01:00:00.000Z')
  })

  it('serializes concurrent writers so one stale version is rejected', async () => {
    const initial = createEmptyReviewSidecar(sourcePath, source)
    initial.comments = [comment(source, 0, 'initial', 'a')]
    const saved = await saveReviewSidecar({ sidecar: initial, sourceContent: source, expectedVersion: null })
    const first = saveReviewSidecar({ sidecar: { ...saved.sidecar, comments: [comment(source, 0, 'first', 'b')] }, sourceContent: source, expectedVersion: saved.sidecarVersion })
    const second = saveReviewSidecar({ sidecar: { ...saved.sidecar, comments: [comment(source, 0, 'second', 'c')] }, sourceContent: source, expectedVersion: saved.sidecarVersion })
    const outcomes = await Promise.allSettled([first, second])
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })

  it('loads damaged JSON read-only and never overwrites it', async () => {
    const sidecarPath = getReviewSidecarPath(sourcePath)
    fs.writeFileSync(sidecarPath, '{broken json', 'utf8')
    const loaded = loadReviewSidecar(sourcePath, source)
    expect(loaded).toMatchObject({ readOnly: true, errorCode: 'INVALID_DATA' })

    await expect(saveReviewSidecar({
      sidecar: { ...loaded.sidecar, comments: [comment(source, 0, 'new', 'a')] },
      sourceContent: source,
      expectedVersion: loaded.sidecarVersion,
    })).rejects.toMatchObject({ code: 'INVALID_DATA' })
    expect(fs.readFileSync(sidecarPath, 'utf8')).toBe('{broken json')
  })

  it('relocates a unique quote and orphans an ambiguous quote', () => {
    const moved = reanchorReviewComment(comment('hello world', 0, 'note', 'a'), 'prefix hello world')
    expect(moved).toMatchObject({ anchorStatus: 'relocated', anchor: { start: 7, end: 12 } })

    const repeated = comment('xxhello x', 2, 'note', 'b')
    repeated.anchor.prefix = 'missing'
    repeated.anchor.suffix = 'missing'
    expect(reanchorReviewComment(repeated, 'hello and hello').anchorStatus).toBe('orphaned')
  })

  it('deletes the sidecar when the final comment is removed', async () => {
    const initial = createEmptyReviewSidecar(sourcePath, source)
    initial.comments = [comment(source, 0, 'initial', 'a')]
    const saved = await saveReviewSidecar({ sidecar: initial, sourceContent: source, expectedVersion: null })
    const removed = await saveReviewSidecar({ sidecar: { ...saved.sidecar, comments: [] }, sourceContent: source, expectedVersion: saved.sidecarVersion })
    expect(removed.sidecarVersion).toBeNull()
    expect(fs.existsSync(getReviewSidecarPath(sourcePath))).toBe(false)
  })
})
