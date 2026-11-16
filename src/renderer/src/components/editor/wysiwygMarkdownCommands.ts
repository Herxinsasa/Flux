import { commandsCtx, editorViewCtx, schemaCtx, type Editor } from '@milkdown/kit/core'
import {
  createCodeBlockCommand,
  insertHrCommand,
  insertImageCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark'
import { insertTableCommand } from '@milkdown/kit/preset/gfm'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { MarkdownCommandId } from './sourceMarkdownCommands'
import { collectLinkTextMarks, selectionContainsImage } from './wysiwygLinkRange'

const SELECTION_COMMANDS = new Set<MarkdownCommandId>([
  'bold',
  'italic',
  'inline-code',
  'blockquote',
  'ordered-list',
  'unordered-list',
  'task-list',
])

export function commandNeedsSelection(command: MarkdownCommandId): boolean {
  return SELECTION_COMMANDS.has(command)
}

function turnSelectionIntoTaskList(editor: Editor): boolean {
  // milkdown 的 Ctx.get 对未注册 slice 会抛异常（create 前/destroy 后），须 try/catch 兜底
  let commands, view
  try {
    commands = editor.ctx.get(commandsCtx)
    view = editor.ctx.get(editorViewCtx)
  } catch {
    return false
  }
  if (!commands || !view) return false
  commands.call(wrapInBulletListCommand.key)

  const { from, to } = view.state.selection
  let transaction = view.state.tr
  let changed = false
  view.state.doc.nodesBetween(from, to, (node, position) => {
    if (node.type.name !== 'list_item' || node.attrs.checked === false) return
    transaction = transaction.setNodeMarkup(position, undefined, {
      ...node.attrs,
      checked: false,
    })
    changed = true
  })
  if (changed) view.dispatch(transaction.scrollIntoView())
  return changed
}

export interface ApplyWysiwygLinkOptions {
  href: string
  text: string
  /** 已有链接或当前选区范围；省略时取当前 ProseMirror 选区。 */
  range?: { from: number; to: number }
}

/** 用链接对话框的结果插入或替换链接，并尽量保留原有文本格式。 */
export function applyWysiwygLink(editor: Editor, options: ApplyWysiwygLinkOptions): boolean {
  const href = options.href.trim()
  const text = options.text.trim()
  if (!href || !text) return false

  let view, schema
  try {
    view = editor.ctx.get(editorViewCtx)
    schema = editor.ctx.get(schemaCtx)
  } catch {
    return false
  }
  if (!view || !schema) return false
  const link = schema.marks.link
  if (!link) return false

  const range = options.range ?? {
    from: view.state.selection.from,
    to: view.state.selection.to,
  }
  if (selectionContainsImage(view.state.doc, range.from, range.to)) return false

  try {
    const linkMark = link.create({ href, title: null })
    const currentText = view.state.doc.textBetween(range.from, range.to, '\n')
    if (currentText === text) {
      const transaction = view.state.tr
        .removeMark(range.from, range.to, link)
        .addMark(range.from, range.to, linkMark)
      view.dispatch(transaction.scrollIntoView())
    } else {
      const marks = collectLinkTextMarks(view.state.doc, range.from, range.to, link)
      const node = schema.text(text, [...marks, linkMark])
      view.dispatch(view.state.tr.replaceWith(range.from, range.to, node).scrollIntoView())
    }
  } catch {
    return false
  }
  view.focus()
  return true
}

function insertToc(view: EditorView): boolean {
  const tocType = view.state.schema.nodes.toc
  if (!tocType) return false
  view.dispatch(view.state.tr.replaceSelectionWith(tocType.create()).scrollIntoView())
  return true
}

export function runWysiwygMarkdownCommand(editor: Editor, command: MarkdownCommandId): boolean {
  // milkdown 的 Ctx.get 对未注册 slice 会抛异常（create 前/destroy 后），须 try/catch 兜底
  let commands, view
  try {
    commands = editor.ctx.get(commandsCtx)
    view = editor.ctx.get(editorViewCtx)
  } catch {
    return false
  }
  if (!commands || !view) return false
  if (commandNeedsSelection(command) && view.state.selection.empty) return false

  let handled = false
  switch (command) {
    case 'bold':
      handled = commands.call(toggleStrongCommand.key)
      break
    case 'italic':
      handled = commands.call(toggleEmphasisCommand.key)
      break
    case 'inline-code':
      handled = commands.call(toggleInlineCodeCommand.key)
      break
    case 'blockquote':
      handled = commands.call(wrapInBlockquoteCommand.key)
      break
    case 'ordered-list':
      handled = commands.call(wrapInOrderedListCommand.key)
      break
    case 'unordered-list':
      handled = commands.call(wrapInBulletListCommand.key)
      break
    case 'task-list':
      handled = turnSelectionIntoTaskList(editor)
      break
    case 'heading-1':
    case 'heading-2':
    case 'heading-3':
    case 'heading-4':
    case 'heading-5':
      handled = commands.call(wrapInHeadingCommand.key, Number(command.at(-1)))
      break
    case 'insert-image':
      handled = commands.call(insertImageCommand.key, {
        src: './image.png',
        alt: '图片描述',
        title: '',
      })
      break
    case 'insert-table':
      handled = commands.call(insertTableCommand.key, { row: 3, col: 3 })
      break
    case 'insert-toc':
      handled = insertToc(view)
      break
    case 'insert-code-block':
      handled = commands.call(createCodeBlockCommand.key)
      break
    case 'insert-divider':
      handled = commands.call(insertHrCommand.key)
      break
    default:
      return false
  }

  if (handled) view.focus()
  return handled
}
