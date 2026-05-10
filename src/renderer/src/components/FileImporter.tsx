import { useEffect, type ReactNode } from 'react'

interface FileImporterProps {
  children: ReactNode
  onFilesDrop: (paths: string[]) => void
}

/**
 * Top-level component that intercepts window-level drag/drop events
 * to prevent the browser from opening dropped files, and instead
 * forwards them to the application's file import logic.
 *
 * This MUST wrap the app content to capture OS-level file drops
 * anywhere in the window.
 */
export function FileImporter({ children, onFilesDrop }: FileImporterProps) {
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault()
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy'
      }
    }

    const handleDrop = (e: DragEvent) => {
      e.preventDefault()

      // Skip if a child component (DropZone, FileTree) already handled this drop
      if ((e as any).__fluxDropHandled) return

      const droppedFiles = e.dataTransfer?.files
      if (!droppedFiles || droppedFiles.length === 0) return

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
        onFilesDrop(paths)
      }
    }

    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('drop', handleDrop)

    return () => {
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('drop', handleDrop)
    }
  }, [onFilesDrop])

  return <>{children}</>
}
