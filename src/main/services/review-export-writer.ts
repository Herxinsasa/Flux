import crypto from 'crypto'
import fs from 'fs'

export async function writeReviewExportAtomic(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  let handle: fs.promises.FileHandle | null = null
  try {
    handle = await fs.promises.open(tempPath, 'wx')
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await fs.promises.rename(tempPath, filePath)
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined)
    await fs.promises.unlink(tempPath).catch(() => undefined)
    throw error
  }
}
