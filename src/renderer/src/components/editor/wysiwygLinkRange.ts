import type { Mark, MarkType, Node as ProseMirrorNode } from '@milkdown/kit/prose/model'

export interface WysiwygLinkRange {
  from: number
  to: number
  href: string
  text: string
}

/**
 * 查找与选区/光标相交的 link mark 范围。
 * 先按“连续且同 href 的文本节点”分组，再取与选区相交的完整分组，
 * 因此光标落在链接中间的某个文本节点时，也能向前、向后扩展出整段链接。
 */
export function findWysiwygLinkRange(
  doc: ProseMirrorNode,
  from: number,
  to: number,
  linkType: MarkType,
): WysiwygLinkRange | null {
  const start = Math.min(from, to)
  const end = Math.max(from, to)
  const collapsed = start === end
  const segments: WysiwygLinkRange[] = []
  let current: WysiwygLinkRange | null = null

  doc.nodesBetween(0, doc.content.size, (node, pos) => {
    if (!node.isText) {
      current = null
      return true
    }
    const link = node.marks.find((mark) => mark.type === linkType)
    if (!link) {
      current = null
      return true
    }

    const nodeFrom = pos
    const nodeTo = pos + node.nodeSize
    const nodeHref = typeof link.attrs.href === 'string' ? link.attrs.href : ''
    if (current && nodeFrom === current.to && nodeHref === current.href) {
      current.to = nodeTo
      current.text = doc.textBetween(current.from, current.to, '\n')
    } else {
      current = {
        from: nodeFrom,
        to: nodeTo,
        href: nodeHref,
        text: doc.textBetween(nodeFrom, nodeTo, '\n'),
      }
      segments.push(current)
    }
    return true
  })

  for (const segment of segments) {
    const intersects = collapsed
      ? start >= segment.from && start < segment.to
      : start < segment.to && end > segment.from
    if (intersects) return segment
  }
  return null
}

/**
 * 取链接范围内第一个带非 link mark 的文本节点的 marks，用于文本改动时尽量保留
 * 原有格式（粗体、斜体、行内代码等）。若整段链接都没有其他格式，则返回空数组。
 */
export function collectLinkTextMarks(
  doc: ProseMirrorNode,
  from: number,
  to: number,
  linkType: MarkType,
): readonly Mark[] {
  let marks: readonly Mark[] = []
  doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return true
    const otherMarks = node.marks.filter((mark) => mark.type !== linkType)
    if (otherMarks.length > 0) {
      marks = otherMarks
      return false
    }
    return true
  })
  return marks
}

/** 选区/光标是否落在图片节点上；图片无法安全替换为文本链接。 */
export function selectionContainsImage(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): boolean {
  const start = Math.min(from, to)
  const end = Math.max(from, to)
  let found = false
  doc.nodesBetween(start, end, (node) => {
    if (node.type.name === 'image') {
      found = true
      return false
    }
    return true
  })
  return found
}
