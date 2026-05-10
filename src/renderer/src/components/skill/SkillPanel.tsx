import { useState, useEffect, useCallback } from 'react'
import type { Skill, SkillMeta } from '../../../../shared/types'
import { MdPreview } from '../editor/MdPreview'

interface SkillPanelProps {
  onBack: () => void
}

export function SkillPanel({ onBack }: SkillPanelProps) {
  const [skills, setSkills] = useState<SkillMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null)
  const [selectedMeta, setSelectedMeta] = useState<SkillMeta | null>(null)

  const loadSkills = useCallback(async (selectImportedName?: string | null) => {
    try {
      setLoading(true)
      setError(null)
      const res: any = await window.electronAPI.skill.list()
      if (res.success) {
        const data = res.data as SkillMeta[]
        setSkills(data)
        if (selectImportedName) {
          const pick = data.find((s) => s.name === selectImportedName)
          if (pick) {
            setSelectedMeta(pick)
            setSelectedSkill(null)
          }
        } else {
          setSelectedMeta((prev) => {
            if (prev && data.some((s) => s.name === prev.name)) return prev
            return data[0] ?? null
          })
        }
      } else {
        setError(res.error ?? '加载 Skill 列表失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 Skill 列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSkills()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedMeta) return
    let cancelled = false
    window.electronAPI.skill.get(selectedMeta.name).then((res: any) => {
      if (!cancelled && res.success) {
        setSelectedSkill(res.data as Skill)
      }
    })
    return () => {
      cancelled = true
    }
  }, [selectedMeta?.name]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleImport = useCallback(async () => {
    try {
      setImporting(true)
      setError(null)
      const res: any = await window.electronAPI.skill.import()
      if (res.cancelled) return
      if (!res.success) {
        setError(res.error ?? '导入失败')
        return
      }
      const importedName = res.data as string | undefined
      await loadSkills(importedName ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败')
    } finally {
      setImporting(false)
    }
  }, [loadSkills])

  const handleImportFolder = useCallback(async () => {
    try {
      setImporting(true)
      setError(null)
      const res: any = await window.electronAPI.skill.importFolder()
      if (res.cancelled) return
      if (!res.success) {
        setError(res.error ?? '导入目录失败')
        return
      }
      const importedName = res.data as string | undefined
      await loadSkills(importedName ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入目录失败')
    } finally {
      setImporting(false)
    }
  }, [loadSkills])

  const handleDelete = useCallback(
    async (name: string) => {
      try {
        setError(null)
        const yes = window.confirm(`确认删除 Skill「${name}」吗？`)
        if (!yes) return

        const res: any = await window.electronAPI.skill.delete(name)
        if (!res?.success) {
          setError(res?.error ?? '删除 Skill 失败')
          return
        }

        if (selectedMeta?.name === name) {
          setSelectedMeta(null)
          setSelectedSkill(null)
        }
        setSkills((prev) => prev.filter((s) => s.name !== name))
        await loadSkills()
      } catch (err) {
        setError(err instanceof Error ? err.message : '删除 Skill 失败')
      }
    },
    [loadSkills, selectedMeta?.name],
  )


  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      <div
        className="flex items-center gap-3 shrink-0 border-b border-[var(--border-visible)]"
        style={{ padding: '20px 24px' }}
      >
        <button
          onClick={onBack}
          className="flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:text-[var(--text-primary)] hover:bg-[var(--hover)] hover:border-[var(--border-visible)] transition-colors"
          style={{ padding: '6px 10px', fontSize: 13, fontFamily: 'var(--font-ui)', cursor: 'pointer' }}
        >
          ← 返回
        </button>
        <h1
          style={{
            fontSize: 17,
            fontWeight: 600,
            fontFamily: 'var(--font-ui)',
            color: 'var(--text-primary)',
            margin: 0,
            flex: 1,
            minWidth: 0,
          }}
        >
          Skill 技能管理
        </h1>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={handleImport} disabled={importing} className="btn-accent">
            {importing ? '导入中' : '+ 导入文件'}
          </button>
          <button type="button" onClick={handleImportFolder} disabled={importing} className="flux-btn-secondary">
            导入目录
          </button>
        </div>
      </div>

      {error && (
        <div
          className="mx-6 mb-2"
          style={{
            padding: '8px 12px',
            borderRadius: 'var(--radius-sm)',
            background: 'color-mix(in srgb, var(--error) 12%, var(--bg-card))',
            border: '1px solid color-mix(in srgb, var(--error) 35%, transparent)',
            fontSize: 12,
            color: 'var(--error)',
          }}
        >
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-2 underline hover:no-underline text-[var(--text-primary)]"
          >
            关闭
          </button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden min-h-0">
        <div
          className="overflow-y-auto shrink-0 flux-scroll flux-scroll--panel border-r border-[var(--border-visible)]"
          style={{
            width: 300,
            background: 'var(--bg-panel)',
            padding: 10,
          }}
        >
          {loading ? (
            <div
              style={{
                padding: '24px 12px',
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--text-hint)',
              }}
            >
              加载中...
            </div>
          ) : skills.length === 0 ? (
            <div
              style={{
                padding: '24px 12px',
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--text-hint)',
              }}
            >
              暂无 Skill — 点击「导入 Skill」添加
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {skills.map((skill) => {
                const isActive = selectedMeta?.name === skill.name
                const isInvalid = Boolean(skill.invalid)

                return (
                  <div
                    key={`${skill.name}:${skill.filePath ?? skill.source}`}
                    className="group relative"
                    onMouseEnter={(e) => {
                      const del = e.currentTarget.querySelector('button.absolute') as HTMLButtonElement | null
                      if (del) {
                        del.style.opacity = '0.72'
                        del.style.pointerEvents = 'auto'
                      }
                    }}
                    onMouseLeave={(e) => {
                      const del = e.currentTarget.querySelector('button.absolute') as HTMLButtonElement | null
                      if (del) {
                        del.style.opacity = '0'
                        del.style.pointerEvents = 'none'
                      }
                    }}
                  >
                    {!skill.builtin && (
                      <button
                        type="button"
                        title={isInvalid ? '清理失效 Skill' : '删除 Skill'}
                        onClick={() => {
                          void handleDelete(skill.name)
                        }}
                        className="absolute right-2 top-2 z-10"
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 6,
                          border: '1px solid color-mix(in srgb, var(--error) 35%, transparent)',
                          background: 'color-mix(in srgb, var(--error) 14%, var(--bg-card))',
                          color: 'var(--error)',
                          fontSize: 12,
                          lineHeight: '20px',
                          textAlign: 'center',
                          cursor: 'pointer',
                          opacity: 0,
                          pointerEvents: 'none',
                          transition: 'opacity 120ms ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.opacity = '0.95'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.opacity = '0.7'
                        }}
                      >
                        ×
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setSelectedMeta(skill)}
                      className="text-left transition-colors rounded-[var(--radius-sm)] border w-full"
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        width: '100%',
                        padding: '12px 14px',
                        background: isActive ? 'var(--bg-card)' : 'var(--bg-primary)',
                        borderColor: isInvalid
                          ? 'color-mix(in srgb, var(--error) 55%, transparent)'
                          : isActive
                            ? 'var(--accent)'
                            : 'var(--border-subtle)',
                        boxShadow: isActive
                          ? '0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent)'
                          : isInvalid
                            ? '0 0 0 1px color-mix(in srgb, var(--error) 22%, transparent)'
                            : 'none',
                        cursor: 'pointer',
                        fontFamily: 'var(--font-ui)',
                      }}
                      onMouseEnter={(e) => {
                        const card = e.currentTarget
                        if (!isActive) {
                          card.style.background = 'var(--hover)'
                          card.style.borderColor = isInvalid
                            ? 'color-mix(in srgb, var(--error) 60%, transparent)'
                            : 'var(--border-visible)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        const card = e.currentTarget
                        if (!isActive) {
                          card.style.background = 'var(--bg-primary)'
                          card.style.borderColor = isInvalid
                            ? 'color-mix(in srgb, var(--error) 55%, transparent)'
                            : 'var(--border-subtle)'
                        }
                      }}
                    >
                      <span
                        style={{
                          fontSize: 'var(--font-size-app)',
                          fontWeight: 600,
                          color: isInvalid ? 'var(--error)' : 'var(--text-primary)',
                        }}
                      >
                        {skill.name}
                      </span>
                      {skill.description && (
                        <span
                          style={{
                            fontSize: 'var(--font-size-app-sm)',
                            fontFamily: 'var(--font-ui)',
                            color: 'var(--text-secondary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {skill.description}
                        </span>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                        {skill.builtin && (
                          <span
                            className="text-[10px] px-2 py-0.5 rounded font-medium"
                            style={{
                              background: 'color-mix(in srgb, var(--accent) 18%, var(--bg-card))',
                              color: 'var(--accent)',
                              border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
                            }}
                          >
                            内置
                          </span>
                        )}
                        {isInvalid && (
                          <span
                            className="text-[10px] px-2 py-0.5 rounded font-medium"
                            style={{
                              background: 'color-mix(in srgb, var(--error) 18%, var(--bg-card))',
                              color: 'var(--error)',
                              border: '1px solid color-mix(in srgb, var(--error) 38%, transparent)',
                            }}
                          >
                            已失效
                          </span>
                        )}
                        {!skill.enabled && (
                          <span
                            className="text-[10px] px-2 py-0.5 rounded font-medium"
                            style={{
                              background: 'var(--bg-card)',
                              color: 'var(--text-hint)',
                              border: '1px solid var(--border-visible)',
                            }}
                          >
                            已禁用
                          </span>
                        )}
                      </div>
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div
          className="flex-1 flex flex-col min-h-0 overflow-hidden"
          style={{
            padding: 24,
            background: 'var(--bg-viewer)',
          }}
        >
          {selectedSkill && selectedMeta ? (
            <div className="flex flex-col gap-5 min-h-0 flex-1">
              <h2
                style={{
                  fontSize: 20,
                  fontWeight: 600,
                  fontFamily: 'var(--font-ui)',
                  color: 'var(--text-primary)',
                  margin: 0,
                  paddingBottom: 12,
                  borderBottom: '1px solid var(--border-visible)',
                  flexShrink: 0,
                }}
              >
                {selectedMeta.name}
              </h2>

              <p
                style={{
                  fontSize: 14,
                  lineHeight: 1.65,
                  fontFamily: 'var(--font-ui)',
                  color: 'var(--text-secondary)',
                  margin: 0,
                  flexShrink: 0,
                }}
              >
                {selectedMeta.description || '暂无描述'}
              </p>

              {selectedMeta.keywords && selectedMeta.keywords.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flexShrink: 0 }}>
                  {selectedMeta.keywords.map((kw) => (
                    <span key={kw} className="badge-subtle">
                      {kw}
                    </span>
                  ))}
                </div>
              )}

              {selectedMeta.contentRoot && (
                <div
                  style={{
                    fontSize: 12,
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-tertiary)',
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-subtle)',
                    wordBreak: 'break-all',
                    flexShrink: 0,
                  }}
                >
                  资源目录（绝对路径）：{selectedMeta.contentRoot}
                </div>
              )}

              {selectedMeta.invalid && (
                <div
                  style={{
                    fontSize: 12,
                    fontFamily: 'var(--font-ui)',
                    color: 'var(--error)',
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'color-mix(in srgb, var(--error) 10%, var(--bg-card))',
                    border: '1px solid color-mix(in srgb, var(--error) 35%, transparent)',
                    flexShrink: 0,
                  }}
                >
                  Skill 状态：已失效（{selectedMeta.invalidReason ?? '资源缺失'}）
                </div>
              )}

              <div className="flex flex-col gap-2 min-h-0 flex-1" style={{ minHeight: 200 }}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    fontFamily: 'var(--font-ui)',
                    color: 'var(--text-secondary)',
                    letterSpacing: '0.02em',
                    flexShrink: 0,
                  }}
                >
                  Skill 内容（预览）
                </span>
                <div className="skill-markdown-preview">
                  <MdPreview content={selectedSkill.content} />
                </div>
              </div>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                fontSize: 13,
                color: 'var(--text-tertiary)',
              }}
            >
              {skills.length === 0 ? '点击「导入 Skill」添加' : '从左侧列表选择一个 Skill'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
