import { $view } from '@milkdown/utils'
import { codeBlockSchema } from '@milkdown/preset-commonmark'
import type { Node as ProseMirrorNode } from '@milkdown/prose/model'
import { TextSelection } from '@milkdown/prose/state'
import type { EditorView, NodeView, ViewMutationRecord } from '@milkdown/prose/view'

/** 判断代码块语言是否为 mermaid 图（支持 ```mermaid / ```flowchart / ```flowchart TB） */
export function isMermaidLanguage(language: string | undefined | null): boolean {
  const firstToken = (language ?? '').trim().split(/\s+/)[0]?.toLowerCase()
  return firstToken === 'mermaid' || firstToken === 'flowchart'
}

let mermaidCounter = 0
let mermaidInitialized: string | null = null
const activeMermaidViews = new Set<MermaidCodeBlockView>()

async function renderMermaidSvg(renderId: string, source: string, theme: 'dark' | 'default'): Promise<string> {
  const { default: mermaid } = await import('mermaid')
  // 模块级初始化一次，避免多代码块并发 render 时全局配置竞争
  if (mermaidInitialized !== theme) {
    mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict' })
    mermaidInitialized = theme
  }
  const { svg } = await mermaid.render(renderId, source)
  return svg
}

/**
 * WYSIWYG 编辑面的 mermaid 代码块视图：
 * - 普通语言：保持默认 pre > code 渲染
 * - mermaid/flowchart：默认渲染为图；点击图后在其上方显示可编辑源码，失焦后重新渲染
 */
class MermaidCodeBlockView implements NodeView {
  dom: HTMLElement
  contentDOM?: HTMLElement

  private node: ProseMirrorNode
  private view: EditorView
  private getPos: () => number | undefined
  private renderId: string
  private renderRevision = 0
  private previewEl: HTMLDivElement
  private sourceWrapEl: HTMLElement
  private sourceEl: HTMLElement
  private showingSource = false
  private rendering = false
  private destroyed = false
  /** 最近一次渲染（含错误态/空态）对应的源码，用于渲染完成后检测是否需要补渲染 */
  private lastRenderedSource = ''
  private lastRenderedTheme: 'dark' | 'default' | null = null
  private requestedTheme: 'dark' | 'default' | null = null
  private contentScale = 1
  private readonly onPreviewClick = () => this.showSource()
  private readonly onSourceBlur = () => this.hideSource()
  private readonly onDocMouseDown = (event: MouseEvent) => {
    if (!this.showingSource) return
    const target = event.target as Node | null
    if (target && this.dom.contains(target)) return
    this.hideSource()
  }

  constructor(node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node
    this.view = view
    this.getPos = getPos
    this.renderId = `flux-wysiwyg-mermaid-${++mermaidCounter}`

    if (!isMermaidLanguage(node.attrs.language)) {
      // 普通代码块：沿用 milkdown 默认结构 pre > code(0)
      this.dom = document.createElement('pre')
      this.dom.className = 'flux-code-block'
      this.dom.dataset.language = (node.attrs.language as string | undefined)?.trim().split(/\s+/)[0] ?? ''
      this.sourceEl = document.createElement('code')
      this.dom.appendChild(this.sourceEl)
      this.contentDOM = this.sourceEl
      this.previewEl = document.createElement('div')
      this.sourceWrapEl = this.dom
      return
    }

    this.dom = document.createElement('div')
    this.dom.className = 'flux-mermaid-codeblock'
    this.dom.setAttribute('data-language', 'mermaid')

    // 源码区（点击图后显示在图上方，可编辑）
    this.sourceWrapEl = document.createElement('pre')
    this.sourceWrapEl.className = 'flux-mermaid-source'
    this.sourceWrapEl.style.display = 'none'
    this.sourceEl = document.createElement('code')
    this.sourceEl.spellcheck = false
    this.sourceWrapEl.appendChild(this.sourceEl)
    this.dom.appendChild(this.sourceWrapEl)
    this.contentDOM = this.sourceEl

    // 图表预览区
    this.previewEl = document.createElement('div')
    this.previewEl.className = 'flux-mermaid-preview'
    this.previewEl.textContent = '图表渲染中…'
    this.dom.appendChild(this.previewEl)

    this.previewEl.addEventListener('click', this.onPreviewClick)
    this.sourceEl.addEventListener('blur', this.onSourceBlur)
    document.addEventListener('mousedown', this.onDocMouseDown)
    activeMermaidViews.add(this)

    void this.renderDiagram()
  }

  private currentSource(): string {
    return this.node.textContent ?? ''
  }

  private currentTheme(): 'dark' | 'default' {
    if (this.requestedTheme) return this.requestedTheme
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default'
  }

