import { useEffect, useState } from 'react'
import type { BackupRecoveryCandidate, BackupSnapshotContent } from '../../../../shared/attachment-backup'
import { MdPreview } from '../editor/MdPreview'

export function RecoveryBar({ sourcePath }: { sourcePath: string | null }) {
  const [candidates, setCandidates] = useState<BackupRecoveryCandidate[]>([])
  const [preview, setPreview] = useState<BackupSnapshotContent | null>(null)
  useEffect(() => { setPreview(null); if (!sourcePath) { setCandidates([]); return }; void window.electronAPI.backup.recoveries(sourcePath).then((result) => setCandidates(result.success ? result.data ?? [] : [])) }, [sourcePath])
  if (candidates.length === 0) return null
  const latest = candidates[0]
  const discard = async (id: string) => { const result = await window.electronAPI.backup.discard(id); if (result.success) { setCandidates((items) => items.filter((item) => item.id !== id)); if (preview?.id === id) setPreview(null) } }
  return <div style={{ borderBottom: '1px solid var(--border-subtle)', padding: '7px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-panel)' }}>
    <span style={{ flex: 1 }}>发现 {candidates.length} 份可恢复内容，最近于 {new Date(latest.createdAt).toLocaleString()}</span>
    <button type="button" className="flux-btn-secondary" onClick={async () => { const result = await window.electronAPI.backup.read(latest.id); if (result.success) setPreview(result.data ?? null) }}>预览</button>
    <button type="button" className="flux-btn-secondary" onClick={() => void window.electronAPI.backup.saveAs({ snapshotId: latest.id, targetPath: '' })}>另存为</button>
    <button type="button" className="flux-btn-secondary" onClick={() => void discard(latest.id)}>丢弃</button>
    {preview && <div role="dialog" aria-label="恢复内容预览" style={{ position: 'fixed', zIndex: 50, inset: '12% 14%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', border: '2px solid var(--border-visible)', boxShadow: '0 16px 48px rgba(0, 0, 0, 0.32)', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}><strong>恢复内容预览</strong><button type="button" className="flux-btn-secondary" onClick={() => setPreview(null)}>关闭</button></div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <MdPreview content={preview.content} baseFilePath={sourcePath} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}><button type="button" className="flux-btn-secondary" onClick={() => void window.electronAPI.backup.saveAs({ snapshotId: preview.id, targetPath: '' })}>另存为</button><button type="button" className="flux-btn-secondary" onClick={() => void discard(preview.id)}>丢弃</button></div>
    </div>}
  </div>
}
