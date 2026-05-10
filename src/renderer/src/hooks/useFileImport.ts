import { useCallback } from 'react'
import { useFileStore } from '../stores/fileStore'

/**
 * Unified file import hook.
 *
 * Usage:
 *   const { importFile, importFiles } = useFileImport()
 *
 *   importFile()           — opens native file dialog
 *   importFiles(paths)     — imports files directly from provided paths (e.g., from drag-and-drop)
 */
export function useFileImport() {
  const openFile = useFileStore((s) => s.openFile)

  const importFile = useCallback(async () => {
    // No path → triggers native file dialog
    await openFile()
  }, [openFile])

  const importFiles = useCallback(
    async (paths: string[]) => {
      for (const filePath of paths) {
        // Pass path directly to skip the dialog
        await openFile(filePath)
      }
    },
    [openFile],
  )

  return { importFile, importFiles }
}
