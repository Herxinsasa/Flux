import { useEffect, useMemo, useState } from 'react'
import { Check, Download, LocateFixed, LoaderCircle, MessageSquareReply, Pencil, Sparkles, Square, Trash2, X } from 'lucide-react'
import { createReviewAnchor, hashReviewSource, type ReviewComment, type ReviewExportFormat, type ReviewExportPresentation, type ReviewExportScope, type ReviewParticipantRole } from '../../../../shared/review'
import { useFileStore } from '../../stores/fileStore'
import { normalizeDocumentPath, useEditorStore } from '../../stores/editorStore'
import { useReviewStore } from '../../stores/reviewStore'
import { useAiActionStore } from '../../stores/aiActionStore'
import { FluxToast, type FluxToastState } from '../common/FluxToast'

const CATEGORY_LABEL = { logic: '逻辑', ambiguity: '歧义', format: '格式', language: '语言' } as const
const SEVERITY_LABEL = { info: '提示', warning: '注意', error: '严重' } as const

function PendingAiReview({ filePath, content }: { filePath: string; content: string }) {
  const state = useAiActionStore((store) => store.reviews[normalizeDocumentPath(filePath)])
  if (!state) return null
  const retry = () => {
    const editor = useEditorStore.getState()
    const session = editor.activeDocumentPath ? editor.documentSessions[editor.activeDocumentPath] : undefined
    void useAiActionStore.getState().runDocumentReview(filePath, content, session?.snapshot?.version ?? null)
  }
  const accept = async (ids: string[]) => {
    const current = useAiActionStore.getState().reviews[normalizeDocumentPath(filePath)]
    if (!current || hashReviewSource(content) !== current.request.sourceHash) {
      window.alert('文档内容已变化，请重新审阅')
      return
    }
    const selected = current.findings.filter((finding) => ids.includes(finding.id) && current.decisions[finding.id] === 'pending' && finding.locatable && finding.start !== undefined && finding.end !== undefined)
    const comments = selected.flatMap((finding) => {
      const anchor = createReviewAnchor(content, finding.start!, finding.end!)
      if (!anchor) return []
      return [{ anchor, body: finding.suggestion ? `${finding.comment}\n建议：${finding.suggestion}` : finding.comment }]
    })
    if (comments.length === 0) return
    if (await useReviewStore.getState().addAiComments(filePath, content, comments)) {
      useAiActionStore.getState().decideFindings(filePath, selected.map((finding) => finding.id), 'accepted')
    }
  }
  if (state.status === 'running') return <section className="ai-review-pending"><div className="ai-review-status"><LoaderCircle className="spin" size={15} />正在审阅<button type="button" title="停止审阅" onClick={() => void useAiActionStore.getState().cancelDocumentReview(filePath)}><Square size={13} /></button></div></section>
  if (state.status === 'error') return <section className="ai-review-pending"><p className="review-error">{state.error}</p><button type="button" onClick={retry}>重试</button></section>
  if (state.parseError) return <section className="ai-review-pending"><p className="review-error">{state.parseError}</p><pre className="ai-review-raw">{state.rawText}</pre><button type="button" onClick={retry}>重新审阅</button></section>
  const pending = state.findings.filter((finding) => state.decisions[finding.id] === 'pending' && finding.locatable)
  return <section className="ai-review-pending">
    <div className="ai-review-heading"><strong>AI 待确认 {pending.length}</strong>{pending.length > 0 && <button type="button" onClick={() => void accept(pending.map((finding) => finding.id))}>全部接受</button>}</div>
    {state.coverage && <p className="ai-review-coverage">{state.coverage}</p>}
    {state.findings.length === 0 && <p className="review-empty">未发现明确问题</p>}
    {state.findings.map((finding) => {
      const decision = state.decisions[finding.id]
      return <article key={finding.id} className={`ai-review-finding ai-review-finding--${finding.severity}`}>
        <div><span>{SEVERITY_LABEL[finding.severity]} · {CATEGORY_LABEL[finding.category]}</span><span>{decision === 'accepted' ? '已接受' : decision === 'rejected' ? '已忽略' : finding.locatable ? '待确认' : '位置无效'}</span></div>
        <blockquote>{finding.quote}</blockquote><p>{finding.comment}</p>{finding.suggestion && <p className="ai-review-suggestion">建议：{finding.suggestion}</p>}
        {decision === 'pending' && <div className="ai-review-actions"><button type="button" disabled={!finding.locatable} onClick={() => void accept([finding.id])}>接受</button><button type="button" onClick={() => useAiActionStore.getState().decideFindings(filePath, [finding.id], 'rejected')}>忽略</button></div>}
      </article>
    })}
  </section>
}

