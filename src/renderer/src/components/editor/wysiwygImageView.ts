import { $view } from '@milkdown/utils'
import { imageSchema } from '@milkdown/preset-commonmark'
import type { Node as ProseMirrorNode } from '@milkdown/prose/model'
import type { EditorView, NodeView, ViewMutationRecord } from '@milkdown/prose/view'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { FolderOpen } from 'lucide-react'
import { resolvePathFromBase } from '../../../../shared/markdown-path'

export interface WysiwygImagePickRequest {
  position: number
  src: string
  alt: string
  title: string
}

interface ImageViewOptions {
  baseFilePath: string | null
  onPick: (request: WysiwygImagePickRequest) => void
  isReadOnly: () => boolean
}

const SAFE_INLINE_IMAGE = /^data:image\/(?:png|gif|jpe?g|webp);base64,/i

export function resolveWysiwygImageSource(baseFilePath: string | null, source: string): string {
  const src = source.trim()
  if (!src) return ''
  if (/^https?:\/\//i.test(src) || /^blob:/i.test(src) || /^flux-local:/i.test(src)) return src
  if (SAFE_INLINE_IMAGE.test(src)) return src
  // A Windows drive letter is a file path, not an executable URL scheme.
  const isWindowsAbsolute = /^[a-z]:[/\\]/i.test(src) || src.startsWith('\\\\')
  if (isWindowsAbsolute) {
    const absolutePath = resolvePathFromBase(baseFilePath ?? src, src)
    return absolutePath ? window.electronAPI.media.toLocalUrl(absolutePath) : ''
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !/^file:/i.test(src)) return ''
  if (!baseFilePath) return ''
  const absolutePath = resolvePathFromBase(baseFilePath, src)
  return absolutePath ? window.electronAPI.media.toLocalUrl(absolutePath) : ''
}

class WysiwygImageNodeView implements NodeView {
  dom: HTMLElement

  private node: ProseMirrorNode
  private readonly getPos: () => number | undefined
  private readonly options: ImageViewOptions
  private readonly image: HTMLImageElement
  private readonly placeholder: HTMLButtonElement
  private readonly placeholderIconRoot: Root
  private readonly onLoad = () => this.setState('ready')
  private readonly onError = () => this.setState('missing')
  private readonly blockPlaceholderPointer = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
  }
  private readonly onDoubleClick = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (this.options.isReadOnly()) return
    const position = this.getPos()
    if (position == null) return
    this.options.onPick({
      position,
      src: String(this.node.attrs.src ?? ''),
      alt: String(this.node.attrs.alt ?? ''),
      title: String(this.node.attrs.title ?? ''),
    })
  }

  constructor(node: ProseMirrorNode, _view: EditorView, getPos: () => number | undefined, options: ImageViewOptions) {
    this.node = node
    this.getPos = getPos
    this.options = options

    this.dom = document.createElement('span')
    this.dom.className = 'flux-image-node'
    this.dom.contentEditable = 'false'
    this.dom.draggable = true

    this.image = document.createElement('img')
    this.image.draggable = true
    this.image.addEventListener('load', this.onLoad)
    this.image.addEventListener('error', this.onError)
    this.dom.appendChild(this.image)

    this.placeholder = document.createElement('button')
    this.placeholder.type = 'button'
    this.placeholder.className = 'flux-image-placeholder'
    this.placeholder.title = '图片未找到，双击选择图片'
    this.placeholder.draggable = false
    this.placeholder.setAttribute('aria-label', '图片未找到，双击选择图片')
    const iconMount = document.createElement('span')
    iconMount.className = 'flux-image-placeholder-icon'
    iconMount.setAttribute('aria-hidden', 'true')
    this.placeholder.appendChild(iconMount)
    this.placeholderIconRoot = createRoot(iconMount)
    this.placeholderIconRoot.render(createElement(FolderOpen, { size: 17, strokeWidth: 1.8 }))
    this.placeholder.addEventListener('pointerdown', this.blockPlaceholderPointer)
    this.placeholder.addEventListener('click', this.blockPlaceholderPointer)
    this.placeholder.addEventListener('dblclick', this.onDoubleClick)
    this.dom.appendChild(this.placeholder)

    this.render(node)
  }

  private setState(state: 'loading' | 'ready' | 'missing'): void {
    this.dom.dataset.state = state
  }

  private render(node: ProseMirrorNode): void {
    const source = String(node.attrs.src ?? '')
    const displaySource = resolveWysiwygImageSource(this.options.baseFilePath, source)
    const alt = String(node.attrs.alt ?? '')
    const title = String(node.attrs.title ?? '')
    this.image.alt = alt
    this.image.title = title
    this.placeholder.dataset.source = source
    if (!displaySource) {
      this.image.removeAttribute('src')
      this.setState('missing')
      return
    }
    this.setState('loading')
    this.image.src = displaySource
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render(node)
    return true
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode')
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode')
  }

  destroy(): void {
    this.image.removeEventListener('load', this.onLoad)
    this.image.removeEventListener('error', this.onError)
    this.placeholder.removeEventListener('pointerdown', this.blockPlaceholderPointer)
    this.placeholder.removeEventListener('click', this.blockPlaceholderPointer)
    this.placeholder.removeEventListener('dblclick', this.onDoubleClick)
    this.placeholderIconRoot.unmount()
  }

  stopEvent(event: Event): boolean {
    return this.placeholder.contains(event.target as Node)
  }

  ignoreMutation(_mutation: ViewMutationRecord): boolean {
    return true
  }
}

export function createWysiwygImageView(options: ImageViewOptions) {
  return $view(imageSchema.node, () => (node, view, getPos) => (
    new WysiwygImageNodeView(node, view, getPos, options)
  ))
}