  refreshDisplay(theme: 'dark' | 'default', contentScale: number): void {
    if (!isMermaidLanguage(this.node.attrs.language)) return
    const previousTheme = this.requestedTheme
    this.requestedTheme = theme
    this.contentScale = Number.isFinite(contentScale) && contentScale > 0 ? contentScale : 1
    this.applyPreviewScale()
    if (previousTheme !== theme && !this.showingSource) void this.renderDiagram()
  }

  private applyPreviewScale(): void {
    if (!isMermaidLanguage(this.node.attrs.language)) return
    const svgElement = this.previewEl.querySelector('svg')
    const viewBox = svgElement?.getAttribute('viewBox')?.trim().split(/\s+/).map(Number)
    if (!svgElement || viewBox?.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0) return

    // The editor surface already uses CSS zoom. Cancel it for the preview container,
    // then apply the requested scale to the SVG dimensions so diagrams track text zoom exactly.
    this.previewEl.style.zoom = String(1 / this.contentScale)
    svgElement.style.width = `${Math.ceil(viewBox[2] * this.contentScale)}px`
    svgElement.style.height = 'auto'
  }

  private async renderDiagram(): Promise<void> {
    // 语言守卫：普通语言代码块沿用默认渲染，不触发 mermaid 动态 import
    if (this.destroyed || this.rendering || !isMermaidLanguage(this.node.attrs.language)) return
    const source = this.currentSource()
    if (!source.trim()) {
      this.previewEl.textContent = ''
      this.lastRenderedSource = source
      return
    }
    this.rendering = true
    const theme = this.currentTheme()
    try {
      const svg = await renderMermaidSvg(`${this.renderId}-${++this.renderRevision}`, source, theme)
      if (this.destroyed) return
      this.previewEl.innerHTML = svg
      this.applyPreviewScale()
      this.lastRenderedSource = source
      this.lastRenderedTheme = theme
    } catch {
      if (this.destroyed) return
      this.previewEl.textContent = '图表语法错误'
      // 错误态同样记为已处理，避免 finally 对同一段错误语法反复补渲染
      this.lastRenderedSource = source
      this.lastRenderedTheme = theme
    } finally {
      this.rendering = false
      // 渲染期间再次失焦/更新的请求会被 rendering 标志丢弃：渲染完成后若仍处于
      // 收起状态且源码已变化，补一次渲染，避免预览停留在旧图
      if (!this.showingSource && !this.destroyed) {
        const source = this.currentSource()
        if (source !== this.lastRenderedSource || this.currentTheme() !== this.lastRenderedTheme) {
          void this.renderDiagram()
        }
      }
    }
  }

  private showSource(): void {
    if (this.showingSource) return
    this.showingSource = true
    // 源码显示在图上方（DOM 顺序已是 source 在前）
    this.sourceWrapEl.style.display = ''
    // 光标移入 code 块（getPos + 1 落在文本首字符），避免输入落进旧选区
    const position = this.getPos()
    if (position != null) {
      const doc = this.view.state.doc
      this.view.dispatch(
        this.view.state.tr.setSelection(TextSelection.near(doc.resolve(position + 1))),
      )
    }
    this.view.focus()
  }

  private hideSource(): void {
    if (!this.showingSource) return
    this.showingSource = false
    this.sourceWrapEl.style.display = 'none'
    void this.renderDiagram()
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false
    // 语言类别变化（mermaid ↔ 普通）时重建视图，避免停留在旧渲染模式
    if (isMermaidLanguage(node.attrs.language) !== isMermaidLanguage(this.node.attrs.language)) {
      return false
    }
    this.node = node
    if (!isMermaidLanguage(node.attrs.language)) {
      this.dom.dataset.language = (node.attrs.language as string | undefined)?.trim().split(/\s+/)[0] ?? ''
    }
    if (!this.showingSource) void this.renderDiagram()
    return true
  }

  destroy(): void {
    this.destroyed = true
    activeMermaidViews.delete(this)
    this.previewEl.removeEventListener('click', this.onPreviewClick)
    this.sourceEl.removeEventListener('blur', this.onSourceBlur)
    document.removeEventListener('mousedown', this.onDocMouseDown)
  }

  stopEvent(): boolean {
    return false
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    // contentDOM 内的变更交还 ProseMirror 回读（否则空代码块键入/粘贴静默丢失）；
    // 其余（如 SVG 注入预览区）保持忽略，避免脏重绘
    if (mutation.type === 'selection') return true
    if (this.contentDOM && (this.contentDOM === mutation.target || this.contentDOM.contains(mutation.target))) return false
    return true
  }
}

/** 注册 mermaid 代码块视图，覆盖 commonmark 默认 code_block 渲染 */
export const mermaidCodeBlockView = $view(codeBlockSchema.node, () => (node, view, getPos) => {
  return new MermaidCodeBlockView(node, view, getPos)
})

export function refreshMermaidCodeBlockViews(theme: 'dark' | 'default', contentScale = 1): void {
  activeMermaidViews.forEach((view) => view.refreshDisplay(theme, contentScale))
}
