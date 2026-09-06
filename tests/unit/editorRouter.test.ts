import { describe, expect, it } from 'vitest'
import {
  editorRouteForPath,
  nextPlainTextFontSize,
} from '../../src/renderer/src/registry/EditorRouter'

describe('editorRouteForPath', () => {
  it('routes Markdown extensions to the Markdown editor', () => {
    expect(editorRouteForPath('/docs/readme.md')).toBe('markdown')
    expect(editorRouteForPath('/docs/readme.markdown')).toBe('markdown')
  })

  it('routes log files to the LogViewer path', () => {
    expect(editorRouteForPath('/logs/service.LOG')).toBe('log')
  })

  it('uses the plain text route for .txt files', () => {
    expect(editorRouteForPath('/notes/todo.txt')).toBe('text')
  })

  it('steps and clamps non-Markdown Ctrl+wheel font sizes', () => {
    expect(nextPlainTextFontSize(13, -100)).toBe(14)
    expect(nextPlainTextFontSize(13, 100)).toBe(12)
    expect(nextPlainTextFontSize(36, -100)).toBe(36)
    expect(nextPlainTextFontSize(6, 100)).toBe(6)
  })
})
