import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { tags as t } from '@lezer/highlight'

/**
 * 本地化语法配色：颜色全部来自 theme.css 中的 --cm-* 变量（随浅色/深色 data-theme 切换）。
 * 不设「可扩展主题」开关，仅一套 Flux 内置语义色。
 */
const fluxHighlightStyle = HighlightStyle.define([
  {
    tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.self],
    color: 'var(--cm-keyword)',
  },
  { tag: [t.moduleKeyword], color: 'var(--cm-preprocessor)' },
  { tag: [t.typeName, t.standard(t.typeName)], color: 'var(--cm-type)' },
  { tag: [t.namespace, t.className], color: 'var(--cm-class)' },
  {
    tag: [t.function(t.variableName), t.function(t.special(t.variableName))],
    color: 'var(--cm-function)',
  },
  { tag: [t.variableName], color: 'var(--cm-variable)' },
  { tag: [t.propertyName], color: 'var(--cm-property)' },
  { tag: [t.meta, t.changed], color: 'var(--cm-meta)' },
  { tag: [t.comment], color: 'var(--cm-comment)', fontStyle: 'italic' },
  { tag: [t.lineComment, t.blockComment], color: 'var(--cm-comment)', fontStyle: 'italic' },
  { tag: [t.string, t.special(t.string)], color: 'var(--cm-string)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--cm-number)' },
  { tag: [t.regexp], color: 'var(--cm-regexp)' },
  { tag: [t.operator, t.derefOperator], color: 'var(--cm-operator)' },
  { tag: [t.punctuation], color: 'var(--cm-punctuation)' },
  { tag: [t.bracket], color: 'var(--cm-bracket)' },
  { tag: [t.tagName], color: 'var(--cm-tag)' },
  { tag: [t.attributeName], color: 'var(--cm-attribute)' },
  { tag: [t.attributeValue], color: 'var(--cm-string)' },
  { tag: [t.heading], color: 'var(--cm-heading)', fontWeight: '600' },
  { tag: [t.strong], fontWeight: 'bold' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.link], color: 'var(--cm-link)' },
  { tag: [t.invalid], color: 'var(--cm-invalid)' },
])

/** 挂到 EditorPane：放在语言包之后 */
export const fluxSyntaxHighlighting: Extension = syntaxHighlighting(fluxHighlightStyle, {
  fallback: true,
})
