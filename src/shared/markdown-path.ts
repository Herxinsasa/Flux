/** http(s) / mailto — leave to browser or shell.openExternal */
export function isExternalUrl(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href.trim())
}

export function isMarkdownFilePath(filePath: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(filePath.split(/[#?]/)[0] ?? '')
}

function stripQueryAndHash(href: string): string {
  return href.split(/[#?]/)[0] ?? href
}

function splitPath(pathStr: string): string[] {
  return pathStr.split(/[/\\]/).filter(Boolean)
}

function joinPath(segments: string[], preferBackslash: boolean, leadingSlash: boolean): string {
  if (segments.length === 0) return ''
  const sep = preferBackslash ? '\\' : '/'
  const joined = segments.join(sep)
  return leadingSlash && !preferBackslash ? `/${joined}` : joined
}

/**
 * Resolve a markdown href relative to the directory of `baseFilePath`.
 * Returns null for anchors-only, external URLs, or empty href.
 */
export function resolvePathFromBase(baseFilePath: string, href: string): string | null {
  const raw = href.trim()
  if (!raw || raw.startsWith('#') || isExternalUrl(raw)) return null

  let pathPart = stripQueryAndHash(raw)
  if (!pathPart) return null

  if (pathPart.startsWith('file://')) {
    try {
      pathPart = decodeURIComponent(pathPart.replace(/^file:\/\//i, ''))
      if (/^\/[a-zA-Z]:/.test(pathPart)) pathPart = pathPart.slice(1)
    } catch {
      return null
    }
    return pathPart
  }

  const preferBackslash = baseFilePath.includes('\\') || pathPart.includes('\\')
  const isWinAbs = /^[a-zA-Z]:[/\\]/.test(pathPart) || pathPart.startsWith('\\\\')
  if (isWinAbs || pathPart.startsWith('/')) {
    return pathPart
  }

  const baseDirParts = splitPath(baseFilePath)
  if (baseDirParts.length > 0) baseDirParts.pop()
  const relParts = splitPath(pathPart)
  const stack = [...baseDirParts]
  const leadingSlash = baseFilePath.startsWith('/') && !preferBackslash

  for (const part of relParts) {
    if (part === '.') continue
    if (part === '..') {
      stack.pop()
      continue
    }
    stack.push(part)
  }

  return joinPath(stack, preferBackslash, leadingSlash)
}

/** Path portion of href (without #anchor) for markdown file open checks */
export function hrefPathPart(href: string): string {
  return stripQueryAndHash(href.trim())
}
