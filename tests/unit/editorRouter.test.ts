import { describe, expect, it } from 'vitest'
import { editorRouteForPath } from '../../src/renderer/src/registry/EditorRouter'

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
})
