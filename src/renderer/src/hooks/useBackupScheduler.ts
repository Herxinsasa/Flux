import { useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../stores/editorStore'

const SNAPSHOT_DELAY_MS = 60_000

/** Keeps a debounce per dirty document; snapshots never save or overwrite the source file. */
export function useBackupScheduler(): string | null {
  const sessions = useEditorStore((state) => state.documentSessions)
  const [warning, setWarning] = useState<string | null>(null)
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const warned = useRef(new Set<string>())

  useEffect(() => {
    const active = new Set(Object.keys(sessions))
    for (const [key, timer] of timers.current) {
      const session = sessions[key]
      if (!session?.dirty || !active.has(key)) { clearTimeout(timer); timers.current.delete(key) }
    }
    for (const [key, session] of Object.entries(sessions)) {
      if (!session.dirty || session.sampled || timers.current.has(key)) continue
      timers.current.set(key, setTimeout(() => {
        timers.current.delete(key)
        const current = useEditorStore.getState().documentSessions[key]
        if (!current?.dirty || current.sampled) return
        void window.electronAPI.backup.create({ sourcePath: current.filePath, content: current.draft, sourceVersion: current.snapshot?.version ?? null })
          .then((result) => { if (!result.success && !warned.current.has(key)) { warned.current.add(key); setWarning('自动备份暂时不可用，原文件未受影响') } })
          .catch(() => { if (!warned.current.has(key)) { warned.current.add(key); setWarning('自动备份暂时不可用，原文件未受影响') } })
      }, SNAPSHOT_DELAY_MS))
    }
  }, [sessions])

  useEffect(() => () => { for (const timer of timers.current.values()) clearTimeout(timer); timers.current.clear() }, [])
  return warning
}
