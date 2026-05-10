import { cpp } from '@codemirror/lang-cpp'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import type { Extension } from '@codemirror/state'

/**
 * 根据当前文件路径选择 CodeMirror 语言包（与 VS Code 同类：Lezer 语法树 + HighlightStyle）。
 * 未匹配的扩展名返回空数组，保持纯文本。
 */
export function getLanguageExtensionsForPath(path: string | null): Extension[] {
  if (!path) return []
  const i = path.lastIndexOf('.')
  if (i < 0) return []
  const ext = path.slice(i).toLowerCase()

  switch (ext) {
    case '.cpp':
    case '.cc':
    case '.cxx':
    case '.h':
    case '.hpp':
    case '.hh':
    case '.ino':
    case '.c':
      return [cpp()]
    case '.js':
    case '.mjs':
    case '.cjs':
      return [javascript()]
    case '.jsx':
      return [javascript({ jsx: true })]
    case '.ts':
      return [javascript({ typescript: true })]
    case '.tsx':
      return [javascript({ jsx: true, typescript: true })]
    case '.py':
      return [python()]
    case '.css':
    case '.scss':
      return [css()]
    case '.html':
    case '.htm':
    case '.vue':
      return [html()]
    case '.xml':
    case '.svg':
      return [xml()]
    case '.sql':
      return [sql()]
    default:
      return []
  }
}
