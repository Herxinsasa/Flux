export type MarkdownCommandId =
  | 'quote-ai'
  | 'comment'
  | 'bold'
  | 'italic'
  | 'inline-code'
  | 'blockquote'
  | 'ordered-list'
  | 'unordered-list'
  | 'task-list'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5'
  | 'insert-link'
  | 'insert-image'
  | 'insert-table'
  | 'insert-toc'
  | 'insert-code-block'
  | 'insert-divider'

export interface MarkdownCommandItem {
  id: MarkdownCommandId
  label: string
  needsSelection?: boolean
}

export interface MarkdownCommandGroup {
  label: '样式' | '段落' | '插入'
  items: MarkdownCommandItem[]
}

export const MARKDOWN_COMMAND_GROUPS: MarkdownCommandGroup[] = [
  {
    label: '样式',
    items: [
      { id: 'bold', label: '粗体', needsSelection: true },
      { id: 'italic', label: '斜体', needsSelection: true },
      { id: 'inline-code', label: '代码', needsSelection: true },
      { id: 'blockquote', label: '引用', needsSelection: true },
      { id: 'ordered-list', label: '有序列表', needsSelection: true },
      { id: 'unordered-list', label: '无序列表', needsSelection: true },
      { id: 'task-list', label: '任务列表', needsSelection: true },
    ],
  },
  {
    label: '段落',
    items: [1, 2, 3, 4, 5].map((level) => ({
      id: `heading-${level}` as MarkdownCommandId,
      label: `${['一', '二', '三', '四', '五'][level - 1]}级标题`,
    })),
  },
  {
    label: '插入',
    items: [
      { id: 'insert-link', label: '链接' },
      { id: 'insert-image', label: '图片' },
      { id: 'insert-table', label: '表格' },
      { id: 'insert-toc', label: '目录' },
      { id: 'insert-code-block', label: '代码块' },
      { id: 'insert-divider', label: '分割线' },
    ],
  },
]
