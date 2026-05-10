import { useEffect, useState } from 'react'

interface ReportExportProps {
  /** The markdown content to export */
  content: string
  /** Default filename shown in the save dialog */
  defaultName?: string
}

export function ReportExport({ content, defaultName = 'analysis-report.md' }: ReportExportProps) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [savedPath, setSavedPath] = useState<string | null>(null)

  useEffect(() => {
    if (status !== 'saved') return
    const timer = window.setTimeout(() => {
      setStatus('idle')
      setSavedPath(null)
    }, 2000)
    return () => window.clearTimeout(timer)
  }, [status])

  const handleExport = async () => {
    setStatus('saving')
    try {
      const result = await window.electronAPI.export.report(content, defaultName)
      if (result.success && result.data) {
        setSavedPath(result.data)
        setStatus('saved')
      } else {
        setStatus('idle')
      }
    } catch {
      setStatus('idle')
    }
  }

  if (status === 'saved' && savedPath) {
    return (
      <div className="report-export report-export--saved">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
        <span>
          报告已保存至 {savedPath}
        </span>
      </div>
    )
  }

  return (
    <div className="report-export">
      <button
        className="report-export-btn"
        onClick={handleExport}
        disabled={status === 'saving'}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        {status === 'saving' ? '导出中...' : '导出报告'}
      </button>
    </div>
  )
}
