import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  encodeMarkdownImagePath,
  isSupportedImageFile,
  markdownImageSyntax,
  saveMarkdownImages,
} from '../../src/renderer/src/utils/imageAttachment'

const saveImage = vi.fn()

describe('imageAttachment', () => {
  beforeEach(() => {
    saveImage.mockReset()
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { attachment: { saveImage } },
    })
  })

  it('encodes path segments so spaces and Chinese names remain portable', () => {
    expect(encodeMarkdownImagePath('My Note.assets/示例 图.png')).toBe(
      'My%20Note.assets/%E7%A4%BA%E4%BE%8B%20%E5%9B%BE.png',
    )
  })

  it('saves every selected image and returns standard Markdown references', async () => {
    saveImage
      .mockResolvedValueOnce({ success: true, data: { relativePath: 'note.assets/1.png', alt: 'one' } })
      .mockResolvedValueOnce({ success: true, data: { relativePath: 'note.assets/2.png', alt: 'two' } })
    const files = [
      new File([new Uint8Array([1])], 'one.png', { type: 'image/png' }),
      new File([new Uint8Array([2])], 'two.png', { type: 'image/png' }),
    ]

    const result = await saveMarkdownImages('C:\\docs\\note.md', files)

    expect(result.error).toBeUndefined()
    expect(result.images).toHaveLength(2)
    expect(result.images.map(markdownImageSyntax)).toEqual([
      '![one](note.assets/1.png)',
      '![two](note.assets/2.png)',
    ])
  })

  it('requires a saved Markdown path before copying an image', async () => {
    const result = await saveMarkdownImages(null, [
      new File([new Uint8Array([1])], 'one.png', { type: 'image/png' }),
    ])

    expect(result.images).toEqual([])
    expect(result.error).toContain('请先保存')
    expect(saveImage).not.toHaveBeenCalled()
  })

  it('recognizes Windows image drops with an empty MIME type by extension', async () => {
    const file = new File([new Uint8Array([1])], 'Screenshot.PNG', { type: '' })
    saveImage.mockResolvedValueOnce({
      success: true,
      data: { relativePath: 'note.assets/Screenshot.PNG', alt: 'Screenshot' },
    })

    expect(isSupportedImageFile(file)).toBe(true)
    await saveMarkdownImages('C:\\docs\\note.md', [file])

    expect(saveImage).toHaveBeenCalledWith(
      expect.objectContaining({ mime: 'image/png' }),
    )
  })
})
