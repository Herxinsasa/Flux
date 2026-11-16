import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import { constants, promises as fs } from 'fs'
import path from 'path'

const RESERVATION_WAIT_MS = 5000

type Ownership = {
  ownerId: number
  filePath: string
  reservationId: string
  committed: boolean
  waiters: Set<() => void>
}

export type ReservationResult =
  | { status: 'reserved' | 'owned'; filePath: string; reservationId: string }
  | { status: 'focused'; filePath: string; ownerId: number }
  | { status: 'timeout'; filePath: string }

export class DocumentOwnership {
  private readonly entries = new Map<string, Ownership>()
  private readonly secret = randomBytes(32)

  private sign(ownerId: number, key: string, nonce: string): string {
    return createHmac('sha256', this.secret)
      .update(JSON.stringify([ownerId, key, nonce]))
      .digest('hex')
  }

  private isCredential(ownerId: number, key: string, credential: string): boolean {
    const [nonce, signature, extra] = credential.split('.')
    if (!nonce || !signature || extra || !/^[0-9a-f]{64}$/.test(signature)) return false
    const expected = Buffer.from(this.sign(ownerId, key, nonce), 'hex')
    return timingSafeEqual(expected, Buffer.from(signature, 'hex'))
  }

  private key(filePath: string): string {
    const resolved = path.resolve(filePath).replace(/\\/g, '/')
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }

  async reserve(
    ownerId: number,
    filePath: string,
    purpose: 'open' | 'create',
    signal: AbortSignal,
  ): Promise<ReservationResult> {
    signal.throwIfAborted()
    if (!path.isAbsolute(filePath)) throw new Error('File path must be absolute')
    const resolved = path.resolve(filePath)
    if (purpose === 'open') {
      await fs.access(resolved, constants.R_OK)
      if (!(await fs.stat(resolved)).isFile()) throw new Error('Path is not a file')
    } else {
      const parent = path.dirname(resolved)
      await fs.access(parent)
      if (!(await fs.stat(parent)).isDirectory()) throw new Error('Parent path is not a directory')
    }
    signal.throwIfAborted()
    const key = this.key(resolved)
    const deadline = Date.now() + RESERVATION_WAIT_MS
    while (true) {
      signal.throwIfAborted()
      const entry = this.entries.get(key)
      if (!entry) {
        const nonce = randomUUID()
        const reservationId = `${nonce}.${this.sign(ownerId, key, nonce)}`
        this.entries.set(key, {
          ownerId,
          filePath: resolved,
          reservationId,
          committed: false,
          waiters: new Set(),
        })
        return { status: 'reserved', filePath: resolved, reservationId }
      }
      if (entry.committed) {
        if (entry.ownerId === ownerId) {
          return { status: 'owned', filePath: entry.filePath, reservationId: entry.reservationId }
        }
        return { status: 'focused', filePath: entry.filePath, ownerId: entry.ownerId }
      }
      const remaining = deadline - Date.now()
      if (remaining <= 0 || !(await this.waitForChange(entry, remaining, signal))) {
        return { status: 'timeout', filePath: resolved }
      }
    }
  }

  commit(ownerId: number, filePath: string, reservationId: string): boolean {
    const entry = this.entries.get(this.key(filePath))
    if (!entry || entry.ownerId !== ownerId || entry.reservationId !== reservationId) return false
    entry.committed = true
    this.notify(entry)
    return true
  }

  hasReservation(ownerId: number, filePath: string, reservationId: string): boolean {
    const entry = this.entries.get(this.key(filePath))
    return Boolean(
      entry &&
      entry.ownerId === ownerId &&
      entry.reservationId === reservationId &&
      !entry.committed,
    )
  }

  release(ownerId: number, filePath: string, reservationId: string): boolean {
    const key = this.key(filePath)
    const entry = this.entries.get(key)
    if (!entry || entry.ownerId !== ownerId || entry.reservationId !== reservationId) {
      return this.isCredential(ownerId, key, reservationId)
    }
    this.entries.delete(key)
    this.notify(entry)
    return true
  }

  releaseOwner(ownerId: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.ownerId !== ownerId) continue
      this.entries.delete(key)
      this.notify(entry)
    }
  }

  private notify(entry: Ownership): void {
    for (const waiter of entry.waiters) waiter()
    entry.waiters.clear()
  }

  private waitForChange(entry: Ownership, timeout: number, signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const finish = (changed: boolean) => {
        clearTimeout(timer)
        entry.waiters.delete(onChange)
        signal.removeEventListener('abort', onAbort)
        resolve(changed)
      }
      const onChange = () => finish(true)
      const onAbort = () => {
        clearTimeout(timer)
        entry.waiters.delete(onChange)
        signal.removeEventListener('abort', onAbort)
        reject(signal.reason)
      }
      const timer = setTimeout(() => finish(false), timeout)
      entry.waiters.add(onChange)
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    })
  }
}
