import { afterEach, describe, expect, it } from 'vitest'
import {
  beginDocumentOperation,
  setDocumentOperationsFrozen,
  waitForDocumentOperations,
} from '../../src/renderer/src/utils/documentOperations'

afterEach(() => setDocumentOperationsFrozen(false))

describe('document operation freeze', () => {
  it('waits for existing operations and rejects new ones until unfrozen', async () => {
    const finish = beginDocumentOperation()
    expect(finish).not.toBeNull()
    setDocumentOperationsFrozen(true)
    expect(beginDocumentOperation()).toBeNull()
    let settled = false
    const waiting = waitForDocumentOperations().then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    finish!()
    await waiting
    expect(settled).toBe(true)
    setDocumentOperationsFrozen(false)
    beginDocumentOperation()!()
  })
})
