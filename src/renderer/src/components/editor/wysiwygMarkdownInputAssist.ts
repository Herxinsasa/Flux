import { commandsCtx } from '@milkdown/kit/core'
import { wrapInBlockquoteCommand } from '@milkdown/kit/preset/commonmark'
import { Plugin, type EditorState } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'

function codeMarkActive(state: EditorState): boolean {
  const codeMark = state.schema.marks.inlineCode ?? state.schema.marks.code
  if (!codeMark) return false
  const marks = state.storedMarks ?? state.selection.$from.marks()
  return codeMark.isInSet(marks) != null
}

export const wysiwygMarkdownInputAssist = $prose((ctx) =>
  new Plugin({
    props: {
      handleTextInput(view, from, to, text) {
        if (text === '`' && view.state.selection.empty) {
          const codeMark = view.state.schema.marks.inlineCode ?? view.state.schema.marks.code
          if (!codeMark) return false
          const previousChar = view.state.doc.textBetween(Math.max(0, from - 1), from, '\n', '\n')
          // 标题节点中首个反引号可能已激活 mark；连续第二个反引号仍应优先解释为“开始输入行内代码”。
          if (previousChar === '`') {
            view.dispatch(view.state.tr.delete(from - 1, from).addStoredMark(codeMark.create()))
            return true
          }
          if (codeMarkActive(view.state)) {
            view.dispatch(view.state.tr.removeStoredMark(codeMark))
            return true
          }
          return false
        }

        if (text !== ' ' || !view.state.selection.empty) return false
        const { $from } = view.state.selection
        const blockStart = $from.start()
        const before = view.state.doc.textBetween(blockStart, from, '\n', '\n')
        if (!/^\s*(?:\*\s*)?>$/.test(before)) return false

        view.dispatch(view.state.tr.delete(from - before.length, from))
        ctx.get(commandsCtx).call(wrapInBlockquoteCommand.key)
        return true
      },
    },
  }),
)
