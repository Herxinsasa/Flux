import type { Message, ToolCallEntry } from '../../stores/chatStore'

export type ChatItem =
  | { type: 'message'; message: Message }
  | { type: 'tool-call'; toolCall: ToolCallEntry }

/** Virtuoso 每条外包一层，相邻选择器无效；用下边距分隔条目（像素） */
export function marginBottomAfterItem(items: ChatItem[], index: number): number {
  if (index < 0 || index >= items.length - 1) return 0
  const cur = items[index]
  const next = items[index + 1]

  if (cur.type === 'message' && next.type === 'message') {
    return cur.message.role !== next.message.role ? 14 : 10
  }
  if (cur.type === 'message' && next.type === 'tool-call') {
    return 6
  }
  if (cur.type === 'tool-call' && next.type === 'message') {
    return 12
  }
  if (cur.type === 'tool-call' && next.type === 'tool-call') {
    return 6
  }
  return 12
}
