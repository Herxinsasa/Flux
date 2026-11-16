import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { DocumentOwnership } from '../../src/main/services/document-ownership'

describe('document ownership', () => {
  let directory: string
  let filePath: string

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-ownership-'))
    filePath = path.join(directory, 'note.md')
    fs.writeFileSync(filePath, 'note')
  })

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('waits for a competing reservation to commit before focusing its owner', async () => {
    const ownership = new DocumentOwnership()
    const first = await ownership.reserve(1, filePath, 'open', new AbortController().signal)
    if (first.status !== 'reserved') throw new Error('Expected reservation')
    const second = ownership.reserve(2, filePath, 'open', new AbortController().signal)
    let settled = false
    void second.then(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(settled).toBe(false)
    expect(ownership.commit(1, filePath, first.reservationId)).toBe(true)
    await expect(second).resolves.toMatchObject({ status: 'focused', ownerId: 1 })
  })

  it('allows retry after release and rejects stale credentials', async () => {
    const ownership = new DocumentOwnership()
    const first = await ownership.reserve(1, filePath, 'open', new AbortController().signal)
    if (first.status !== 'reserved') throw new Error('Expected reservation')
    expect(ownership.release(1, filePath, first.reservationId)).toBe(true)
    const second = await ownership.reserve(2, filePath, 'open', new AbortController().signal)
    if (second.status !== 'reserved') throw new Error('Expected reservation')
    expect(second.reservationId).not.toBe(first.reservationId)
    expect(ownership.release(1, filePath, first.reservationId)).toBe(true)
    expect(ownership.commit(2, filePath, second.reservationId)).toBe(true)
    await expect(
      ownership.reserve(3, filePath, 'open', new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'focused',
      ownerId: 2,
    })
  })

  it('releases reservations when their owner disappears', async () => {
    const ownership = new DocumentOwnership()
    await ownership.reserve(1, filePath, 'open', new AbortController().signal)
    ownership.releaseOwner(1)
    await expect(
      ownership.reserve(2, filePath, 'open', new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'reserved',
    })
  })

  it('does not grant ownership to a window destroyed while waiting', async () => {
    const ownership = new DocumentOwnership()
    const first = await ownership.reserve(1, filePath, 'open', new AbortController().signal)
    if (first.status !== 'reserved') throw new Error('Expected reservation')
    const controller = new AbortController()
    const pending = ownership.reserve(2, filePath, 'open', controller.signal)
    controller.abort()
    await expect(pending).rejects.toBeDefined()
    ownership.release(1, filePath, first.reservationId)
    await expect(
      ownership.reserve(3, filePath, 'open', new AbortController().signal),
    ).resolves.toMatchObject({ status: 'reserved' })
  })

  it('accepts repeated releases without retaining release records', async () => {
    const ownership = new DocumentOwnership()
    const tokens: string[] = []
    for (let i = 0; i < 100; i++) {
      const result = await ownership.reserve(1, filePath, 'open', new AbortController().signal)
      if (result.status !== 'reserved') throw new Error('Expected reservation')
      tokens.push(result.reservationId)
      expect(ownership.release(1, filePath, result.reservationId)).toBe(true)
    }
    expect(ownership.release(1, filePath, tokens[0])).toBe(true)
    expect(ownership.release(2, filePath, tokens[0])).toBe(false)
    expect(ownership.release(1, path.join(directory, 'other.md'), tokens[0])).toBe(false)
  })

  it('times out without taking a pending reservation', async () => {
    const ownership = new DocumentOwnership()
    const first = await ownership.reserve(1, filePath, 'open', new AbortController().signal)
    if (first.status !== 'reserved') throw new Error('Expected reservation')
    await expect(
      ownership.reserve(2, filePath, 'open', new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'timeout',
    })
    expect(ownership.commit(1, filePath, first.reservationId)).toBe(true)
    await expect(
      ownership.reserve(2, filePath, 'open', new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'focused',
      ownerId: 1,
    })
  }, 7000)

  it.skipIf(process.platform !== 'win32')(
    'treats Windows case variants as the same document',
    async () => {
      const ownership = new DocumentOwnership()
      const first = await ownership.reserve(1, filePath, 'open', new AbortController().signal)
      if (first.status !== 'reserved') throw new Error('Expected reservation')
      expect(ownership.commit(1, filePath, first.reservationId)).toBe(true)
      await expect(
        ownership.reserve(2, filePath.toUpperCase(), 'open', new AbortController().signal),
      ).resolves.toMatchObject({ status: 'focused', ownerId: 1 })
    },
  )
})
