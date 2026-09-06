import { describe, expect, it } from 'vitest'
import { Schema } from '@milkdown/prose/model'
import { EditorState } from '@milkdown/prose/state'
import {
  highlightCodeText,
  transactionTouchesCodeBlock,
} from '../../src/renderer/src/components/editor/wysiwygCodeBlockHighlight'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'text*', group: 'block' },
    code_block: {
      attrs: { language: { default: '' } },
      content: 'text*',
      group: 'block',
      code: true,
    },
    text: { group: 'inline' },
  },
})

describe('WYSIWYG code block highlighting', () => {
  it('returns editable text offsets for a known language', () => {
    const code = 'const answer = 42'
    const spans = highlightCodeText(code, 'typescript')

    expect(spans.length).toBeGreaterThan(0)
    expect(spans.some((span) => span.classes.includes('hljs-keyword') && code.slice(span.from, span.to) === 'const')).toBe(true)
    expect(spans.some((span) => span.classes.includes('hljs-number') && code.slice(span.from, span.to) === '42')).toBe(true)
  })

  it('leaves unknown and unlabelled languages plain', () => {
    expect(highlightCodeText('hello', '')).toEqual([])
    expect(highlightCodeText('hello', 'not-a-real-language')).toEqual([])
  })

  it.each(['markdown', 'md', 'text', 'txt', 'log'])('leaves %s code blocks plain', (language) => {
    expect(highlightCodeText('# Heading\nconst answer = 42', language)).toEqual([])
  })

  it('does not rehighlight code blocks for ordinary paragraph edits', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('hello')),
      schema.node('code_block', { language: 'typescript' }, schema.text('const value = 1')),
    ])
    const transaction = EditorState.create({ doc }).tr.insertText('!', 2)

    expect(transactionTouchesCodeBlock(transaction)).toBe(false)
  })

  it('rehighlights when the edit occurs inside a code block', () => {
    const paragraph = schema.node('paragraph', null, schema.text('hello'))
    const doc = schema.node('doc', null, [
      paragraph,
      schema.node('code_block', { language: 'typescript' }, schema.text('const value = 1')),
    ])
    const codeTextPosition = paragraph.nodeSize + 2
    const transaction = EditorState.create({ doc }).tr.insertText('x', codeTextPosition)

    expect(transactionTouchesCodeBlock(transaction)).toBe(true)
  })

  it('rehighlights when a code block becomes a paragraph', () => {
    const paragraph = schema.node('paragraph', null, schema.text('hello'))
    const doc = schema.node('doc', null, [
      paragraph,
      schema.node('code_block', { language: 'typescript' }, schema.text('const value = 1')),
    ])
    const transaction = EditorState.create({ doc }).tr.setNodeMarkup(
      paragraph.nodeSize,
      schema.nodes.paragraph,
    )

    expect(transactionTouchesCodeBlock(transaction)).toBe(true)
  })
})
