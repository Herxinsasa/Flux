import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  cancelWorkspaceScan,
  listWorkspaceFiles,
  startWorkspaceScan,
} from '../../src/main/services/workspace-service'

describe('workspace-service', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('filters ignored paths and emits batches no larger than 200', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-workspace-'))
    tempDirs.push(root)
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
    fs.mkdirSync(path.join(root, '.hidden'), { recursive: true })
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'node_modules', 'ignored.ts'), '')
    fs.writeFileSync(path.join(root, '.hidden', 'ignored.ts'), '')
    fs.writeFileSync(path.join(root, 'src', 'note.md.review.json'), '{}')
    for (let index = 0; index < 405; index++) fs.writeFileSync(path.join(root, `file-${index}.ts`), '')

    const batches: number[] = []
    await new Promise<void>((resolve, reject) => {
      startWorkspaceScan(root, (event) => {
        if (event.status === 'batch') batches.push(event.entries?.length ?? 0)
        if (event.status === 'complete') resolve()
        if (event.status === 'error') reject(new Error(event.error))
      })
    })

    expect(batches).toEqual([200, 200, 5])
    expect(listWorkspaceFiles(root).some((entry) => entry.relativePath.includes('ignored'))).toBe(false)
    expect(listWorkspaceFiles(root).some((entry) => entry.relativePath.endsWith('.review.json'))).toBe(false)
  })

  it('stops a scan after cancellation and does not emit completion', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-workspace-'))
    tempDirs.push(root)
    for (let index = 0; index < 450; index++) fs.writeFileSync(path.join(root, `file-${index}.ts`), '')

    let completed = false
    let taskId = ''
    await new Promise<void>((resolve, reject) => {
      const task = startWorkspaceScan(root, (event) => {
        if (event.status === 'batch') cancelWorkspaceScan(taskId)
        if (event.status === 'cancelled') resolve()
        if (event.status === 'complete') {
          completed = true
          resolve()
        }
        if (event.status === 'error') reject(new Error(event.error))
      })
      taskId = task.taskId
    })

    expect(completed).toBe(false)
  })
})
