import type { MarkdownCommandId } from './markdownCommandModel'

export type { MarkdownCommandId } from './markdownCommandModel'

export interface SourceMarkdownEdit {
  from: number
  to: number
  insert: string
  selection?: { anchor: number; head?: number }
}

const INLINE_WRAPPERS: Partial<Record<MarkdownCommandId, [string, string]>> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  'inline-code': ['`', '`'],
}

const INSERT_TEXT: Partial<Record<MarkdownCommandId, string>> = {
  'insert-link': '[链接文本](https://)',
  'insert-image': '![图片描述](./image.png)',
  'insert-table': '| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |',
  'insert-code-block': '```text\n\n```',
  'insert-divider': '\n---\n',
}

function lineRange(content: string, from: number, to: number): { from: number; to: number } {
  const start = content.lastIndexOf('\n', Math.max(0, from - 1)) + 1
  const nextBreak = content.indexOf('\n', to)
  return { from: start, to: nextBreak === -1 ? content.length : nextBreak }
}

function replaceLinePrefixes(text: string, prefix: string, ordered = false): string {
  let index = 0
  return text.split('\n').map((line) => {
    if (!line.trim()) return line
    const body = line.replace(/^\s*(?:>\s+|[-+*]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)?/, '')
    index += 1
    return `${ordered ? `${index}. ` : prefix}${body}`
  }).join('\n')
}

export function createSourceMarkdownEdit(
  command: MarkdownCommandId,
  content: string,
  selectionFrom: number,
  selectionTo: number,
): SourceMarkdownEdit | null {
  const from = Math.min(selectionFrom, selectionTo)
  const to = Math.max(selectionFrom, selectionTo)
  const selected = content.slice(from, to)
  const wrapper = INLINE_WRAPPERS[command]

  if (wrapper) {
    if (!selected) return null
    const insert = `${wrapper[0]}${selected}${wrapper[1]}`
    return { from, to, insert, selection: { anchor: from + wrapper[0].length, head: from + wrapper[0].length + selected.length } }
  }

  if (command === 'blockquote' || command === 'ordered-list' || command === 'unordered-list' || command === 'task-list') {
    if (!selected) return null
    const range = lineRange(content, from, to)
    const block = content.slice(range.from, range.to)
    const insert = command === 'ordered-list'
      ? replaceLinePrefixes(block, '', true)
      : replaceLinePrefixes(block, command === 'blockquote' ? '> ' : command === 'task-list' ? '- [ ] ' : '- ')
    return { from: range.from, to: range.to, insert }
  }

  if (command.startsWith('heading-')) {
    const level = Number(command.slice(-1))
    if (level < 1 || level > 5) return null
    const range = lineRange(content, from, to)
    const insert = content.slice(range.from, range.to).split('\n').map((line) => {
      if (!line.trim()) return line
      return `${'#'.repeat(level)} ${line.replace(/^\s{0,3}#{1,6}\s+/, '')}`
    }).join('\n')
    return { from: range.from, to: range.to, insert }
  }

  const template = INSERT_TEXT[command]
  if (template != null) {
    return { from, to, insert: template, selection: { anchor: from + template.length } }
  }

  return null
}
