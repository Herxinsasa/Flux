import fs from 'fs'
import path from 'path'
import { app, protocol, net } from 'electron'
import { pathToFileURL } from 'url'
import { LOCAL_MEDIA_SCHEME } from '../shared/local-media-url'

/** 系统敏感目录前缀（小写），禁止 flux-local 协议访问 */
const BLOCKED_PREFIXES = [
  // Windows
  'c:\\windows',
  'c:\\windows\\system32',
  'c:\\program files',
  'c:\\program files (x86)',
  // macOS / Linux
  '/etc/',
  '/bin/',
  '/sbin/',
  '/usr/bin/',
  '/usr/sbin/',
  '/boot/',
  '/dev/',
  '/proc/',
  '/sys/',
]

function isPathSafe(resolvedPath: string): boolean {
  const lower = resolvedPath.toLowerCase()
  for (const prefix of BLOCKED_PREFIXES) {
    if (lower === prefix || lower.startsWith(prefix + path.sep.toLowerCase())) {
      return false
    }
  }
  return true
}

/** Serve local files to the sandboxed renderer for markdown preview images. */
export function registerLocalFileProtocol(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LOCAL_MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        bypassCSP: true,
      },
    },
  ])

  app.whenReady().then(() => {
    protocol.handle(LOCAL_MEDIA_SCHEME, async (request) => {
      try {
        const url = new URL(request.url)
        const rawPath = url.searchParams.get('path')
        if (!rawPath) {
          return new Response(null, { status: 400, statusText: 'Missing path' })
        }

        // 规范化路径，消除 .. 遍历
        const resolved = path.resolve(rawPath)
        if (!resolved || resolved === '.') {
          return new Response(null, { status: 400, statusText: 'Invalid path' })
        }

        // 必须是绝对路径
        if (!path.isAbsolute(resolved)) {
          return new Response(null, { status: 403, statusText: 'Absolute path required' })
        }

        // 禁止访问系统敏感目录
        if (!isPathSafe(resolved)) {
          return new Response(null, { status: 403, statusText: 'Path not allowed' })
        }

        if (!fs.existsSync(resolved)) {
          return new Response(null, { status: 404, statusText: 'Not found' })
        }
        const stat = fs.statSync(resolved)
        if (!stat.isFile()) {
          return new Response(null, { status: 404, statusText: 'Not a file' })
        }
        return net.fetch(pathToFileURL(resolved).href)
      } catch {
        return new Response(null, { status: 500, statusText: 'Internal error' })
      }
    })
  })
}
