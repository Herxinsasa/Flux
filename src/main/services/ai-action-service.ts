import store from '../store'
import log from '../logger'
import { createClient, type ProviderClient } from '../agent/provider-router'
import {
  buildDocumentReviewPrompt,
  buildSelectionActionPrompt,
  type AiActionRequest,
  type AiActionRunResult,
} from '../../shared/ai-action'
import { AiActionError } from './ai-action-error'

interface ActiveAction {
  requestId: string
  client: ProviderClient
  cancelled: boolean
}

const activeActions = new Map<string, ActiveAction>()

function actionKey(sourcePath: string): string {
  return sourcePath.replace(/\\/g, '/').toLowerCase()
}

export async function runAiAction(request: AiActionRequest): Promise<AiActionRunResult> {
  const key = actionKey(request.sourcePath)
  if (activeActions.has(key)) throw new AiActionError('INVALID_DATA', '该文档已有 AI 操作正在执行')
  const prompt = request.kind === 'selection'
    ? buildSelectionActionPrompt(request)
    : buildDocumentReviewPrompt(request)
  const providerId = store.get('activeProvider')
  if (!providerId) throw new AiActionError('INVALID_DATA', '请先在设置中配置并启用 AI 提供商')
  const provider = store.get('providers').find((item) => item.id === providerId)
  if (!provider) throw new AiActionError('INVALID_DATA', '当前 AI 提供商不可用，请检查设置')
  const client = createClient(providerId)
  const active: ActiveAction = { requestId: request.requestId, client, cancelled: false }
  activeActions.set(key, active)
  let rawText = ''
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    active.cancelled = true
    client.abort()
  }, 120_000)
  try {
    log.info('[ai-action] start', {
      requestId: request.requestId,
      kind: request.kind,
      sourceHash: request.sourceHash,
      inputChars: request.kind === 'selection' ? request.selectedText.length : request.sourceContent.length,
    })
    for await (const event of client.chat({
      model: provider.model,
      messages: [{ role: 'user', content: prompt.user }],
      system: prompt.system,
      tools: [],
      maxTokens: request.kind === 'selection' ? 4096 : 6144,
    })) {
      if (active.cancelled) {
        throw new AiActionError(timedOut ? 'TIMEOUT' : 'CANCELLED', timedOut ? 'AI 操作超时，请重试' : 'AI 操作已取消')
      }
      if (event.type === 'text_delta') rawText += event.text
      if (event.type === 'error') throw new AiActionError('IO_ERROR', event.message)
    }
    if (active.cancelled) {
      throw new AiActionError(timedOut ? 'TIMEOUT' : 'CANCELLED', timedOut ? 'AI 操作超时，请重试' : 'AI 操作已取消')
    }
    if (!rawText.trim()) throw new AiActionError('IO_ERROR', 'AI 未返回可用内容，请重试')
    return {
      requestId: request.requestId,
      rawText: rawText.trim(),
      coverage: request.kind === 'document-review' ? prompt.coverage : undefined,
    }
  } finally {
    clearTimeout(timeout)
    if (activeActions.get(key) === active) activeActions.delete(key)
  }
}

export function cancelAiAction(sourcePath: string, requestId: string): boolean {
  const active = activeActions.get(actionKey(sourcePath))
  if (!active || active.requestId !== requestId) return false
  active.cancelled = true
  active.client.abort()
  return true
}
