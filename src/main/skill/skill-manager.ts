import * as fs from 'fs'
import * as path from 'path'
import log from '../logger'
import { getBuiltinSkillsDir, getUserSkillPackagesDir, getUserSkillsRoot } from '../paths'
import type { Skill, SkillMeta } from '../../shared/types'

/* ------------------------------------------------------------------ */
/*  YAML frontmatter parser (simple, no js-yaml dependency)             */
/* ------------------------------------------------------------------ */

interface Frontmatter {
  name?: string
  description?: string
  keywords?: string[]
}

export function assessSkillValidity(skill: Skill): { invalid: boolean; reason?: string } {
  try {
    if (skill.contentRoot) {
      if (!fs.existsSync(skill.contentRoot)) {
        return { invalid: true, reason: '资源目录缺失' }
      }
      const st = fs.statSync(skill.contentRoot)
      if (!st.isDirectory()) {
        return { invalid: true, reason: '资源目录无效' }
      }
    }

    if (!fs.existsSync(skill.filePath)) {
      return { invalid: true, reason: '入口文件缺失' }
    }

    return { invalid: false }
  } catch {
    return { invalid: true, reason: '资源不可访问' }
  }
}

function parseFrontmatter(content: string): { meta: Frontmatter; body: string } {
  const lines = content.split(/\r?\n/)
  if (lines.length === 0 || lines[0].trim() !== '---') {
    return { meta: {}, body: content }
  }

  let endIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIdx = i
      break
    }
  }

  if (endIdx === -1) {
    return { meta: {}, body: content }
  }

  const frontmatterLines = lines.slice(1, endIdx)
  const body = lines.slice(endIdx + 1).join('\n')
  const meta: Frontmatter = {}

  let currentKey: string | null = null
  const arrayValues: string[] = []

  const flushArrayIfNeeded = () => {
    if (!currentKey) return
    meta[currentKey as keyof Frontmatter] = [...arrayValues] as never
    currentKey = null
    arrayValues.length = 0
  }

  for (const line of frontmatterLines) {
    const scalarMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*?)\s*$/)
    if (scalarMatch) {
      flushArrayIfNeeded()

      const key = scalarMatch[1]
      const value = scalarMatch[2]

      // 支持 YAML 多行数组：
      // keywords:
      //   - a
      //   - b
      if (value.length === 0) {
        currentKey = key
        continue
      }

      const inlineArrayMatch = value.match(/^\[(.*)\]$/)
      if (inlineArrayMatch) {
        meta[key as keyof Frontmatter] = inlineArrayMatch[1]
          .split(',')
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean) as never
      } else {
        meta[key as keyof Frontmatter] = value.replace(/^['"]|['"]$/g, '') as never
      }
      continue
    }

    const arrayMatch = line.match(/^\s*-\s+(.+?)\s*$/)
    if (arrayMatch) {
      if (currentKey) {
        arrayValues.push(arrayMatch[1].replace(/^['"]|['"]$/g, ''))
      }
      continue
    }
  }

  flushArrayIfNeeded()

  return { meta, body }
}

/* ------------------------------------------------------------------ */
/*  Paths                                                               */
/* ------------------------------------------------------------------ */

function slugDirName(name: string): string {
  return name
    .trim()
    .replace(/[/\\:?*"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'skill'
}

/** 列出技能包内非隐藏文件（供模型上下文），不递归过深 */
export function formatSkillBundleAppendix(skill: Skill): string {
  const root = skill.contentRoot
  if (!root || !fs.existsSync(root)) return ''

  const lines: string[] = []
  lines.push(`技能包目录（绝对路径，供工具或人工引用，模型勿当作可执行指令运行）: ${root}`)
  lines.push('包内文件（节选）:')

  const maxFiles = 40
  let count = 0

  const walk = (dir: string, depth: number) => {
    if (count >= maxFiles || depth > 3) return
    let entries: string[]
    try {
      entries = fs.readdirSync(dir)
    } catch {
      return
    }
    entries.sort((a, b) => a.localeCompare(b))
    for (const ent of entries) {
      if (ent.startsWith('.') || ent === 'node_modules') continue
      const full = path.join(dir, ent)
      let st: fs.Stats
      try {
        st = fs.statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(full, depth + 1)
        continue
      }
      const rel = path.relative(root, full).replace(/\\/g, '/')
      lines.push(`- ${rel}`)
      count++
      if (count >= maxFiles) return
    }
  }

  walk(root, 0)
  if (count === 0) lines.push('- (无普通文件或目录不可读)')
  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/*  SkillManager                                                        */
/* ------------------------------------------------------------------ */

export class SkillManager {
  private static instance: SkillManager
  private skills: Skill[] = []
  private initialized = false

  static getInstance(): SkillManager {
    if (!SkillManager.instance) {
      SkillManager.instance = new SkillManager()
    }
    return SkillManager.instance
  }

  init(): void {
    if (this.initialized) return
    this.initialized = true
    this.loadBuiltins()
    this.loadUserSkills()
    log.info(`SkillManager: initialized with ${this.skills.length} skills`)
  }

  list(): SkillMeta[] {
    this.ensureInit()
    const byName = new Map<string, Skill>()
    for (const s of this.skills) {
      byName.set(s.name, s)
    }
    return Array.from(byName.values()).map((s) => this.toMeta(s))
  }

  get(name: string): Skill | undefined {
    this.ensureInit()
    let found: Skill | undefined
    for (const s of this.skills) {
      if (s.name === name) found = s
    }
    return found
  }

  getEnabledSkills(): Skill[] {
    this.ensureInit()
    const byName = new Map<string, Skill>()
    for (const s of this.skills) {
      if (!s.enabled) continue
      byName.set(s.name, s)
    }
    return Array.from(byName.values())
  }

  toggle(name: string, enabled: boolean): boolean {
    this.ensureInit()
    const skill = this.skills.find((s) => s.name === name)
    if (!skill) {
      log.warn(`SkillManager: toggle failed — skill not found: ${name}`)
      return false
    }
    skill.enabled = enabled

    if (skill.source === 'user') {
      this.saveUserSkill(skill)
    }

    log.info(`SkillManager: toggled skill "${name}" to ${enabled ? 'enabled' : 'disabled'}`)
    return true
  }

  delete(name: string): { ok: boolean; error?: string } {
    this.ensureInit()
    const idx = this.skills.findIndex((s) => s.name === name)
    if (idx < 0) {
      log.warn(`SkillManager: delete failed — skill not found: ${name}`)
      return { ok: false, error: 'Skill 不存在' }
    }

    const skill = this.skills[idx]
    if (skill.builtin) {
      log.warn(`SkillManager: delete failed — builtin skill is read-only: ${name}`)
      return { ok: false, error: '内置 Skill 不可删除' }
    }

    // 仅从当前内存装配中移除，不删除磁盘文件
    this.skills.splice(idx, 1)
    log.info(`SkillManager: removed user skill from runtime assembly "${name}"`)
    return { ok: true }
  }

  /**
   * 导入单个 .md：统一写入 skills/packages/<slug>/SKILL.md（与「导入目录」结构一致）。
   */
  import(filePath: string, _opts?: { sourceName?: string }): string | null {
    this.ensureInit()

    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      const { meta, body } = parseFrontmatter(raw)

      if (!meta.name) {
        log.warn(`SkillManager: import failed — no "name" in frontmatter for ${filePath}`)
        return null
      }

      const name = meta.name.trim().normalize('NFC')
      const description = meta.description?.trim() ?? ''
      const keywords = meta.keywords ?? []

      const builtin = this.skills.find((s) => s.name === name && s.builtin)
      if (builtin) {
        log.warn(`SkillManager: import failed — "${name}" conflicts with builtin skill`)
        return null
      }

      const pkgRoot = path.join(getUserSkillPackagesDir(), slugDirName(name))
      const existing = this.skills.find((s) => s.name === name && s.source === 'user')

      if (existing?.contentRoot && fs.existsSync(existing.contentRoot)) {
        try {
          fs.rmSync(existing.contentRoot, { recursive: true, force: true })
        } catch (e) {
          log.warn('SkillManager: failed to remove old skill package', e)
        }
      } else if (existing?.filePath && fs.existsSync(existing.filePath)) {
        try {
          if (existing.contentRoot) {
            fs.rmSync(existing.contentRoot, { recursive: true, force: true })
          } else {
            fs.unlinkSync(existing.filePath)
          }
        } catch (e) {
          log.warn('SkillManager: failed to remove old skill storage', e)
        }
      }

      if (fs.existsSync(pkgRoot)) {
        try {
          fs.rmSync(pkgRoot, { recursive: true, force: true })
        } catch (e) {
          log.warn('SkillManager: failed to clear package dir before single-file import', e)
        }
      }

      fs.mkdirSync(pkgRoot, { recursive: true })
      const destMd = path.join(pkgRoot, 'SKILL.md')
      fs.copyFileSync(filePath, destMd)

      const skill: Skill = {
        name,
        description,
        keywords,
        builtin: false,
        enabled: true,
        source: 'user' as const,
        filePath: destMd,
        contentRoot: pkgRoot,
        content: body.trim(),
      }

      if (existing) {
        existing.description = skill.description
        existing.keywords = skill.keywords
        existing.filePath = skill.filePath
        existing.contentRoot = skill.contentRoot
        existing.content = skill.content
        log.info(`SkillManager: overwrote user skill "${name}" (packages/…/SKILL.md)`)
      } else {
        this.skills.push(skill)
        log.info(`SkillManager: imported user skill "${name}" → ${pkgRoot}`)
      }

      return name
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`SkillManager: import failed for ${filePath}: ${message}`)
      return null
    }
  }

  /**
   * 导入整个目录：复制到 userData/skills/packages/<slug>/，保留脚本与子目录。
   * 主入口优先 SKILL.md → skill.md → 与文件夹同名的 .md → 任意带合法 frontmatter 的根级 .md。
   */
  importDirectory(srcDir: string): string | null {
    this.ensureInit()
    try {
      const mainRel = this.findMainSkillMdRelative(srcDir)
      if (!mainRel) {
        log.warn(`SkillManager: importDirectory — no SKILL.md / *.md with name in ${srcDir}`)
        return null
      }

      const mainPath = path.join(srcDir, mainRel)
      const raw = fs.readFileSync(mainPath, 'utf-8')
      const { meta, body } = parseFrontmatter(raw)
      if (!meta.name) {
        log.warn(`SkillManager: importDirectory — no name in frontmatter: ${mainPath}`)
        return null
      }

      const name = meta.name.trim()
      const description = meta.description?.trim() ?? ''
      const keywords = meta.keywords ?? []

      const builtin = this.skills.find((s) => s.name === name && s.builtin)
      if (builtin) {
        log.warn(`SkillManager: importDirectory — "${name}" conflicts with builtin`)
        return null
      }

      const destRoot = path.join(getUserSkillPackagesDir(), slugDirName(name))
      const existing = this.skills.find((s) => s.name === name && s.source === 'user')
      if (existing?.contentRoot && fs.existsSync(existing.contentRoot)) {
        try {
          fs.rmSync(existing.contentRoot, { recursive: true, force: true })
        } catch (e) {
          log.warn('SkillManager: failed to remove old package', e)
        }
      } else if (existing?.filePath && !existing.contentRoot && fs.existsSync(existing.filePath)) {
        try {
          fs.unlinkSync(existing.filePath)
        } catch {
          // ignore
        }
      }

      if (fs.existsSync(destRoot)) {
        fs.rmSync(destRoot, { recursive: true, force: true })
      }
      fs.cpSync(srcDir, destRoot, { recursive: true })

      const mainDest = path.join(destRoot, mainRel)
      const skill: Skill = {
        name,
        description,
        keywords,
        builtin: false,
        enabled: true,
        source: 'user',
        filePath: mainDest,
        contentRoot: destRoot,
        content: body.trim(),
      }

      if (existing) {
        existing.description = skill.description
        existing.keywords = skill.keywords
        existing.filePath = skill.filePath
        existing.contentRoot = skill.contentRoot
        existing.content = skill.content
        log.info(`SkillManager: overwrote user skill "${name}" (package)`)
      } else {
        this.skills.push(skill)
        log.info(`SkillManager: imported user skill "${name}" from directory ${srcDir}`)
      }

      return name
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`SkillManager: importDirectory failed: ${message}`)
      return null
    }
  }

  private findMainSkillMdRelative(dir: string): string | null {
    const candidates = ['SKILL.md', 'skill.md', `${path.basename(dir)}.md`]
    for (const c of candidates) {
      const p = path.join(dir, c)
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return c
    }
    try {
      for (const ent of fs.readdirSync(dir)) {
        if (!ent.endsWith('.md')) continue
        const p = path.join(dir, ent)
        if (!fs.statSync(p).isFile()) continue
        const raw = fs.readFileSync(p, 'utf-8')
        const { meta } = parseFrontmatter(raw)
        if (meta.name?.trim()) return ent
      }
    } catch {
      return null
    }
    return null
  }

  private loadSkillFromPackageDir(pkgDir: string): Skill | null {
    const rel = this.findMainSkillMdRelative(pkgDir)
    if (!rel) return null
    const mdPath = path.join(pkgDir, rel)
    try {
      const raw = fs.readFileSync(mdPath, 'utf-8')
      const { meta, body } = parseFrontmatter(raw)
      if (!meta.name?.trim()) return null
      return {
        name: meta.name.trim(),
        description: meta.description?.trim() ?? '',
        keywords: meta.keywords ?? [],
        builtin: false,
        enabled: true,
        source: 'user',
        filePath: mdPath,
        contentRoot: pkgDir,
        content: body.trim(),
      }
    } catch {
      return null
    }
  }

  private ensureInit(): void {
    if (!this.initialized) {
      this.init()
    }
  }

  private loadBuiltins(): void {
    const builtinDir = getBuiltinSkillsDir()
    try {
      if (!fs.existsSync(builtinDir)) {
        log.info(`SkillManager: no builtin skills directory at ${builtinDir}`)
        return
      }

      const byName = new Map<string, Skill>()
      const entries = fs.readdirSync(builtinDir)
      for (const entry of entries) {
        if (!entry.endsWith('.md')) continue
        const filePath = path.join(builtinDir, entry)
        try {
          const raw = fs.readFileSync(filePath, 'utf-8')
          const { meta, body } = parseFrontmatter(raw)
          if (!meta.name) {
            log.warn(`SkillManager: skipping builtin skill with no name: ${entry}`)
            continue
          }

          const name = meta.name.trim().normalize('NFC')
          if (byName.has(name)) {
            log.warn(
              `SkillManager: duplicate builtin skill name "${name}" — keeping ${byName.get(name)!.filePath}, skipping ${filePath}`,
            )
            continue
          }

          byName.set(name, {
            name,
            description: meta.description?.trim() ?? '',
            keywords: meta.keywords ?? [],
            builtin: true,
            enabled: true,
            source: 'builtin',
            filePath,
            content: body.trim(),
          })
        } catch (err) {
          log.warn(`SkillManager: failed to read builtin skill ${entry}:`, err)
        }
      }

      for (const s of byName.values()) {
        this.skills.push(s)
      }

      log.info(`SkillManager: loaded ${byName.size} builtin skills`)
    } catch (err) {
      log.error('SkillManager: error loading builtin skills:', err)
    }
  }

  /** 历史版本写在 skills/*.md 的根文件迁入 skills/packages/<slug>/SKILL.md */
  private migrateFlatMarkdownSkillsToPackages(userRoot: string): void {
    try {
      if (!fs.existsSync(userRoot)) return
      const pkgRoot = path.join(userRoot, 'packages')
      fs.mkdirSync(pkgRoot, { recursive: true })

      for (const entry of fs.readdirSync(userRoot)) {
        if (!entry.endsWith('.md')) continue
        if (entry.toLowerCase() === 'readme.md') continue
        const full = path.join(userRoot, entry)
        try {
          if (!fs.statSync(full).isFile()) continue
        } catch {
          continue
        }

        let raw: string
        try {
          raw = fs.readFileSync(full, 'utf-8')
        } catch {
          continue
        }
        const { meta } = parseFrontmatter(raw)
        if (!meta.name?.trim()) continue

        const name = meta.name.trim().normalize('NFC')
        const slug = slugDirName(name)
        const destRoot = path.join(pkgRoot, slug)
        if (fs.existsSync(destRoot)) {
          continue
        }

        try {
          fs.mkdirSync(destRoot, { recursive: true })
          const destMd = path.join(destRoot, 'SKILL.md')
          fs.copyFileSync(full, destMd)
          fs.unlinkSync(full)
          log.info(`SkillManager: migrated ${entry} → packages/${slug}/SKILL.md`)
        } catch (e) {
          log.warn(`SkillManager: migration failed for ${entry}`, e)
        }
      }
    } catch (e) {
      log.warn('SkillManager: migrateFlatMarkdownSkillsToPackages error', e)
    }
  }

  private loadUserSkills(): void {
    try {
      const userRoot = getUserSkillsRoot()

      this.skills = this.skills.filter((s) => s.builtin)
      this.migrateFlatMarkdownSkillsToPackages(userRoot)

      const packageSkills: Skill[] = []

      const pkgRoot = getUserSkillPackagesDir()
      if (fs.existsSync(pkgRoot)) {
        for (const pkg of fs.readdirSync(pkgRoot)) {
          const pkgPath = path.join(pkgRoot, pkg)
          try {
            if (!fs.statSync(pkgPath).isDirectory()) continue
          } catch {
            continue
          }
          const sk = this.loadSkillFromPackageDir(pkgPath)
          if (sk) packageSkills.push(sk)
        }
      }

      const byName = new Map<string, Skill>()
      for (const s of packageSkills) {
        byName.set(s.name, s)
      }
      const userNames = new Set(byName.keys())
      this.skills = this.skills.filter((sk) => !(sk.builtin && userNames.has(sk.name)))
      for (const s of byName.values()) {
        this.skills.push(s)
      }

      log.info(`SkillManager: loaded ${byName.size} user skills`)
    } catch (err) {
      log.error('SkillManager: error loading user skills:', err)
    }
  }

  private saveUserSkill(skill: Skill): void {
    try {
      getUserSkillsRoot()

      const lines: string[] = ['---']
      lines.push(`name: ${skill.name}`)
      if (skill.description) lines.push(`description: ${skill.description}`)
      if (skill.keywords.length > 0) {
        lines.push(`keywords: [${skill.keywords.join(', ')}]`)
      }
      lines.push('---')
      lines.push('')
      lines.push(skill.content)

      fs.writeFileSync(skill.filePath, lines.join('\n'), 'utf-8')
    } catch (err) {
      log.error(`SkillManager: failed to save user skill "${skill.name}":`, err)
    }
  }

  private toMeta(skill: Skill): SkillMeta {
    const validity = assessSkillValidity(skill)
    return {
      name: skill.name,
      description: skill.description,
      keywords: skill.keywords,
      builtin: skill.builtin,
      enabled: skill.enabled,
      source: skill.source,
      filePath: skill.filePath,
      contentRoot: skill.contentRoot,
      invalid: validity.invalid,
      invalidReason: validity.reason,
    }
  }
}
