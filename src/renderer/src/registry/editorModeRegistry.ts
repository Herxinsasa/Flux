import type { ComponentType } from 'react'
import type { EditorMode } from '../stores/editorStore'

export interface EditorModeConfig {
  mode: EditorMode
  component: ComponentType
  label: string
  extensions: string[]
}

const registry = new Map<string, EditorModeConfig>()

export function registerMode(config: EditorModeConfig): void {
  for (const ext of config.extensions) {
    registry.set(ext.toLowerCase(), config)
  }
}

export function getModeConfig(extension: string): EditorModeConfig | undefined {
  return registry.get(extension.toLowerCase())
}

export function getEditorComponent(extension: string): ComponentType | undefined {
  return registry.get(extension.toLowerCase())?.component
}

export function getRegisteredExtensions(): string[] {
  return Array.from(registry.keys())
}

export function isRegistered(extension: string): boolean {
  return registry.has(extension.toLowerCase())
}

export { registry }