function ReviewItem({ comment, filePath, content }: { comment: ReviewComment; filePath: string; content: string }) {
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(comment.body)
  const [replyBody, setReplyBody] = useState('')
  const [replyRole, setReplyRole] = useState<ReviewParticipantRole>('modifier')
  const [replying, setReplying] = useState(false)
  const [savingReply, setSavingReply] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const active = useReviewStore((state) => state.activeCommentId === comment.id)
  const update = (patch: Partial<Pick<ReviewComment, 'body' | 'status' | 'anchor' | 'anchorStatus'>>) =>
    useReviewStore.getState().updateComment(filePath, content, comment.id, patch)
  const locate = () => {
    // 双击跳转：留在当前编辑面定位（源码面用 anchor 位置、编辑面用 quote 匹配），
    // requestLocate 递增 tick，即使目标批注与当前相同也会强制重新定位
    useReviewStore.getState().requestLocate(comment.id)
  }
  const select = () => useReviewStore.getState().setActiveCommentId(comment.id)
  const reattach = () => {
    const state = useEditorStore.getState()
    const selection = state.activeDocumentPath ? state.documentSessions[state.activeDocumentPath]?.selection : undefined
    if (selection && selection.from !== selection.to) void useReviewStore.getState().reattachComment(filePath, content, comment.id, selection.from, selection.to)
  }
  return <article data-review-comment-id={comment.id} className={`review-item${active ? ' review-item--active' : ''}`} onClick={select} onDoubleClick={locate}>
    <div className="review-quote">{comment.anchorStatus === 'orphaned' ? '位置已失效' : `“${comment.anchor.quote}”`}</div>
    <div className="review-author-label">评审人{comment.author === 'ai' ? ' · AI' : ''}</div>
    {editing ? <textarea autoFocus value={body} onClick={(event) => event.stopPropagation()} onChange={(event) => setBody(event.target.value)} /> : <p>{comment.body}</p>}
    {(comment.replies ?? []).length > 0 && <div className="review-replies">{(comment.replies ?? []).map((reply) => <div className={`review-reply review-reply--${reply.role}`} key={reply.id}><span>{reply.role === 'reviewer' ? '评审人' : '修改人'}</span><p>{reply.body}</p></div>)}</div>}
    {replying && <div className="review-reply-composer" onClick={(event) => event.stopPropagation()}>
      <div className="review-role-switch" aria-label="回复身份"><button type="button" aria-pressed={replyRole === 'modifier'} onClick={() => setReplyRole('modifier')}>修改人</button><button type="button" aria-pressed={replyRole === 'reviewer'} onClick={() => setReplyRole('reviewer')}>评审人</button></div>
      <textarea autoFocus value={replyBody} placeholder="输入回复" onChange={(event) => setReplyBody(event.target.value)} />
      <div><button type="button" onClick={() => { setReplying(false); setReplyBody('') }}>取消</button><button type="button" disabled={!replyBody.trim() || savingReply} onClick={() => { setSavingReply(true); void useReviewStore.getState().addReply(filePath, content, comment.id, replyBody, replyRole).then((ok) => { if (ok) { setReplyBody(''); setReplying(false) } }).finally(() => setSavingReply(false)) }}>{savingReply ? '保存中…' : '回复'}</button></div>
    </div>}
    <div className="review-meta"><span>{comment.status === 'resolved' ? '已解决' : '未解决'}</span><div className="review-actions">
      {comment.anchorStatus === 'orphaned' && <button type="button" title="用当前选区重新定位" onClick={(event) => { event.stopPropagation(); reattach() }}><LocateFixed size={14} /></button>}
      {editing ? <button type="button" title="保存修改" disabled={!body.trim()} onClick={(event) => { event.stopPropagation(); void update({ body: body.trim() }).then((ok) => ok && setEditing(false)) }}><Check size={14} /></button> : <button type="button" title="编辑批注" onClick={(event) => { event.stopPropagation(); setEditing(true) }}><Pencil size={14} /></button>}
      <button type="button" title="回复批注" onClick={(event) => { event.stopPropagation(); setReplying((value) => !value) }}><MessageSquareReply size={14} /></button>
      <button type="button" title={comment.status === 'open' ? '标记已解决' : '重新打开'} onClick={(event) => { event.stopPropagation(); void update({ status: comment.status === 'open' ? 'resolved' : 'open' }) }}><Check size={14} /></button>
      {confirmingDelete ? <span className="review-delete-confirm" onClick={(event) => event.stopPropagation()}>
        <span>确认删除？</span>
        <button type="button" onClick={() => setConfirmingDelete(false)}>取消</button>
        <button type="button" onClick={() => { void useReviewStore.getState().deleteComment(filePath, content, comment.id) }}>删除</button>
      </span> : <button type="button" title="删除批注" onClick={(event) => { event.stopPropagation(); setConfirmingDelete(true) }}><Trash2 size={14} /></button>}
    </div></div>
  </article>
}

