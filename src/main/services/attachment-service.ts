import { createHash, randomBytes } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import type { SaveImageAttachmentRequest, SaveImageAttachmentResult, SupportedImageMime } from '../../shared/attachment-backup'
import { IMAGE_MIME_TYPES } from '../../shared/attachment-backup'
import { FluxFileError } from './file-service'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024

const EXTENSIONS: Record<SupportedImageMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

function asSupportedMime(mime: string): SupportedImageMime {
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(mime)) return mime as SupportedImageMime
  throw new FluxFileError('UNSUPPORTED_FORMAT', 'Only PNG, JPEG, GIF, and WebP images are supported')
}

function safeAlt(value: string | undefined): string {
  return (value ?? 'image').replace(/[\r\n\[\]]/g, ' ').trim().slice(0, 120) || 'image'
}

async function atomicWrite(filePath: string, bytes: Uint8Array): Promise<void> {
  const tempPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await fs.writeFile(tempPath, bytes, { flag: 'wx' })
    await fs.rename(tempPath, filePath)
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function saveImageAttachment(request: SaveImageAttachmentRequest): Promise<SaveImageAttachmentResult> {
  if (!path.isAbsolute(request.sourcePath)) {
    throw new FluxFileError('INVALID_DATA', 'A saved Markdown document is required before inserting an image')
  }
  const mime = asSupportedMime(request.mime)
  if (!(request.bytes instanceof Uint8Array) || request.bytes.byteLength === 0) {
    throw new FluxFileError('INVALID_DATA', 'Image data is empty')
  }
  if (request.bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new FluxFileError('QUOTA_EXCEEDED', 'Image exceeds the 20 MB limit')
  }

  const directory = path.dirname(request.sourcePath)
  const documentName = path.basename(request.sourcePath, path.extname(request.sourcePath))
  const assetsDir = path.join(directory, `${documentName}.assets`)
  await fs.mkdir(assetsDir, { recursive: true })

  const hash = createHash('sha256').update(request.bytes).digest('hex').slice(0, 8)
  const filename = `${Date.now()}-${hash}.${EXTENSIONS[mime]}`
  const targetPath = path.join(assetsDir, filename)
  await atomicWrite(targetPath, request.bytes)

  return {
    relativePath: path.relative(directory, targetPath).split(path.sep).join('/'),
    alt: safeAlt(request.alt),
  }
}
