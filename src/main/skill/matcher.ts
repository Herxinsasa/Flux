import fs from 'fs'
import path from 'path'
import { SkillManager, assessSkillValidity, formatSkillBundleAppendix } from './skill-manager'
import type { Skill } from '../../shared/types'
import log from '../logger'

/* ------------------------------------------------------------------ */
/*  Keyword matching heuristics                                         */
/* ------------------------------------------------------------------ */

/**
 * Score a skill against the user's input.
 * Returns a relevance score: higher = more relevant.
 *   1 point per exact keyword match
 *   0.5 point per partial/substring keyword match
 *   0 points = no match
 */
function scoreSkill(skill: Skill, userInput: string): number {
  const lowerInput = userInput.toLowerCase()
  let score = 0

  for (const kw of skill.keywords) {
    const lowerKw = kw.toLowerCase()
    if (lowerInput.includes(lowerKw)) {
      // Bonus for whole-word match
      const wordBoundaryStart =
        lowerInput.indexOf(lowerKw) === 0 ||
        /[\s,.:;!?，。：；！？、]/.test(lowerInput[lowerInput.indexOf(lowerKw) - 1] ?? ' ')
      const wordBoundaryEnd =
        lowerInput.indexOf(lowerKw) + lowerKw.length === lowerInput.length ||
        /[\s,.:;!?，。：；！？、]/.test(
          lowerInput[lowerInput.indexOf(lowerKw) + lowerKw.length] ?? ' ',
        )
      if (wordBoundaryStart && wordBoundaryEnd) {
        score += 1
      } else {
        score += 0.5
      }
    }
  }

  return score
}

function passesIntentGate(skill: Skill, userInput: string): boolean {
  if (skill.name !== 'analysis-report') return true

  const normalized = userInput.toLowerCase()

  // 仅当用户明确表达“要产出报告交付物”才触发，避免“导出报告按钮/路径”等 UI 语境误触发。
  const explicitReportIntent =
    /(输出|生成|撰写|整理|给我|请|帮我).{0,10}(分析报告|正式报告|markdown\s*报告|结构化报告|报告)/i.test(normalized) ||
    /(分析结果|结论).{0,10}(做成|整理成|写成).{0,10}(报告|文档)/i.test(normalized) ||
    /(导出).{0,8}(分析报告|正式报告|markdown\s*报告|结构化报告)/i.test(normalized)

  if (explicitReportIntent) return true

  // 兜底：如果明显是 UI/交互问题描述，不触发报告 Skill。
  const uiOrBugContext = /(按钮|窗口|路径|显示|消失|滚动条|卡片|对话窗口|自动|报错|bug|异常|修复)/i.test(normalized)
  if (uiOrBugContext) return false

  return false
}

/* ------------------------------------------------------------------ */
/*  Matching API                                                       */
/* ------------------------------------------------------------------ */

const MIN_SCORE_THRESHOLD = 0.5

function tryLoadWorkspaceExplicitSkill(name: string, workspaceRoot?: string | null): Skill | null {
  if (!workspaceRoot) return null

  const normalized = name.replace(/^\//, '').trim()
  if (!normalized) return null

  const candidates = [
    path.join(workspaceRoot, '.claude', 'skills', normalized, 'SKILL.md'),
    path.join(workspaceRoot, 'skills', normalized, 'SKILL.md'),
    path.join(workspaceRoot, 'skills', `${normalized}.md`),
  ]

  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue
      const raw = fs.readFileSync(filePath, 'utf-8')
      const body = raw.replace(/^---[\s\S]*?---\s*/m, '').trim()
      if (!body) continue
      return {
        name: normalized,
        description: `Workspace skill from ${path.relative(workspaceRoot, filePath).replace(/\\/g, '/')}`,
        keywords: [normalized],
        builtin: false,
        enabled: true,
        source: 'user',
        filePath,
        contentRoot: path.dirname(filePath),
        content: body,
      }
    } catch {
      continue
    }
  }

  return null
}

/**
 * Find enabled skills that match the user's input via keyword matching.
 */
export function matchSkills(userInput: string): Skill[] {
  const manager = SkillManager.getInstance()
  const enabled = manager.getEnabledSkills()

  if (!userInput || enabled.length === 0) return []

  const scored = enabled
    .filter((skill) => passesIntentGate(skill, userInput))
    .map((skill) => ({ skill, score: scoreSkill(skill, userInput) }))
    .filter(({ score }) => score >= MIN_SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score)

  if (scored.length > 0) {
    log.info(
      `SkillMatcher: matched ${scored.length} skill(s) for input "${userInput.slice(0, 80)}"`,
    )
  }

  return scored.map(({ skill }) => skill)
}

/* ------------------------------------------------------------------ */
/*  System prompt builder                                               */
/* ------------------------------------------------------------------ */

/** 将匹配到的 Skill 正文并入系统提示（无额外引导语）。 */
export function buildSkillSystemPrompt(
  userInput: string,
  currentSystemPrompt: string,
  opts?: { explicitSkillNames?: string[]; workspaceRoot?: string | null },
): {
  systemPrompt: string
  activeSkills: string[]
  invalidMatchedSkills: string[]
  unresolvedExplicitSkills: string[]
} {
  const manager = SkillManager.getInstance()
  const explicitNames = opts?.explicitSkillNames ?? []
  const allSkills = manager.list()
  const explicitSkills: Skill[] = []
  const unresolvedExplicitSkills: string[] = []
  for (const n of explicitNames) {
    const normalized = n.replace(/^\//, '').trim()
    let sk = manager.get(normalized)
    if (!sk) {
      const hit = allSkills.find((m) => m.name.toLowerCase() === normalized.toLowerCase())
      if (hit) sk = manager.get(hit.name)
    }
    if (!sk) {
      sk = tryLoadWorkspaceExplicitSkill(normalized, opts?.workspaceRoot)
    }
    if (sk) {
      explicitSkills.push(sk)
    } else {
      unresolvedExplicitSkills.push(normalized)
    }
  }

  const matched = matchSkills(userInput)
  const byName = new Map<string, Skill>()
  for (const s of explicitSkills) {
    byName.set(s.name, s)
  }
  for (const s of matched) {
    if (!byName.has(s.name)) byName.set(s.name, s)
  }

  const merged = Array.from(byName.values())

  const invalidMatchedSkills: string[] = []
  const validMerged: Skill[] = []
  for (const s of merged) {
    const validity = assessSkillValidity(s)
    if (validity.invalid) {
      invalidMatchedSkills.push(s.name)
      continue
    }
    validMerged.push(s)
  }

  if (validMerged.length === 0) {
    return {
      systemPrompt: currentSystemPrompt,
      activeSkills: [],
      invalidMatchedSkills,
      unresolvedExplicitSkills,
    }
  }

  const activeSkills = validMerged.map((s) => s.name)

  const skillBlocks: string[] = []

  for (const skill of validMerged) {
    skillBlocks.push(`### Skill: ${skill.name}`)
    skillBlocks.push(`Description: ${skill.description}`)
    skillBlocks.push('')
    skillBlocks.push(skill.content)
    skillBlocks.push('')
    const bundle = formatSkillBundleAppendix(skill)
    if (bundle) {
      skillBlocks.push(bundle)
      skillBlocks.push('')
    }
  }

  const augmentedPrompt = currentSystemPrompt + '\n' + skillBlocks.join('\n')

  return { systemPrompt: augmentedPrompt, activeSkills, invalidMatchedSkills, unresolvedExplicitSkills }
}
