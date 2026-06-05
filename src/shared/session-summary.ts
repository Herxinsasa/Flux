import { MAX_PINNED_FACT_CHARS } from './context-budget'

/**
 * Extract a concise pin candidate from an AI reply (prefer 执行摘要 section).
 */
export function extractPinCandidate(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return ''

  const summaryMatch = trimmed.match(
    /##\s*执行摘要[^\n]*\n+([\s\S]{0,800}?)(?=\n##|\n$|$)/i,
  )
  if (summaryMatch?.[1]?.trim()) {
    return summaryMatch[1].trim().replace(/\s+/g, ' ').slice(0, MAX_PINNED_FACT_CHARS)
  }

  const firstHeading = trimmed.match(/^#{1,3}\s+(.+)$/m)
  const firstPara = trimmed.split(/\n\n+/)[0]?.trim() ?? trimmed
  const candidate = firstHeading ? firstPara : firstPara.replace(/\s+/g, ' ')
  return candidate.slice(0, MAX_PINNED_FACT_CHARS)
}

export interface SessionSummaryFile {
  pinnedFacts: string[]
  workingSummary: string | null
}

const PINNED_HEADER = '## Pinned'
const SUMMARY_HEADER = '## Working Summary'

export function parseSessionSummaryMarkdown(raw: string): SessionSummaryFile {
  const pinnedFacts: string[] = []
  let workingSummary: string | null = null

  const pinnedIdx = raw.indexOf(PINNED_HEADER)
  const summaryIdx = raw.indexOf(SUMMARY_HEADER)

  if (pinnedIdx !== -1) {
    const end = summaryIdx !== -1 && summaryIdx > pinnedIdx ? summaryIdx : raw.length
    const section = raw.slice(pinnedIdx + PINNED_HEADER.length, end)
    for (const line of section.split('\n')) {
      const m = line.match(/^\s*[-*]\s+(.+)$/)
      if (m?.[1]?.trim()) pinnedFacts.push(m[1].trim())
    }
  }

  if (summaryIdx !== -1) {
    const body = raw.slice(summaryIdx + SUMMARY_HEADER.length).trim()
    workingSummary = body || null
  }

  return { pinnedFacts, workingSummary }
}

export function formatSessionSummaryMarkdown(data: SessionSummaryFile): string {
  const lines: string[] = [
    '# Flux Session Context',
    '_Auto-maintained by Flux. Pinned facts persist across new conversations in this workspace._',
    '',
    PINNED_HEADER,
  ]
  if (data.pinnedFacts.length === 0) {
    lines.push('- (none)')
  } else {
    for (const f of data.pinnedFacts) {
      lines.push(`- ${f.replace(/\n/g, ' ')}`)
    }
  }
  lines.push('', SUMMARY_HEADER)
  lines.push(data.workingSummary?.trim() || '(none)')
  lines.push('')
  return lines.join('\n')
}
