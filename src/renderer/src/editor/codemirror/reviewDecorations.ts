import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import type { ReviewComment } from '../../../../shared/review'

export const setReviewDecorations = StateEffect.define<ReviewComment[]>()

function buildDecorations(comments: ReviewComment[]): DecorationSet {
  const ranges = comments
    .filter((comment) => comment.anchorStatus !== 'orphaned' && comment.anchor.end > comment.anchor.start)
    .sort((left, right) => left.anchor.start - right.anchor.start || left.anchor.end - right.anchor.end)
    .map((comment) => Decoration.mark({
      class: comment.author === 'ai' ? 'cm-review-highlight cm-review-highlight--ai' : 'cm-review-highlight',
      attributes: { 'data-review-id': comment.id, title: '查看批注' },
    }).range(comment.anchor.start, comment.anchor.end))
  return Decoration.set(ranges, true)
}

export const reviewDecorationField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (decorations, transaction) => {
    // 防御竞态：子组件 CodeMirror 受控 value 同步事务可能先于父组件清理 effect 执行，
    // 旧文档批注装饰位置会超出当前 changeset 长度，直接 map 抛 RangeError（Editor panel crashed）。
    // 映射前丢弃超出旧文档范围的装饰——这些本就是待清理的旧文件残留，丢弃与正常清理结果一致。
    const valid: Array<{ from: number; to: number; value: Decoration }> = []
    decorations.between(0, transaction.startState.doc.length, (from, to, value) => {
      valid.push({ from, to, value })
    })
    let next = Decoration.set(valid.map(({ from, to, value }) => value.range(from, to)), true).map(transaction.changes)
    for (const effect of transaction.effects) {
      if (effect.is(setReviewDecorations)) next = buildDecorations(effect.value)
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field),
})
