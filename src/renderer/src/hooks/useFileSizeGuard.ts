import { useCallback } from 'react'

const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024 // 10MB

export function useFileSizeGuard() {
  const isLargeFile = useCallback((sizeBytes: number): boolean => {
    return sizeBytes > LARGE_FILE_THRESHOLD
  }, [])

  return { isLargeFile, LARGE_FILE_THRESHOLD } as const
}
