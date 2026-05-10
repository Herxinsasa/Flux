import { type Extension, RangeSetBuilder } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

type LogLevelClass =
  | 'cm-log-level-fatal'
  | 'cm-log-level-error'
  | 'cm-log-level-warning'
  | 'cm-log-level-info'
  | 'cm-log-level-debug'

const logLevelDecorations: Record<LogLevelClass, Decoration> = {
  'cm-log-level-fatal': Decoration.mark({ class: 'cm-log-level-fatal' }),
  'cm-log-level-error': Decoration.mark({ class: 'cm-log-level-error' }),
  'cm-log-level-warning': Decoration.mark({ class: 'cm-log-level-warning' }),
  'cm-log-level-info': Decoration.mark({ class: 'cm-log-level-info' }),
  'cm-log-level-debug': Decoration.mark({ class: 'cm-log-level-debug' }),
}

function classifyLogLine(text: string): LogLevelClass | null {
  if (/\b(fatal|critical|panic)\b/i.test(text)) return 'cm-log-level-fatal'
  if (/\b(error|err|exception|failed|failure)\b/i.test(text)) return 'cm-log-level-error'
  if (/\b(warn|warning)\b/i.test(text)) return 'cm-log-level-warning'
  if (/\b(info|notice)\b/i.test(text)) return 'cm-log-level-info'
  if (/\b(debug|trace|verbose)\b/i.test(text)) return 'cm-log-level-debug'
  return null
}

function buildLogDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const doc = view.state.doc

  for (const { from, to } of view.visibleRanges) {
    let line = doc.lineAt(from)
    while (line.from <= to) {
      const levelClass = classifyLogLine(line.text)
      if (levelClass && line.from < line.to) {
        builder.add(line.from, line.to, logLevelDecorations[levelClass])
      }

      if (line.number >= doc.lines) break
      line = doc.line(line.number + 1)
    }
  }

  return builder.finish()
}

const logLineColoringPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildLogDecorations(view)
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildLogDecorations(update.view)
      }
    }
  },
  {
    decorations: (value) => value.decorations,
  },
)

export const logLineColoring: Extension = [logLineColoringPlugin]