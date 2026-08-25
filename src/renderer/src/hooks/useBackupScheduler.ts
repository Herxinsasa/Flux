import { useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../stores/editorStore'

const SNAPSHOT_DELAY_MS = 30_000

interface ScheduledSnapshot {
  timer: ReturnType<typeof setTimeout>
  editGeneration: number
}

/** Keeps a debounce per dirty document; snapshots never save or overwrite the source file. */
export function useBackupScheduler(): string | null {
  const sessions = useEditorStore((state) => state.documentSessions)
  const [warning, setWarning] = useState<string | null>(null)
  const timers = useRef(new Map<string, ScheduledSnapshot>())
  const warned = useRef(new Set<string>())

  useEffect(() => {
    const active = new Set(Object.keys(sessions))
    for (const [key, scheduled] of timers.current) {
      const session = sessions[key]
      if (!session?.dirty || !active.has(key)) { clearTimeout(scheduled.timer); timers.current.delete(key) }
    }
    for (const [key, session] of Object.entries(sessions)) {
      if (!session.dirty || session.sampled) continue
      const editGeneration = session.editGeneration ?? 0
      const previous = timers.current.get(key)
      if (previous?.editGeneration === editGeneration) continue
      if (previous) clearTimeout(previous.timer)
      const timer = setTimeout(() => {
        timers.current.delete(key)
        const current = useEditorStore.getState().documentSessions[key]
        if (!current?.dirty || current.sampled || (current.editGeneration ?? 0) !== editGeneration) return
        void window.electronAPI.backup.create({ sourcePath: current.filePath, content: current.draft, sourceVersion: current.snapshot?.version ?? null })
          .then((result) => { if (!result.success && !warned.current.has(key)) { warned.current.add(key); setWarning('自动备份暂时不可用，原文件未受影响') } })
          .catch(() => { if (!warned.current.has(key)) { warned.current.add(key); setWarning('自动备份暂时不可用，原文件未受影响') } })
      }, SNAPSHOT_DELAY_MS)
      timers.current.set(key, { timer, editGeneration })
    }
  }, [sessions])

  useEffect(() => () => { for (const scheduled of timers.current.values()) clearTimeout(scheduled.timer); timers.current.clear() }, [])
  return warning
}
