# baseline2.0 Code Review Archive

## Final Status

**APPROVED** after three finding-and-fix rounds. The independent review covered the cumulative TASK-001 through TASK-009 working tree. No P0 finding remained. The final tester rerun passed 37 test files and 194 tests.

> Review process note: the requested `.agents/agents/reviewer.md` was not present; the existing DevFlow reviewer prompt `.agents/agents/code-reviewer.md` was used.

## Round 1: Six Findings

### 1. P1 save generation race

- **Finding:** `Ctrl+S` could start with draft A, receive a response after draft B was typed, then mark the current A+B memory as clean even though only A was on disk. Closing the document could lose B.
- **References:** `src/renderer/src/hooks/useShortcuts.ts`; `src/renderer/src/stores/editorStore.ts`.
- **Fix:** save captures the document content, version and generation at request time; the response only updates the matching disk snapshot. Edits made during save remain dirty.
- **Regression evidence:** `tests/unit/save-generation.test.ts`; final focused save group 38/38 passed.

### 2. P1 session settings were not wired to UI/runtime

- **Finding:** REQ-018 retention, capacity and persistence controls had no settings UI or runtime call path; cleanup was exposed but not used.
- **References:** `src/renderer/src/components/settings/SettingsView.tsx`; `src/main/ipc/session-handlers.ts`; `src/main/services/session-store-service.ts`.
- **Fix:** settings now expose persistence, retention, capacity, usage, cleanup and clear actions; startup cleanup runs asynchronously using configuration.
- **Regression evidence:** `tests/unit/settingsSessionCleanup.test.ts`; session group 45/45 passed.

### 3. P1 first conversation/session recovery gap

- **Finding:** a new workspace's normal first chat did not create a session; restored events were not fully returned to chat state; compression cursor persistence was incomplete.
- **References:** `src/renderer/src/components/chat/ChatPanel.tsx`; `src/renderer/src/stores/sessionContextStore.ts`.
- **Fix:** the first normal send creates a session, user and completed assistant events are persisted, and restart restores events after a valid checkpoint with the compression cursor.
- **Regression evidence:** `tests/unit/sessionContextStore.test.ts`; session group 45/45 passed.

### 4. P1 UTF-16 log indexing corruption

- **Finding:** byte-oriented `0x0a` scanning broke UTF-16LE/BE line counts, offsets and paging.
- **References:** `src/main/services/log-index-service.ts`; `src/main/services/file-service.ts`.
- **Fix:** UTF-16LE/BE scanning is code-unit aligned after BOM, with correct carry handling and offsets; large-file decoding uses a streaming `iconv-lite` decoder.
- **Regression evidence:** `tests/unit/log-index-service.test.ts`; UTF-16/context group 29/29 passed, including non-ASCII pseudo-newline cases.

### 5. P1 synchronous large-log scan in AI context assembly

- **Finding:** first AI context assembly could call synchronous `getLogIndex` and block the Electron main event loop on a large log.
- **References:** `src/main/agent/context-assembler.ts`; `src/main/services/log-index-service.ts`.
- **Fix:** context assembly uses exact cached index data only; a cache miss schedules a deduplicated asynchronous index build and returns without a synchronous full scan.
- **Regression evidence:** `tests/unit/context-assembler.test.ts`; AI/context and UTF-16/context groups passed.

### 6. P2 review sidecar save/edit race

- **Finding:** a sidecar save response could overwrite a newer re-anchored state after the document was edited.
- **References:** `src/renderer/src/stores/reviewStore.ts`; `src/renderer/src/components/editor/EditorPane.tsx`.
- **Fix:** sidecar save and re-anchor use generation/source-hash checks; stale responses cannot overwrite newer anchors and the returned version token is used for the follow-up write.
- **Regression evidence:** `tests/unit/review-save-generation.test.ts`; review group 15/15 passed.

## Round 2: Four Findings

### 1. P1 pin-only checkpoint could hide persisted history

