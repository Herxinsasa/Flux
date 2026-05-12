import { useState, useCallback, useEffect, useRef } from 'react'
import { useFileStore } from '../../stores/fileStore'
import { useEditorStore } from '../../stores/editorStore'

type TopMenu = 'file' | 'edit' | 'paragraph' | 'view' | 'help' | null

interface MenuBarProps {
  onOpenSettings?: () => void
  onOpenSkills?: () => void
  onOpenHelp?: () => void
  onOpenAbout?: () => void
}

export function MenuBar({ onOpenSettings, onOpenSkills, onOpenHelp, onOpenAbout }: MenuBarProps) {
  const [open, setOpen] = useState<TopMenu>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const lastEditableRef = useRef<HTMLElement | null>(null)

  const isEditableElement = useCallback((el: Element | null): el is HTMLElement => {
    if (!el || !(el instanceof HTMLElement)) return false
    const tag = el.tagName.toLowerCase()
    if (tag === 'textarea') return true
    if (tag === 'input') {
      const input = el as HTMLInputElement
      return !['button', 'checkbox', 'radio', 'file', 'submit', 'reset', 'color', 'range'].includes(input.type)
    }
    return el.isContentEditable
  }, [])

  const captureCurrentEditable = useCallback(() => {
    const active = document.activeElement
    if (isEditableElement(active)) {
      lastEditableRef.current = active
    }
  }, [isEditableElement])

  const restoreEditableFocus = useCallback((): HTMLElement | null => {
    const candidate = lastEditableRef.current
    if (candidate && document.contains(candidate)) {
      candidate.focus()
      return candidate
    }
    const active = document.activeElement
    if (isEditableElement(active)) return active
    return null
  }, [isEditableElement])

  const runNativeEdit = useCallback((action: 'cut' | 'copy' | 'paste' | 'select-all'): boolean => {
    const target = restoreEditableFocus()
    if (!target) return false

    if (action === 'select-all') {
      const tag = target.tagName.toLowerCase()
      if (tag === 'textarea' || tag === 'input') {
        const input = target as HTMLInputElement | HTMLTextAreaElement
        const len = input.value?.length ?? 0
        input.setSelectionRange(0, len)
        return true
      }
      return document.execCommand('selectAll')
    }

    const cmd = action === 'cut' ? 'cut' : action === 'copy' ? 'copy' : 'paste'
    return document.execCommand(cmd)
  }, [restoreEditableFocus])

  const close = useCallback(() => setOpen(null), [])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(null)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const btnClass =
    'px-2.5 py-1 rounded text-app-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer font-[var(--font-ui)]'

  const itemClass =
    'block w-full text-left px-3 py-1.5 text-app-sm text-[var(--text-primary)] hover:bg-[var(--hover)] cursor-pointer font-[var(--font-ui)] border-0 bg-transparent'

  return (
    <div
      ref={rootRef}
      className="flex items-center gap-0.5 shrink-0 px-1"
      style={{ WebkitAppRegion: 'no-drag' }}
    >
      <div className="relative">
        <button type="button" className={btnClass} onClick={() => setOpen(open === 'file' ? null : 'file')}>
          文件
        </button>
        {open === 'file' && (
          <div
            className="absolute left-0 top-full mt-0.5 py-1 min-w-[200px] rounded-[var(--radius-sm)] border border-[var(--border-visible)] bg-[var(--bg-card)] shadow-lg z-[200]"
          >
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close()
                void useFileStore.getState().openFile()
              }}
            >
              打开文件
            </button>
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close()
                void useFileStore.getState().openFolder()
              }}
            >
              打开文件夹
            </button>
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close()
                void useFileStore.getState().createFile()
              }}
            >
              新建文件
            </button>
          </div>
        )}
      </div>

      <div className="relative">
        <button
          type="button"
          className={btnClass}
          onMouseDown={captureCurrentEditable}
          onClick={() => setOpen(open === 'edit' ? null : 'edit')}
        >
          编辑
        </button>
        {open === 'edit' && (
          <div className="absolute left-0 top-full mt-0.5 py-1 min-w-[200px] rounded-[var(--radius-sm)] border border-[var(--border-visible)] bg-[var(--bg-card)] shadow-lg z-[200]">
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close()
                void runNativeEdit('cut')
              }}
            >
              剪切 <span className="text-[var(--text-hint)]">Ctrl+X</span>
            </button>
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close()
                void runNativeEdit('copy')
              }}
            >
              复制 <span className="text-[var(--text-hint)]">Ctrl+C</span>
            </button>
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close()
                void runNativeEdit('paste')
              }}
            >
              粘贴 <span className="text-[var(--text-hint)]">Ctrl+V</span>
            </button>
            <div className="mx-2 my-1 border-t border-[var(--border-subtle)]" />
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close()
                useEditorStore.getState().requestMenuAction('find')
              }}
            >
              查找 <span className="text-[var(--text-hint)]">Ctrl+F</span>
            </button>
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close()
                const handled = runNativeEdit('select-all')
                if (!handled) {
                  useEditorStore.getState().requestMenuAction('select-all')
                }
              }}
            >
              全选 <span className="text-[var(--text-hint)]">Ctrl+A</span>
            </button>
          </div>
        )}
      </div>

      <div className="relative">
        <button type="button" className={btnClass} onClick={() => setOpen(open === 'paragraph' ? null : 'paragraph')}>
          段落
        </button>
        {open === 'paragraph' && (
          <div className="absolute left-0 top-full mt-0.5 py-1 min-w-[200px] rounded-[var(--radius-sm)] border border-[var(--border-visible)] bg-[var(--bg-card)] shadow-lg z-[200]">
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close()
                useEditorStore.getState().requestInsertAtCursor('# ')
              }}
            >
              一级标题
            </button>
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close()
                useEditorStore.getState().requestInsertAtCursor('## ')
              }}
            >
              二级标题
            </button>
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close()
                useEditorStore.getState().requestInsertAtCursor('### ')
              }}
            >
              三级标题
            </button>
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close()
                useEditorStore.getState().requestInsertAtCursor('#### ')
              }}
            >
              四级标题
            </button>
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close()
                useEditorStore.getState().requestInsertAtCursor('##### ')
              }}
            >
              五级标题
            </button>

            <div className="mx-2 my-1 border-t border-[var(--border-subtle)]" />

            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close()
                useEditorStore.getState().requestInsertAtCursor('- ')
              }}
            >
              无序列表
            </button>
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close()
                useEditorStore.getState().requestInsertAtCursor('1. ')
              }}
            >
              有序列表
            </button>

            <div className="mx-2 my-1 border-t border-[var(--border-subtle)]" />

            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close()
                useEditorStore.getState().requestInsertAtCursor('> ')
              }}
            >
              引用
            </button>
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close()
                useEditorStore.getState().requestInsertAtCursor('\n> 引用内容\n> 继续补充\n')
              }}
            >
              引用块
            </button>

            <div className="mx-2 my-1 border-t border-[var(--border-subtle)]" />

            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close()
                useEditorStore.getState().requestInsertAtCursor('\n```\n\n```\n')
              }}
            >
              代码块
            </button>
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close()
                useEditorStore.getState().requestInsertAtCursor('\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容1 | 内容2 | 内容3 |\n')
              }}
            >
              表格
            </button>

            <div className="mx-2 my-1 border-t border-[var(--border-subtle)]" />

            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close()
                useEditorStore.getState().requestInsertAtCursor('\n---\n')
              }}
            >
              水平分割线
            </button>
          </div>
        )}
      </div>

      <div className="relative">
        <button type="button" className={btnClass} onClick={() => setOpen(open === 'view' ? null : 'view')}>
          查看
        </button>
        {open === 'view' && (
          <div className="absolute left-0 top-full mt-0.5 py-1 min-w-[200px] rounded-[var(--radius-sm)] border border-[var(--border-visible)] bg-[var(--bg-card)] shadow-lg z-[200]">
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close()
                onOpenSkills?.()
              }}
            >
              技能管理
            </button>
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close()
                onOpenSettings?.()
              }}
            >
              设置
            </button>
          </div>
        )}
      </div>

      <div className="relative">
        <button type="button" className={btnClass} onClick={() => setOpen(open === 'help' ? null : 'help')}>
          帮助
        </button>
        {open === 'help' && (
          <div className="absolute left-0 top-full mt-0.5 py-1 min-w-[200px] rounded-[var(--radius-sm)] border border-[var(--border-visible)] bg-[var(--bg-card)] shadow-lg z-[200]">
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close()
                onOpenHelp?.()
              }}
            >
              使用说明
            </button>
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close()
                onOpenAbout?.()
              }}
            >
              关于
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
