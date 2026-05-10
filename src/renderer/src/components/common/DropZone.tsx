import { useCallback, useRef, useState } from 'react'
import { useFileImport } from '../../hooks/useFileImport'

export function DropZone() {
  const { importFile, importFiles } = useFileImport()
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounter = useRef(0)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setIsDragOver(false)
    }
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      // Signal to FileImporter's window-level handler that this drop was already handled
      ;(e.nativeEvent as any).__fluxDropHandled = true
      dragCounter.current = 0
      setIsDragOver(false)

      const droppedFiles = e.dataTransfer.files
      if (droppedFiles.length === 0) return

      // Convert File objects to file system paths via Electron webUtils
      const paths: string[] = []
      for (let i = 0; i < droppedFiles.length; i++) {
        try {
          const path = window.electronAPI.file.getFilePath(droppedFiles[i])
          if (path) paths.push(path)
        } catch {
          // Skip files that can't be resolved
        }
      }

      if (paths.length > 0) {
        await importFiles(paths)
      }
    },
    [importFiles],
  )

  const handleClick = useCallback(() => {
    importFile()
  }, [importFile])

  return (
    <div
      className={`flex-1 flex items-center justify-center m-4 rounded-xl border-2 border-dashed transition-all duration-[var(--transition-fast)] cursor-pointer select-none ${
        isDragOver
          ? 'border-[var(--accent)] bg-[var(--accent)]/10'
          : 'border-[var(--border-subtle)] hover:border-[var(--text-hint)]'
      }`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      <div className="flex flex-col items-center gap-3 text-center px-8">
        {/* Icon: downward arrow into a bracket */}
        <svg
          width="48"
          height="48"
          viewBox="0 0 48 48"
          fill="none"
          className={isDragOver ? 'text-[var(--accent)]' : 'text-[var(--text-hint)]'}
        >
          <rect
            x="8"
            y="6"
            width="32"
            height="36"
            rx="4"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
          />
          <path
            d="M24 18v12M18 26l6 6 6-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        <div>
          <p className={`text-sm leading-relaxed ${isDragOver ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}>
            拖拽文件到此处
          </p>
          <p className="text-xs text-[var(--text-hint)] mt-1">
            或点击选择文件
          </p>
        </div>

        <p className="text-[11px] text-[var(--text-tertiary)] mt-2">
          支持 .md .json .log .txt .csv .xml .yaml 以及代码文件
        </p>
      </div>
    </div>
  )
}
