import { IMAGE_MIME_TYPES } from '../../../shared/attachment-backup'

export interface SavedMarkdownImage {
  alt: string
  relativePath: string
  markdownPath: string
}

export interface SaveMarkdownImagesResult {
  images: SavedMarkdownImage[]
  error?: string
}

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

export function getSupportedImageMime(file: File): string | null {
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
    return file.type
  }

  const extension = file.name.split('.').pop()?.toLowerCase()
  return extension ? (IMAGE_MIME_BY_EXTENSION[extension] ?? null) : null
}

export function isSupportedImageFile(file: File): boolean {
  return getSupportedImageMime(file) !== null
}

/** Encode each path segment without encoding the relative path separators. */
export function encodeMarkdownImagePath(relativePath: string): string {
  return relativePath
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

export function markdownImageSyntax(image: SavedMarkdownImage): string {
  return `![${image.alt}](${image.markdownPath})`
}

export async function saveMarkdownImages(
  sourcePath: string | null,
  files: File[],
): Promise<SaveMarkdownImagesResult> {
  if (!sourcePath) {
    return { images: [], error: '请先保存 Markdown 文档，再插入图片' }
  }

  const supported = files.filter(isSupportedImageFile)
  if (supported.length === 0) {
    return { images: [], error: '请选择 PNG、JPEG、GIF 或 WebP 图片' }
  }

  const images: SavedMarkdownImage[] = []
  for (const file of supported) {
    try {
      const mime = getSupportedImageMime(file)
      if (!mime) continue
      const bytes = new Uint8Array(await file.arrayBuffer())
      const result = await window.electronAPI.attachment.saveImage({
        sourcePath,
        bytes,
        mime,
        alt: file.name.replace(/\.[^.]+$/, ''),
      })
      if (!result.success || !result.data) {
        return {
          images,
          error: result.error ?? `图片保存失败：${file.name}`,
        }
      }
      images.push({
        alt: result.data.alt,
        relativePath: result.data.relativePath,
        markdownPath: encodeMarkdownImagePath(result.data.relativePath),
      })
    } catch {
      return { images, error: `图片保存失败：${file.name}` }
    }
  }

  return { images }
}
