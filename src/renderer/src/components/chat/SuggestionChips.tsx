import { useMemo, useCallback } from 'react'
import { useFileStore } from '../../stores/fileStore'
import { useEditorStore } from '../../stores/editorStore'
import type { EditorMode } from '../../stores/editorStore'

interface SuggestionChipsProps {
  onSelect: (text: string) => void
}

/** Default suggestions when no file type is detected */
const DEFAULT_SUGGESTIONS = ['帮我分析', '写一段代码', '解释概念']

/** Suggestion sets keyed by editor mode */
const MODE_SUGGESTIONS: Record<EditorMode, string[]> = {
  markdown: ['继续写这一节', '解释内容', '总结'],
  log: ['分析错误', '查找异常', '统计分布'],
  json: ['格式化', '验证结构', '解释字段'],
  text: ['帮我分析', '改进文本', '翻译内容'],
}

export function SuggestionChips({ onSelect }: SuggestionChipsProps) {
  const currentFile = useFileStore((s) => s.currentFile)
  const editorMode = useEditorStore((s) => s.mode)

  const suggestions = useMemo(() => {
    if (!currentFile) return DEFAULT_SUGGESTIONS

    // Deduce from the registered editor mode
    const forMode = MODE_SUGGESTIONS[editorMode]
    if (forMode) return forMode

    // Fallback: guess from file extension
    const ext = currentFile.split('.').pop()?.toLowerCase()
    switch (ext) {
      case 'md':
      case 'mdx':
        return MODE_SUGGESTIONS['markdown']
      case 'log':
      case 'txt':
        return MODE_SUGGESTIONS['log']
      case 'json':
      case 'jsonc':
        return MODE_SUGGESTIONS['json']
      default:
        return DEFAULT_SUGGESTIONS
    }
  }, [currentFile, editorMode])

  const handleClick = useCallback(
    (text: string) => {
      onSelect(text)
    },
    [onSelect],
  )

  return (
    <div className="flex flex-wrap items-center" style={{ gap: 6, padding: '0 16px 8px 16px' }}>
      {suggestions.map((s) => (
        <button
          key={s}
          onClick={() => handleClick(s)}
          className="transition-colors cursor-pointer"
          style={{
            padding: '6px 10px',
            borderRadius: 'var(--radius-sm)',
            fontSize: 11,
            fontFamily: 'var(--font-ui)',
            background: 'var(--bg-card)',
            color: 'var(--text-secondary)',
            border: 'none',
            lineHeight: 1.4,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--hover)'
            e.currentTarget.style.color = 'var(--text-primary)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--bg-card)'
            e.currentTarget.style.color = 'var(--text-secondary)'
          }}
        >
          {s}
        </button>
      ))}
    </div>
  )
}