export function ReviewPanel() {
  const filePath = useFileStore((state) => state.currentFile)
  const content = useEditorStore((state) => state.content)
  const filter = useReviewStore((state) => state.filter)
  const reviewDocument = useReviewStore((state) => filePath ? state.documents[normalizeDocumentPath(filePath)] : undefined)
  const [exportOpen, setExportOpen] = useState(false)
  const [format, setFormat] = useState<ReviewExportFormat>('markdown')
  const [presentation, setPresentation] = useState<ReviewExportPresentation>('footnotes')
  const [scope, setScope] = useState<ReviewExportScope>('all')
  const [exporting, setExporting] = useState(false)
  const [exportToast, setExportToast] = useState<FluxToastState | null>(null)
  const activeCommentId = useReviewStore((state) => state.activeCommentId)
  const comments = useMemo(() => (reviewDocument?.sidecar.comments ?? []).filter((comment) => filter === 'all' || comment.status === 'open'), [reviewDocument?.sidecar.comments, filter])
  const exportReview = async () => {
    if (!filePath) return
    setExporting(true)
    const savedPath = await useReviewStore.getState().exportDocument(filePath, content, format, presentation, scope)
    setExporting(false)
    if (savedPath) {
      // 导出成功统一走气泡提示，样式与其它 toast 一致
      setExportToast({ message: `批注已导出：${savedPath}`, variant: 'success' })
    }
  }
  const runAiReview = () => {
    if (!filePath) return
    const editor = useEditorStore.getState()
    const session = editor.activeDocumentPath ? editor.documentSessions[editor.activeDocumentPath] : undefined
    void useAiActionStore.getState().runDocumentReview(filePath, content, session?.snapshot?.version ?? null)
  }
  useEffect(() => {
    if (!activeCommentId) return
    document.querySelector<HTMLElement>(`[data-review-comment-id="${CSS.escape(activeCommentId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeCommentId])
  return <aside className="review-panel" aria-label="批注侧栏">
    <header><strong>批注 {reviewDocument?.sidecar.comments.length ?? 0}</strong><div><button type="button" title="AI 审阅暂未开放" disabled onClick={runAiReview}><Sparkles size={15} /></button><button type="button" title="导出批注" onClick={() => setExportOpen((value) => !value)}><Download size={15} /></button><button type="button" title="关闭批注" onClick={() => useReviewStore.getState().closePanel()}><X size={15} /></button></div></header>
    <div className="review-filter"><button type="button" aria-pressed={filter === 'open'} onClick={() => useReviewStore.getState().setFilter('open')}>未解决</button><button type="button" aria-pressed={filter === 'all'} onClick={() => useReviewStore.getState().setFilter('all')}>全部</button></div>
    {exportOpen && <div className="review-export-form">
      <label>格式<select value={format} onChange={(event) => setFormat(event.target.value as ReviewExportFormat)}><option value="markdown">Markdown</option><option value="html">HTML</option></select></label>
      <label>呈现<select value={presentation} disabled={format === 'html'} onChange={(event) => setPresentation(event.target.value as ReviewExportPresentation)}><option value="footnotes">脚注式</option><option value="end-list">文末清单</option></select></label>
      <label>范围<select value={scope} onChange={(event) => setScope(event.target.value as ReviewExportScope)}><option value="all">全部</option><option value="open">未解决</option></select></label>
      <button type="button" disabled={exporting} onClick={() => void exportReview()}>{exporting ? '导出中…' : '导出'}</button>
    </div>}
    {exportToast && <FluxToast toast={exportToast} onDismiss={() => setExportToast(null)} />}
    {reviewDocument?.error && <div className="review-error">{reviewDocument.error}</div>}
    <div className="review-list flux-scroll">{!filePath ? <p className="review-empty">未打开文档</p> : reviewDocument?.loading ? <p className="review-empty">正在加载批注…</p> : comments.length === 0 ? <p className="review-empty">暂无批注</p> : comments.map((comment) => <ReviewItem key={comment.id} comment={comment} filePath={filePath} content={content} />)}</div>
  </aside>
}
