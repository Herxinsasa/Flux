import { beforeEach, describe, expect, it } from 'vitest'
import type { TextDocumentSnapshot } from '../../src/shared/types'
import { useEditorStore } from '../../src/renderer/src/stores/editorStore'

function snapshot(filePath: string, content: string): TextDocumentSnapshot {
  return {
    filePath,
    content,
    encoding: 'utf8',
    lineEnding: 'lf',
    version: { mtimeMs: 1, size: content.length, contentHash: content },
    sampled: false,
  }
}

describe('document sessions', () => {
  beforeEach(() => {
    useEditorStore.setState({ activeDocumentPath: null, documentSessions: {}, content: '', isDirty: false })
  })

  it('preserves drafts separately for normalized file paths', () => {
    useEditorStore.getState().setDocumentSnapshot('C:\\Docs\\One.md', snapshot('C:\\Docs\\One.md', 'one'))
    useEditorStore.getState().setContent('one draft')
    useEditorStore.getState().setDocumentSnapshot('C:\\Docs\\Two.txt', snapshot('C:\\Docs\\Two.txt', 'two'))

    expect(useEditorStore.getState().activateDocument('c:/docs/one.md')).toBe(true)
    expect(useEditorStore.getState().content).toBe('one draft')
    expect(useEditorStore.getState().isDirty).toBe(true)
  })

  it('keeps sampled documents read-only and without a save snapshot', () => {
    useEditorStore.getState().setSampledDocument('/large.txt', 'sample', 'text')
    const session = useEditorStore.getState().documentSessions['/large.txt']

    expect(session.sampled).toBe(true)
    expect(session.snapshot).toBeNull()
  })
})
