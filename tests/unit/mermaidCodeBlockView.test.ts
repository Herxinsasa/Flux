import { describe, expect, it } from 'vitest'
import { applyMermaidPreviewScale } from '../../src/renderer/src/components/editor/mermaidCodeBlockView'

describe('Mermaid WYSIWYG scaling', () => {
  it('keeps SVG at a stable vector base size for the editor root zoom', () => {
    const preview = document.createElement('div')
    preview.style.zoom = '1.5'
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 640 320')
    svg.style.zoom = '2'
    preview.appendChild(svg)

    applyMermaidPreviewScale(preview)

    expect(svg.style.width).toBe('640px')
    expect(svg.style.height).toBe('auto')
    expect(svg.style.zoom).toBe('')
    expect(preview.style.zoom).toBe('')
  })
})
