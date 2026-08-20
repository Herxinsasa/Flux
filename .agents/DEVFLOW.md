# DevFlow Codex Adapter

The adapted workflow in `.claude` remains authoritative. Files under `.agents` mirror its Skills and independent-agent prompts so Codex can discover and execute the same process.

| Claude Code concept | Codex execution |
|---|---|
| `.claude/skills/<name>/SKILL.md` | `.agents/skills/<name>/SKILL.md` |
| `.claude/agents/implementer.md` | Independent implementation agent using `.agents/agents/implementer.md` |
| `.claude/agents/code-reviewer.md` | Independent review agent using `.agents/agents/code-reviewer.md` |
| `.claude/progress.json` | Shared iteration state; update in place |
| `.claude/hooks` | Existing Git hook implementation; no duplicate Codex hook layer |

When a mirrored file differs from `.claude`, use the `.claude` version and refresh the mirror. Generated requirement, design, plan, UI, and test documents are shared by both frameworks.
