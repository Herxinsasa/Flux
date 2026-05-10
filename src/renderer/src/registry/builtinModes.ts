import { registerMode } from './editorModeRegistry'
import { EditorPane } from '../components/editor/EditorPane'
import { MarkdownEditor } from '../components/editor/MarkdownEditor'

// Text mode (F10)
registerMode({
  mode: 'text',
  component: EditorPane,
  label: 'Text Editor',
  extensions: [
    '.txt', '.csv', '.yaml', '.yml',
    '.log',
    '.sh', '.bat', '.cfg', '.ini', '.conf', '.env',
    /* 源码：走 EditorPane + languageFromPath 语法高亮 */
    '.cpp', '.cc', '.cxx', '.c', '.h', '.hpp', '.hh', '.ino',
    '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx',
    '.py', '.css', '.scss', '.html', '.htm', '.vue', '.svg',
    '.xml', '.sql',
  ],
})

// JSON mode (F9) — replaced by JsonEditor in task 2.2
registerMode({
  mode: 'json',
  component: EditorPane,
  label: 'JSON Editor',
  extensions: ['.json'],
})

// Markdown mode — Typora 式实时渲染（默认）+ Ctrl+/ 源码
registerMode({
  mode: 'markdown',
  component: MarkdownEditor,
  label: 'Markdown Editor',
  extensions: ['.md', '.markdown'],
})