- **Finding:** pinning a fact advanced `throughSequence` even when there was no valid structured summary, causing restart to filter all historical messages.
- **Reference:** `src/renderer/src/stores/sessionContextStore.ts`.
- **Fix:** only `compact`, automatic compaction or legacy migration with a valid summary may advance the cold-history cursor; pin-only checkpoints keep hot messages recoverable.
- **Regression evidence:** session checkpoint and pin-restart tests; session group 45/45 passed.

### 2. P1 workspace switch reused the previous session and pinned facts

- **Finding:** switching from workspace A to B retained A's session ID, facts and summary, so B could write to or prompt with A's context.
- **Reference:** `src/renderer/src/stores/sessionContextStore.ts`.
- **Fix:** workspace reset clears session identity, facts, summary, cursor and chat messages; asynchronous loads verify workspace ownership before applying.
- **Regression evidence:** A-to-B isolation tests; session group 45/45 passed.

### 3. P1 settings cleanup could delete the active session

- **Finding:** the settings page called cleanup without protecting the active session; an active ID could become invalid while the renderer kept using it.
- **References:** `src/renderer/src/components/settings/SettingsView.tsx`; `src/renderer/src/stores/sessionContextStore.ts`.
- **Fix:** cleanup options support protected session IDs, and clear-data success resets in-memory state so the next send creates a new session.
- **Regression evidence:** `tests/unit/settingsSessionCleanup.test.ts`; session group 45/45 passed.

### 4. P2 UTF-16 indexing false matches on non-ASCII code units

- **Finding:** scanning every byte for UTF-16 newline patterns could split on a false match inside an adjacent code unit.
- **Reference:** `src/main/services/log-index-service.ts`.
- **Fix:** candidates are checked only on even code-unit boundaries relative to the BOM/data start offset; indexing and paging share the same absolute alignment rule.
- **Regression evidence:** LE `U+0A41/U+4200` and BE `U+4100/U+0A42` regression cases; UTF-16/context group 29/29 passed.

## Round 3: One Finding

### P1 manual settings cleanup still lacked active-session protection

- **Finding:** the settings button's manual cleanup path still omitted `protectedSessionIds`, even though background cleanup was protected.
- **Reference:** `src/renderer/src/components/settings/SettingsView.tsx`.
- **Fix:** manual cleanup reads the current `activeSessionId` and passes it as the protected session list; both active and no-active cases are covered.
- **Regression evidence:** `tests/unit/settingsSessionCleanup.test.ts` 2/2 focused pass; full suite 37/37 files and 194/194 tests pass.

## Final Review Decision

All 11 findings from the three rounds are closed. The final review marked the implementation **APPROVED**. Remaining items are validation gaps rather than open code-review findings:

- clean Windows install, upgrade, uninstall and real file-association smoke tests;
- real Provider request/cancel/timeout paths;
- Electron UI visual screenshots and interaction smoke tests;
- clean dependency environment for Electron runtime launch.

Key implementation areas reviewed include `src/main/services/file-service.ts`, `src/main/services/log-index-service.ts`, `src/main/services/session-store-service.ts`, `src/main/services/backup-service.ts`, `src/main/services/review-service.ts`, `src/main/agent/context-assembler.ts`, `src/renderer/src/stores/editorStore.ts`, `src/renderer/src/stores/reviewStore.ts`, `src/renderer/src/stores/sessionContextStore.ts`, `src/renderer/src/components/settings/SettingsView.tsx`, and `src/renderer/src/components/editor/EditorPane.tsx`.

## Post-Approval Runtime Startup Fix

On 2026-08-07, a real Electron development launch exposed a bundled main-process module-resolution failure: `BackupService.resolveDefaultRoot()` retained `require('../paths')` in `out/main/index.js`. The dynamic CommonJS require was replaced with a static `getBackupCacheDir` import so Electron Vite can include the dependency in the single-file bundle.

Verification: focused backup tests 4/4, full suite 194/194, production build, lint with 0 errors, no residual `require("../paths")` in the main bundle, and a real development launch reaching `App ready`, `Main window created`, renderer HTTP 200, and SkillManager initialization. Windows setup and portable artifacts were rebuilt after the fix.
