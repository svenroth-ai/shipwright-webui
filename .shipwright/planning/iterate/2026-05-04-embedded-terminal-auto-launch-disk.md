# Iterate Spec: embedded-terminal-auto-launch-disk (Stage A1)

- **Run ID:** iterate-20260504-embedded-terminal-auto-launch-disk
- **Type:** feature
- **Complexity:** medium (override — plan-validated 5-day scope)
- **Status:** draft
- **Source plan (contract):** `~/.claude/plans/sparkling-coalescing-kitten.md` v7 (approved via ExitPlanMode after external_review.py Round 4 cascade)
- **Successor of:** ADR-067 / iterate-2026-05-03-embedded-terminal-launcher (PR #3, merged `944c15d`)
- **Continues to:** Stage A2 `iterate/embedded-terminal-grace-resume-cta` (smart-grace + replay-only — gated on real-user feedback after A1 ships)

## Goal

Replace the copy-paste-clipboard launch ritual (FR-01.10 current contract) with a one-click auto-execute flow inside the embedded terminal, AND introduce disk-backed scrollback persistence so terminal history survives nav-away, page-reload, browser-restart, and OS-reboot (within a 24h TTL). Resume becomes implicit by persistence; an explicit Resume CTA appears when the pty died but scrollback exists. Stop-session remains explicit; Clear-history is split into a separate destructive action with confirm-modal.

The architectural pivot: **the launch command is sent client-side via `socket.send({type:"data", payload})` over the existing terminal WebSocket — not via server-side `pty.write`**. This keeps Plan-D'' clean: webui-Backend transports, the Browser-Tab (xterm) initiates, the whitelisted Shell spawns claude. ADR-067's "user-initiated"-Klausel is amended in ADR-068-A1 to interpret an explicit click on a `Launch` / `Resume` / `Relaunch` CTA as user-initiated — equivalent to the previous Strg+V+Enter ritual.

Out-of-scope (A1): smart-grace timers, replay-only-mode for done/failed tasks, `/runtime` presence endpoint, status-dot, refined CTA-matrix using runtime presence-state. Those are Stage A2.

## Acceptance Criteria

- [ ] **AC-1 (Auto-execute via WS data-frame):** Click on the header `Launch` CTA dispatches the launch flow: (1) POST `/api/external/tasks/:id/launch` returns `{task, commands: {powershell, cmd, posix}}`; (2) client POSTs `/api/terminal/:taskId/spawn` (idempotent prewarm); (3) `setCenterTab("terminal")` flips the Radix Tabs.Root; (4) when WS reaches `ready=true && role="writer"` AND the prompt-readiness handshake (AC-3) passes, EmbeddedTerminal sends `{type:"data", payload: commands[shellKind] + "\r"}`. ZERO clipboard interaction. Plan-D'' satisfied via existing pty-manager whitelist (no change). FR-01.10 contract amended.

- [ ] **AC-2 (LaunchCoordinatorContext replaces window event):** A new React context `LaunchCoordinatorContext` (scoped to TaskDetailPage) carries `pendingLaunch: {launchToken: number, commands, resume, expiresAt}`. TaskDetailHeader calls `coord.dispatchAutoLaunch(commands, resume)` instead of `window.dispatchEvent(new CustomEvent("webui:auto-launch"))`. EmbeddedTerminal reads `coord.pendingLaunch` via `useLaunchCoordinator()` and calls `coord.consumeLaunch(token)` after sending bytes. The `webui:launch-copied` window event is removed; tests + listeners migrated. (Decision #20.)

- [ ] **AC-3 (Prompt-readiness handshake):** EmbeddedTerminal's auto-execute path waits for the shell to be ready to accept input: `dataSeenInitially === true && Date.now() - lastPtyDataAt >= 250ms`. Hard cap: 3 seconds. Then sends bytes. Defends against `.bashrc` / `$PROFILE` / oh-my-zsh / Starship taking 200-2000ms to render the first prompt. (Decision #12.)

- [ ] **AC-4 (Launch-token deduplication + idempotent consume):** Each `dispatchAutoLaunch` increments a monotonic `launchToken: number`. EmbeddedTerminal maintains a `consumedTokens: Set<number>`; replay-mounts, StrictMode-double-mounts, WS-reconnects, and any other re-render path that triggers the auto-execute effect MUST NOT result in duplicate command injection. CTA disabled while `launchMut.isLoading || coord.pendingLaunch !== null`. Rapid-clicks → single launch. (Decision #16.)

- [ ] **AC-5 (Pending-launch cancellation paths):** `coord.cancelLaunch(reason)` is called in three deterministic paths: (a) `socket.role === "reader"` after WS handshake → `cancelLaunch("role-not-writer")`; (b) TaskDetailPage component unmount (route-change away from TaskDetail) → `cancelLaunch("page-unmount")`; (c) 30 seconds elapsed without injection → `cancelLaunch("timeout")`. After cancel, CTA re-enables; user can click Launch again. (Decision #17.)

- [ ] **AC-6 (Disk-backed scrollback persistence — ScrollbackStore):** New `server/src/terminal/scrollback-store.ts` (~200 LOC). Per-task file `<registryDir>/terminal-scrollback/<taskId>.log`. `pty.onData(data)` synchronously calls `scrollbackStore.append(taskId, data)` — non-locked, never throws, WriteStream serializes itself. Lazy-init on first append. Per-task `PQueue` (concurrency=1) used for `rotate` / `read` / `clear` / `closeStream` (NOT `append`). UUID format validated on every public method (`/^[0-9a-fA-F-]{36}$/` — throws `invalid_task_id` otherwise). File mode `0o600`, dir mode `0o700` (POSIX-enforced; Windows best-effort + privacy disclosure note in UI). (Decisions #1 / #3 / #5 / #7 / #8 / #9.)

- [ ] **AC-7 (Atomic 4-state rotation state-machine):** `ScrollbackStore` maintains per-task `state: "NORMAL" | "ROTATING" | "ROTATION_FLUSH"`. When append-cumulative > `maxBytesPerTask` (default 1 MiB; 0 = disabled), state flips to `ROTATING` (queued in PQueue). During `ROTATING` and `ROTATION_FLUSH`, `append` writes to a `rotationBuffer: Buffer[]` (cap 4 MiB; overflow throws + structured-error-log). Rotation flow: drain current stream → safeRename `.log` → `.log.1` (Windows-safe retry on EBUSY/EPERM, max 3 attempts, jittered 50→100ms) → close → reopen fresh stream → flush rotationBuffer → state-flip back to `NORMAL`. (Decisions #6 / #13.)

- [ ] **AC-8 (Replay-on-attach with pty.pause):** WS upgrade `onOpen` flow: (1) `attach()` + `subscribeForConnection()` with `liveBuffer: Buffer[]`; (2) send `{type:"ready", role, shellKind, cwd}`; (3) `entry.ptyHandle.pause()` (Decision #15 — A1, NOT deferred to A2); (4) `await scrollbackStore.read(taskId)` returns last `maxBytesPerTask` bytes via `StringDecoder` (combines `.log` + `.log.1`); (5) chunked replay envelope: `replay_start` / `replay_chunk` (64 KiB chunks, await `bufferedAmount < HWM` between chunks) / `replay_separator` (yellow dim banner) / `replay_end`; (6) flush `liveBuffer` to WS; (7) `entry.ptyHandle.resume()`; (8) `replayDone = true`, future onData go direct. Multi-byte UTF-8 split across rotation boundary handled via `StringDecoder` (no replacement chars). (Decisions #4 / #15.)

- [ ] **AC-9 (Stop / Clear-history split — destructive default removed):** `POST /api/terminal/:taskId/close` semantics CHANGED: kills pty only, **scrollback retained**. Returns 204. NEW `POST /api/terminal/:taskId/clear-scrollback` — calls `scrollbackStore.clear(taskId)` which throws on failure (5xx). Header CTA shows `Stop session` (kill pty only) when WS shows `role=writer && pty alive`. `Clear history` lives in a `...` overflow menu with a confirm-modal dialog before POST. `DELETE /api/external/tasks/:id` cascade-cleans via `clearBestEffort` (existing). (Decision #18.)

- [ ] **AC-10 (Realpath-at-op-time path-guard):** `clear()` and `rotate()` resolve `path.resolve` + `fs.realpath` on every call (not just boot-time `realPathGuard(dir)`). If the resolved target falls outside `dir`, the operation rejects with structured-error-log + throws `scrollback_path_outside_dir`. Defends against mid-runtime symlink-swap of `<taskId>.log` to a path outside the scrollback dir. Boot-time `realPathGuard` remains as first-line defense. (Review-v7 HIGH GPT #2.4.)

- [ ] **AC-11 (TTL sweep + active-task-aware skip):** Boot + daily periodic `sweepExpired(ttlDays, { activeTaskIds, maxFilesPerPass: 100 })`. Default TTL: 1 day (privacy-first). Active definition: task in `sdk-sessions.json` with `state ∈ {active, idle, awaiting_external_start, jsonl_missing}` OR live pty entry in pty-manager. "Stale active" tasks (active state but no live pty) are skipped — their history survives until TTL or explicit clear. Bounded: max 100 files per pass, oldest-first by mtime. Structured logging (NEVER logs replay payloads or command contents). (Review-v7 HIGH GPT #2.1 / #3.4.)

- [ ] **AC-12 (Disabled mode via env var):** `SHIPWRIGHT_TERMINAL_SCROLLBACK_MAX_BYTES=0` disables persistence entirely. `append()` returns early (no file creation). WS upgrade skips replay (no `replay_*` envelopes sent). `bytes()` returns 0. `read()` returns "". Live terminal works normally without persistence. Privacy escape hatch.

- [ ] **AC-13 (FD lifecycle on pty.kill):** `pty-manager.kill(taskId)` calls `await scrollbackStore.closeStream(taskId)` (close WriteStream, leave file on disk). On 100 rapid open/close cycles, Node FD count returns to baseline (no EMFILE leak). Verifiable via fd-leak-smoke test.

- [ ] **AC-14 (Graceful server shutdown):** `scrollbackStore.shutdown(timeoutMs=5000)` drain + close all streams within timeout. Server bind-error handler / SIGINT / SIGTERM hooks call this before process exit.

- [ ] **AC-15 (Privacy disclosure UI):** Terminal-tab footer or settings card carries an info-icon with the message: "Terminal scrollback is persisted locally for {N} day(s) under {scrollbackDir}. May contain command output including secrets, env vars, paths. On Windows, filesystem permissions are best-effort — rely on user-account ACLs. Click 'Clear history' to delete now." `N` is read from `SHIPWRIGHT_TERMINAL_SCROLLBACK_TTL_DAYS`. Visible whenever user opens the Terminal tab on a task that has scrollback bytes. (Review-v7 HIGH GPT #2.1.)

- [ ] **AC-16 (About-to-run preview disclosure):** Click `Launch` → before injection, the Terminal pane header shows a one-line preview banner "About to run: `claude --session-id ... --name '...'`" with optional disclosure-toggle to expand the full command. After injection, banner fades to a 2s success state then collapses. For custom-action launches (not the bundled defaults), banner is non-collapsible. Replaces the clipboard-visual-gate that auto-execute removed. (Review-v7 CRITICAL #1 mitigation.)

- [ ] **AC-17 (Spec 74 happy-path + edge-case Playwright coverage):** New `client/e2e/74-auto-launch-disk-persistence.spec.ts` covers: (a) auto-launch happy-path (click Launch → tab flips → claude UI visible, no clipboard); (b) reader-role gate (CTA disabled in 2nd writer-occupied tab); (c) tab-flip-race (rapid clicks → single launch via launchToken); (d) prompt-readiness delay (250ms quiesce verified via mock-pty with deferred prompt); (e) cancellation on page-unmount (navigate away mid-pending → no zombie launch); (f) 30s timeout cancel + CTA re-enable; (g) Stop preserves history (re-attach replays scrollback); (h) Clear history with confirm-modal; (i) replay shows separator + complete history after nav-away+return; (j) disabled-mode (env var = 0 → no replay frames); (k) hostile-ANSI regression (xterm config audit — OSC52 clipboard-write disabled; CSI escape probe). FR-01.28 ACs amended.

- [ ] **AC-18 (FR-01.10 + FR-01.28 spec amendments — Phase 0 first):** Per `feedback_iterate_spec_drift_hygiene` memory: BEFORE any code commits, `.shipwright/planning/01-adopted/spec.md` is updated to: (i) FR-01.10 row description amended ("returns the three-shell copy-command for the task" preserved as API contract; "client may auto-execute via WS data-frame OR present as copy-string" added); FR-01.10 ACs amended (new (E) "Given the user clicks the launch CTA in TaskDetail, when the embedded-terminal Toggle-Tab is the active surface, then the command is auto-executed via `socket.send({type:'data', payload})` once the WS is in `writer` role AND prompt-readiness handshake completes; clipboard interaction is removed; Plan-D'' compliance via Decision #11 user-initiated amendment"; old (E) marked superseded but retained in commit history). (ii) FR-01.28 ACs extended: replay-on-attach + Stop/Clear-history split + disabled-mode + privacy disclosure. ADR-068-A1 captures the architectural amendment + Decisions #10-20 in detail.

- [ ] **AC-19 (CLAUDE.md DO-NOT #18 + #19):** Two new DO-NOT regression guards: (i) **#18:** "Scrollback path-guard is realpath-at-op-time, not boot-time-only. UUID validation precedes every file op. File-naming is `<taskId>.log` per Decision #14 — DO NOT key by sessionUuid." (ii) **#19:** "Auto-execute is via client-side WS data-frame (`socket.send({type:'data', ...})`), NOT server-side pty.write. The launch command is built EXCLUSIVELY by `launcher.ts buildCopyCommands()` (shell-quoting via qPs/qCmd/qPosix); `.webui/actions.json` is NOT consumed in the auto-launch path. React `LaunchCoordinatorContext` replaces `window.dispatchEvent(new CustomEvent('webui:launch-copied'))` for execution-critical actions."

- [ ] **AC-20 (TSC baseline + lint + e2e + Codex final pass):** Server + client both `npm run typecheck` + `npm run lint` clean (no NEW errors over the 4 documented baseline). All vitest suites green. Spec 35 (no-chat-panel regression) green. Spec 73 (existing embedded-terminal happy-path) green. Spec 74 (new) green. external_review.py --mode code passes after Phase 3 + Phase 5. /codex:rescue final pass triages any 5%-bugs missed by openrouter LLMs.

## Affected FRs

The following FRs are amended in `01-adopted/spec.md`. Every affected FR row has its description updated AND new acceptance criteria appended; "additive side-effect" is NOT a skip reason (memory `feedback_iterate_spec_drift_hygiene`).

- **FR-01.10 (EXTEND):** Description amended to note auto-execute path; old clipboard-only AC marked superseded; new AC added per AC-18(i).
- **FR-01.28 (EXTEND):** Description amended to add scrollback persistence + Stop/Clear split + auto-execute; new ACs added per AC-6 / AC-8 / AC-9 / AC-15.
- **FR-01.02 (EXTEND):** TaskDetail header CTA matrix described in line with new state-aware Launch / Resume / Relaunch / Stop / Clear surface.

NEW endpoint additions:
- `POST /api/terminal/:taskId/clear-scrollback` (returns 204 / 5xx)

Existing endpoint semantics CHANGED:
- `POST /api/terminal/:taskId/close` — was kill+clear; now kill only, scrollback retained.
- `DELETE /api/external/tasks/:id` — cascade extended to `scrollbackStore.clearBestEffort(taskId)`.

## Out of Scope (Stage A1; deferred to A2 or beyond)

- **Smart-grace timers** (per-conn unmount tracking, 30s short / 10min long). Pty still dies on last-conn-close in A1.
- **Replay-only-mode WS flag** for `done`/`launch_failed` tasks (no pty spawn — pure replay).
- **`/api/terminal/:taskId/runtime`** endpoint exposing `TerminalPresence` state machine.
- **Refined CTA-matrix** distinguishing pty-alive vs dead vs grace × scrollback>0 vs =0.
- **Tab-trigger status-dot** (green=live / gray=history / none).
- **Total-disk global quota** + LRU eviction (per-task cap reigns in A1).
- **Per-task UI toggle for persistence** (env-var disable suffices in A1).
- **Multi-tab writer-handoff explicit UI** (writer-promotion remains existing ADR-067 behavior).
- **Persistence-format versioning** (raw byte-stream files, no header).
- **Resize-aware replay** (xterm wraps at current cols; persisted ANSI-wrap at original cols → known limitation accepted; documented).
- **Process resurrection / cross-server-restart pty preservation** (no tool can do this).
- **Encrypted scrollback at rest** (env-var disable suffices).
- **Observability counters / metrics endpoint** (structured logs suffice).
- **Windows ACL hardening via icacls** (POSIX modes + privacy disclosure suffice).
- **Resume former-writer reclamation flow** (existing ADR-067 writer-handoff behavior unchanged).
- **Connection-count limits per task** (loopback-only trust model).
- **Copy-paste fallback UI** (entirely removed; `launcher.ts` API still returns commands for backward-compat with potential future per-user opt-in).
- **External-terminal launch path** (deprecated as primary UX; copy-command generators preserved server-side).

## Design Notes

UI is invisible mostly — the launch flow becomes one click. Visual changes:
- **Header CTA matrix** state-aware: `Launch` (green) / `Open Terminal` (gray) / `Resume` (orange — pty died but scrollback>0) / `Relaunch` (gray — done/failed) / `Stop session` (gray — pty alive). Reuses Radix `<Button>` variants from existing TaskDetailHeader.
- **Stop session** primary in header CTA cluster when applicable. **Clear history** in a `...` overflow menu with destructive variant + confirm-modal (reuses existing `ConfirmDeleteDialog` pattern).
- **About-to-run preview banner** in Terminal-pane header — collapsible 1-line shell-command preview before injection; 2s success state after; non-collapsible for custom actions.
- **Privacy disclosure info-icon** in Terminal-tab footer / Settings card — info-icon with retention text + Windows limitation note + "may contain secrets" warning.
- **Replay-separator** — yellow-dim ANSI banner `── Shipwright: scrollback restored from disk; live shell below ──` between replayed history and fresh shell prompt.

Affected mockup files: none (text + button changes only; no new screens).
Design tokens applied: existing brand-amber dim ANSI colors via xterm theme; existing brown/green/orange semantic CTA colors.
Deviations from visual guidelines: none.

Components affected:
- **NEW:** `client/src/contexts/LaunchCoordinatorContext.tsx`, `server/src/terminal/scrollback-store.ts`, `client/e2e/74-auto-launch-disk-persistence.spec.ts`.
- **EXTEND:** `client/src/components/external/TaskDetailHeader.tsx`, `client/src/components/terminal/EmbeddedTerminal.tsx`, `client/src/hooks/useTerminalSocket.ts`, `client/src/pages/TaskDetailPage.tsx`, `server/src/terminal/{pty-manager,routes}.ts`, `server/src/external/routes.ts`, `server/src/config.ts`, `client/src/components/external/TerminalLaunchButton.tsx` (deprecated clipboard path, kept as fallback for non-TaskDetail surfaces).

## Affected Boundaries

`touches_io_boundary` risk flag fires on the new disk-write surface.

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| `server/src/terminal/scrollback-store.ts:append` (raw `Buffer` chunks via `WriteStream`) | `server/src/terminal/scrollback-store.ts:read` (StringDecoder UTF-8 → string) | Raw byte stream; multi-byte UTF-8 may split across rotation; ANSI escapes inline |
| `server/src/terminal/pty-manager.ts:onData` (broadcaster) | `client/src/components/terminal/EmbeddedTerminal.tsx` (xterm.write) | UTF-8 string envelope `{type:"data", payload}` over WS |
| `server/src/terminal/scrollback-store.ts:rotate` (`.log` → `.log.1`) | `server/src/terminal/scrollback-store.ts:read` (combines both files) | Same byte format; rename atomic via fs.rename retry-loop |
| Browser `LaunchCoordinatorContext.dispatchAutoLaunch(commands)` | `EmbeddedTerminal.tryInjectPending` → `socket.send({type:"data", payload + "\r"})` | UTF-8 shell-quoted command string |

Boundary Probe (Path A Step 6a) tests required:
1. Round-trip producer → file → consumer with multi-byte UTF-8 string spanning rotation boundary.
2. Round-trip with ANSI CSI escape spanning chunk boundary.
3. Edge: rotation triggered mid-burst-of-50-appends; no bytes lost.
4. Edge: `read()` after `closeStream()` returns last-known-bytes (file-system-cached).
5. Edge: rotation during read — PQueue serializes correctly; read sees coherent state.
6. Edge: malformed UTF-8 byte-sequence in write → read returns U+FFFD replacement chars (not crash).
7. Edge: 0-byte write does nothing (no file creation, sizeCache unchanged).
8. Edge: hostile ANSI payload (OSC52 clipboard-write attempt; CSI cursor manipulation) round-trips faithfully but xterm-config disables OSC52 honoring — regression test asserts xterm theme/options.

## Confidence Calibration

Mandatory at medium per skill matrix. Populated post-implementation, before F0 Fresh Verification Gate:

- **Boundaries touched:** four producer/consumer pairs above.
- **Empirical probes run:** _to be filled in by Phase 1 + Phase 2 + Phase 5 testing — list of vitest test names + Playwright spec assertions; each probe = real round-trip not "I re-read the diff"_.
- **Edge cases NOT probed + why acceptable:** _to be filled in_ — likely candidates for accepted-with-rationale: operator-input categories on the LaunchCoordinatorContext token format (machine-only state, never user-edited).
- **Confidence-pattern check:** _to be filled in post-Phase-5_ — has any "are you confident?" fired with subsequent finding? If yes, run one more probe before F0.

Stopping rule: declared exhausted when most recent probe returned no finding AND all 8 categories covered AND no yes-then-bug pattern fired.

## Cascade Review Plan (per memory feedback_review_cascade_pattern)

| Stage | When | Tool | Catches |
|---|---|---|---|
| **Plan-stage external review** | DONE pre-Phase-0 | external_review.py --mode plan (Round 4 trace in plan v7) | architectural mistakes, spec gaps, security model holes |
| **Code-stage external review #1** | After Phase 3 (auto-launch flow feature-complete) | external_review.py --mode code on `git diff main..HEAD` | implementation bugs, race conditions, edge cases the plan-review can't see |
| **Live integration smoke** | BEFORE every commit | manual `cd server && npm run dev` + `cd client && npm run dev` + click-through | ESM mismatches, Vite proxy gaps, header CTA event-dispatch bugs |
| **Code-stage external review #2** | After Phase 5 (final feature-complete) | external_review.py --mode code (incremental diff) | last-implementation-pass bugs |
| **Codex final pass** | After Phase 5, BEFORE finalize | /codex:rescue --mode code-review | last 5% bugs openrouter-LLMs miss (ADR-067 PR #3 lesson) |

## Phasing (5 Werktage, 6 commits)

| # | Tag | Scope | Verify gate |
|---|---|---|---|
| **0** | 1 | Spec FR-01.10 + FR-01.28 amend; ADR-068-A1; CLAUDE.md DO-NOT #18 + #19; doc-sync.test.ts tokens | doc-sync.test green; spec drift detector ack |
| **1** | 1-2 | ScrollbackStore foundation: 4-state rotation + p-queue + UUID validation + realpath-at-op-time + StringDecoder + 0600/0700 perms + ~30 unit tests (incl. EBUSY rotation, multi-byte UTF-8 split, FD-leak smoke, rotation-during-rapid-append, symlink-swap-detection) | `cd server && npm run test scrollback` |
| **2** | 2 | pty.onData append; routes.onOpen replay-flow with pty.pause/resume; chunked replay protocol; bufferedAmount-throttle; client envelope handlers; integration test attach→pause→replay→flush→resume→live | live smoke (nav-away+return + npm-install-stress); BEFORE commit |
| **3** | 2-3 | LaunchCoordinatorContext + EmbeddedTerminal injectCommand + prompt-readiness handshake + launch-token dedup + cancel-paths + about-to-run preview disclosure + TaskDetailHeader CTA matrix; pre-warm POST /spawn | live smoke + **Phase-3 external_review.py --mode code** + Spec 74 partial (auto-launch ACs) |
| **4** | 3 | POST /close kill-only; POST /clear-scrollback NEW; DELETE task cascade; boot-sweep + daily periodic + active-task-aware skip; MAX_BYTES=0 disabled-mode; Stop/Clear-history header CTAs with confirm-modal | live smoke + cleanup-matrix manual + Spec 74 cleanup ACs |
| **5** | 4-5 | Privacy disclosure UI + Spec 74 finalize + xterm OSC52 audit + hostile-ANSI regression tests + docs (decision_log.md ADR-068-A1 + architecture.md write-surface note) | full vitest + Playwright + lint + typecheck + **Phase-5 external_review.py --mode code (incremental)** + **Codex /codex:rescue final pass** |

## Spec drift hygiene checklist

Per `feedback_iterate_spec_drift_hygiene`:
- [x] FR-01.10 description amended (Phase 0)
- [x] FR-01.10 acceptance criteria amended (Phase 0)
- [x] FR-01.28 description amended (Phase 0)
- [x] FR-01.28 acceptance criteria appended (Phase 0)
- [x] FR-01.02 minor amendment (header CTA matrix description)
- [x] architecture.md Data-Flow section: new write-surface (`<registryDir>/terminal-scrollback/<taskId>.log`)
- [x] architecture.md ADR-068-A1 entry under "Architecture Updates"
- [x] CLAUDE.md DO-NOT #18 + #19
- [x] client/src/test/doc-sync.test.ts tokens (scrollback-store.ts + LaunchCoordinatorContext.tsx)
