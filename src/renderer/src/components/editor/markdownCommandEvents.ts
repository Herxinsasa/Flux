import type { MarkdownCommandId } from './markdownCommandModel'

const MARKDOWN_COMMAND_EVENT = 'flux:markdown-command'

export function dispatchMarkdownCommand(command: MarkdownCommandId): void {
  document.dispatchEvent(new CustomEvent(MARKDOWN_COMMAND_EVENT, { detail: { command } }))
}

export function listenForMarkdownCommands(handler: (command: MarkdownCommandId) => void): () => void {
  const listener = (event: Event) => {
    const command = (event as CustomEvent<{ command?: MarkdownCommandId }>).detail?.command
    if (command) handler(command)
  }
  document.addEventListener(MARKDOWN_COMMAND_EVENT, listener)
  return () => document.removeEventListener(MARKDOWN_COMMAND_EVENT, listener)
}
