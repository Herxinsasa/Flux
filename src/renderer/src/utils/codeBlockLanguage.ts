const plainTextCodeLanguages = new Set([
  'markdown',
  'md',
  'text',
  'txt',
  'plaintext',
  'plain',
  'log',
])

export function normalizeCodeBlockLanguage(language: unknown): string {
  return typeof language === 'string' ? language.trim().split(/\s+/)[0]?.toLowerCase() ?? '' : ''
}

/** Documentation and log blocks should remain readable, not look like source code. */
export function isPlainTextCodeLanguage(language: unknown): boolean {
  return plainTextCodeLanguages.has(normalizeCodeBlockLanguage(language))
}
