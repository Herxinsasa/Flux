import { beforeEach, describe, expect, it } from 'vitest'
import { resolveWysiwygImageSource } from '../../src/renderer/src/components/editor/wysiwygImageView'

describe('resolveWysiwygImageSource', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        media: {
          toLocalUrl: (absolutePath: string) => `flux-local://media/${encodeURIComponent(absolutePath)}`,
        },
      },
    })
  })

  it('resolves a relative image from the Markdown document directory', () => {
    const source = resolveWysiwygImageSource(
      'F:\\docs\\guide.md',
      './guide.assets/demo.png',
    )
    expect(decodeURIComponent(source)).toContain('F:\\docs\\guide.assets\\demo.png')
  })

  it('treats an absolute Windows SVG path as a local file instead of a URL scheme', () => {
    const source = resolveWysiwygImageSource(
      'F:\\docs\\guide.md',
      'C:\\Users\\tester\\Desktop\\架构图.drawio.svg',
    )
    expect(decodeURIComponent(source)).toContain(
      'C:\\Users\\tester\\Desktop\\架构图.drawio.svg',
    )
  })

  it('keeps remote and raster base64 sources unchanged', () => {
    expect(resolveWysiwygImageSource('F:\\docs\\guide.md', 'https://example.com/a.png')).toBe(
      'https://example.com/a.png',
    )
    const inline = 'data:image/png;base64,AAAA'
    expect(resolveWysiwygImageSource('F:\\docs\\guide.md', inline)).toBe(inline)
  })

  it('rejects executable or unsupported explicit schemes', () => {
    expect(resolveWysiwygImageSource('F:\\docs\\guide.md', 'javascript:alert(1)')).toBe('')
    expect(resolveWysiwygImageSource('F:\\docs\\guide.md', 'data:text/html;base64,AAAA')).toBe('')
  })
})
