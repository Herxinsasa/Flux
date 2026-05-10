import { useCallback, useState } from 'react'
import { useEditorStore } from '../stores/editorStore'

/**
 * Hook providing JSON format and compact operations.
 * Returns an `error` string that updates when the last operation fails.
 */
export function useJsonFormat() {
  const [error, setError] = useState<string | null>(null)
  const content = useEditorStore((s) => s.content)
  const setContent = useEditorStore((s) => s.setContent)

  /** Extract a line-number hint from a JSON SyntaxError message when possible. */
  const formatError = useCallback(
    (e: unknown): string => {
      if (e instanceof SyntaxError) {
        const msg = e.message
        const posMatch = msg.match(/position (\d+)/)
        if (posMatch) {
          const pos = parseInt(posMatch[1], 10)
          const line = content.slice(0, pos).split('\n').length
          return `第 ${line} 行附近：JSON 无效`
        }
        return `JSON 无效：${msg}`
      }
      return '未知错误'
    },
    [content],
  )

  const format = useCallback(() => {
    try {
      const obj = JSON.parse(content)
      setContent(JSON.stringify(obj, null, 2))
      setError(null)
    } catch (e) {
      setError(formatError(e))
    }
  }, [content, setContent, formatError])

  const compact = useCallback(() => {
    try {
      const obj = JSON.parse(content)
      setContent(JSON.stringify(obj))
      setError(null)
    } catch (e) {
      setError(formatError(e))
    }
  }, [content, setContent, formatError])

  const clearError = useCallback(() => setError(null), [])

  return { format, compact, error, clearError }
}
