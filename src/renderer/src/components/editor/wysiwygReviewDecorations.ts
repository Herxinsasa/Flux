import { $prose } from '@milkdown/utils'
import { Plugin, PluginKey } from '@milkdown/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/prose/view'
import type { ReviewComment } from '../../../../shared/review'
import { findTextRangeInProseMirror } from './wysiwygReviewPosition'

const wysiwygReviewDecorationsKey = new PluginKey<DecorationSet>('flux-wysiwyg-review-decorations')

function reviewSourceLength(sourceHash: string): number | undefined {
  const match = sourceHash.match(/:(\d+)$/)
  if (!match) return undefined
  const length = Number(match[1])
  return Number.isFinite(length) && length > 0 ? length : undefined
}

export function haveWysiwygReviewDecorationsChanged(
  previous: ReviewComment[],
  next: ReviewComment[],
): boolean {
  if (previous.length !== next.length) return true
  return previous.some((comment, index) => {
    const candidate = next[index]
    return !candidate
      || comment.id !== candidate.id
      || comment.anchorStatus !== candidate.anchorStatus
      || comment.anchor.quote !== candidate.anchor.quote
      || (comment.anchor.end > comment.anchor.start) !== (candidate.anchor.end > candidate.anchor.start)
  })
}

/**
 * 编辑界面（WYSIWYG）批注高亮：ProseMirror decoration 给批注引用文本加浅蓝背景，
 * 与源码模式 cm-review-highlight 观感一致。
 *
 * 数据流：MdWysiwygEditor 在批注变化时 dispatch `tr.setMeta(key, comments)`，
 * 插件 apply 收到 meta 后用 tr.doc 重建装饰；普通文档编辑时装饰随 changes 映射。
 */
export const wysiwygReviewDecorations = $prose(() =>
  new Plugin<DecorationSet>({
    key: wysiwygReviewDecorationsKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (transaction, value) => {
        const incoming = transaction.getMeta(wysiwygReviewDecorationsKey) as ReviewComment[] | undefined
        if (incoming) {
          // 批注列表更新：基于当前 doc 重建装饰
          const doc = transaction.doc
          const ranges: Array<{ from: number; to: number; id: string }> = []
          for (const comment of incoming) {
            if (comment.anchorStatus === 'orphaned' || comment.anchor.end <= comment.anchor.start) continue
            const sourceLength = reviewSourceLength(comment.anchor.sourceHash)
            const located = findTextRangeInProseMirror(
              doc,
              comment.anchor.quote,
              sourceLength ? comment.anchor.start / sourceLength : undefined,
            )
            if (located == null) continue
            const from = Math.max(0, located.from)
            const to = Math.min(doc.content.size, Math.max(from + 1, located.to))
            if (to <= from) continue
            ranges.push({ from, to, id: comment.id })
          }
          const decorations = ranges.map(({ from, to, id }) =>
            Decoration.inline(from, to, { class: 'flux-wysiwyg-review-highlight', 'data-review-id': id }),
          )
          return DecorationSet.create(doc, decorations)
        }
        // 普通文档编辑：装饰随事务映射（ProseMirror 的 DecorationSet.map 需要 mapping 与 doc 两个参数）
        if (transaction.docChanged) return value.map(transaction.mapping, transaction.doc)
        return value
      },
    },
    props: {
      decorations: (state) => wysiwygReviewDecorationsKey.getState(state) ?? DecorationSet.empty,
    },
  }),
)

/** 编辑界面批注变化时刷新高亮装饰 */
export function refreshWysiwygReviewDecorations(view: EditorView, comments: ReviewComment[]): void {
  view.dispatch(view.state.tr.setMeta(wysiwygReviewDecorationsKey, comments))
}
