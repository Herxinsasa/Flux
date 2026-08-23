import { describe, expect, it } from 'vitest'
import { Schema } from '@milkdown/prose/model'
import { findTextRangeInProseMirror } from '../../src/renderer/src/components/editor/wysiwygReviewPosition'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    blockquote: { content: 'block+', group: 'block' },
    text: { group: 'inline' },
  },
  marks: {
    inlineCode: {},
    strong: {},
  },
})

describe('WYSIWYG review position mapping', () => {
  it('locates inline code quotes against parsed text', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('前缀 '),
        schema.text('123', [schema.marks.inlineCode.create()]),
        schema.text(' 后缀'),
      ]),
    ])

    const range = findTextRangeInProseMirror(doc, '`123`')

    expect(range).not.toBeNull()
    expect(doc.textBetween(range!.from, range!.to)).toBe('123')
  })

  it('locates blockquote source markers against rendered block text', () => {
    const doc = schema.node('doc', null, [
      schema.node('blockquote', null, [
        schema.node('paragraph', null, [schema.text('引用块')]),
      ]),
    ])

    const range = findTextRangeInProseMirror(doc, '> 引用块')

    expect(range).not.toBeNull()
    expect(doc.textBetween(range!.from, range!.to)).toBe('引用块')
  })

  it('locates formatted markdown quotes against plain rendered text', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('重点', [schema.marks.strong.create()]),
      ]),
    ])

    const range = findTextRangeInProseMirror(doc, '**重点**')

    expect(range).not.toBeNull()
    expect(doc.textBetween(range!.from, range!.to)).toBe('重点')
  })

  it('keeps non-HTML angle placeholders when locating long review quotes', () => {
    const quote = '各类事实分别维护：需求规格保存业务预期，影响面保存真实范围，详细设计保存技术契约，开发计划保存任务与验证当前状态，审查和构建凭据证明最终代码质量，`progress.json` 只负责恢复导航。UI 原型按需写入 `docs/05-UI/原型/<迭代ID>/`。'
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('各类事实分别维护：需求规格保存业务预期，影响面保存真实范围，详细设计保存技术契约，开发计划保存任务与验证当前状态，审查和构建凭据证明最终代码质量，'),
        schema.text('progress.json', [schema.marks.inlineCode.create()]),
        schema.text(' 只负责恢复导航。UI 原型按需写入 '),
        schema.text('docs/05-UI/原型/<迭代ID>/', [schema.marks.inlineCode.create()]),
        schema.text('。'),
      ]),
    ])

    const range = findTextRangeInProseMirror(doc, quote)

    expect(range).not.toBeNull()
    expect(doc.textBetween(range!.from, range!.to)).toContain('docs/05-UI/原型/<迭代ID>/')
  })
})
