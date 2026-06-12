# Conventions — shipwright-webui

## Linter / Formatter

- **Linter**: oxlint — `npm run lint` (`oxlint .`) wired in both `client/` and `server/`; CI runs it per workspace (iterate-2026-05-19-oxlint-and-cors-env)
- **Formatter**: _none detected_
- **TypeScript strict**: no
- **.editorconfig**: _none_

## Project-specific rules

TypeScript runs in strict mode across both halves; `npm run build` (which runs `tsc`) exits 0 on both halves. The historical "4 baseline errors tracked" carve-out from ADR-035 was retired by ADR-080 — server now ships verbatim mirrors of `Task`, `GlobalSettings`, `Project` under `server/src/types/`; cross-package imports back into `client/src/types/` are rejected by the comment-aware drift-guard at `server/src/test/no-cross-package-imports.test.ts`. Hono routes live in `server/src/routes/` (one file per resource); the external-launch surface is registered from `server/src/external/routes.ts` and split into 11 sub-routers under `server/src/external/{tasks,launch,transcript,inbox,actions,preview,tree,file,run-config,media,pr-status}/` (Campaign C / C2 + ADR-141/156). React components in `client/src/components/` are grouped by UI area (`external/`, `terminal/`, `triage/`, `settings/`, `sidebar/`, `wizard/`, `common/`); large area-roots have been split into per-area subfolders (`external/BubbleTranscript/`, `external/NewIssueModal/`, `external/TaskDetailHeader/`, `external/SmartViewer/`). Files stay under 300 lines — anything larger gets split, with the bloat-baseline + pre-commit hook (see [Pre-commit hooks](../../CLAUDE.md#pre-commit-hooks)) as the enforcement floor; documented deep-module exceptions (ADR-101 `pty-manager.ts`, ADR-103 `terminal/routes.ts`) ride on explicit ADRs.

Data fetching uses TanStack React Query with sequential 1 s polling for transcript updates (no SSE, no chokidar). Styling is TailwindCSS 4; accessible primitives come from Radix UI. Markdown rendering is bespoke via `react-markdown` + `remark-gfm` + `rehype-highlight` + `strip-ansi` — `@assistant-ui/*` packages are explicitly forbidden (DO-NOT guard #4 in CLAUDE.md). Auto-scroll is CSS-first: `overflow-anchor: auto` + `scroll-padding` on the scroll container, with a small ref-based `useAutoScroll` as the safety net for Chrome+polling.

Commits follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`). The repo has no root `package.json` — `server/` and `client/` are independent workspaces, each with its own `npm run dev | build | test | lint | typecheck`. CI runs through `.github/workflows/ci.yml`; there is no detected linter / formatter / editorconfig at the root level (each workspace owns its own). E2E lives in `client/e2e/` (Playwright); the multi-service detector pivots Playwright setup into `client/` because that is where `package.json` and `playwright.config.ts` live.

Three categories of regression guards are spelled out in CLAUDE.md and must be respected: (1) the WebUI never writes into Claude's JSONL or `shipwright_run_config.json`; (2) the chat composer must not be re-introduced (Spec 35 is the regression fence); (3) phase strings (`build`, `plan`, `design`, `iterate`) and slash-command names must not be hardcoded — they come from `/api/external/projects/:id/actions`. A meta-test (`client/src/test/doc-sync.test.ts`) keeps the file-map in CLAUDE.md honest.

## Commit messages

- Use Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- Scopes should reflect module boundaries (e.g., `feat(auth): ...`)

## Files

- Keep files under 300 lines; split larger modules.
- Tests live alongside implementation with `.test.*` / `_test.*` suffix OR in a `tests/` directory — whichever is consistent with the rest of the codebase.

---

> **Architecture rules** + **DO-NOT regression guards** are load-bearing. Their full, always-loaded normative text + rationale live in [`../../CLAUDE.md`](../../CLAUDE.md) (§ "Architecture rules", § "DO-NOT regression guards"); read it + the cited ADR before deviating. This file keeps only a terse index so the rule set stays discoverable from `conventions.md` without duplicating — and drifting from — CLAUDE.md.

## Architecture rules (index — full text in CLAUDE.md)

1. Webui never spawns Claude — `core/launcher.ts` emits command strings; the embedded-terminal pane auto-executes after a Launch/Resume/Relaunch click (ADR-068-A1) or the user copies them; pty-manager shell-only whitelist (ADR-067) is the enforcement line. Guard: spec `35-no-chat-panel.spec.ts`.
2. Task state derives from `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` + the persistent store; session UUID pre-bound via `crypto.randomUUID()`.
3. Discovery is filename-first (`<uuid>.jsonl`); first-line sessionId is a sanity check.
4. Transcript endpoint is stateless (`?fromByte=&expectFingerprint=`) → multi-tab for free; UTF-8-safe chunking on linefeed boundaries; torn-read retry 6x (`core/session-watcher.ts`).
5. No SSE / no chokidar — sequential 1 s client polling; watcher state derived on demand from mtime.
6. Plugin dirs re-passed on every launch (`--plugin-dir` does not survive `--resume`); `MIN_SUPPORTED_CLI` pinned (`core/cli-compat.ts`).
7. Preview-capability precedence (ADR-044): `stack.frontend` AND `dev_server.command` gate `<PreviewButton>`; `.shipwright-webui/actions.json` `actions.preview.enabled=false` hides it regardless.

## DO-NOT regression guards (index — full text + rationale in CLAUDE.md)

1. DO NOT write into Claude's JSONL under `~/.claude/projects/` — read-only observer; title sync uses `--name` at launch (ADR-035).
2. Auto-scroll is CSS-first (`overflow-anchor:auto` + `useAutoScroll` safety net); no stale scroll libs (ADR-035; virtualized carve-out ADR-063 was reverted — see Learnings).
3. DO NOT re-introduce a chat composer (ADR-034; spec 35 fails the build).
4. DO NOT re-add `@assistant-ui/*` — rendering is bespoke `react-markdown` + `remark-gfm` + `rehype-highlight` + `strip-ansi`.
5. DO NOT run `claude --resume <uuid>` as a webui side-effect while a user session may be live (SQLite lock + JSONL interleave); title updates apply on the next user-initiated launch.
6. Multi-writer state files use `proper-lockfile` (ELOCKED → 409), not temp+rename.
7. Type-system isolation (ADR-080): `server/src/types/` verbatim mirrors of client types; no cross-package imports (`no-cross-package-imports.test.ts` + `action-schema-sync.test.ts`).
8. Schema v2/v3 is write-on-touch (ADR-044) — never batch-rewrite on boot (ADR-038 rejected).
9. Preview spawn uses `shell:false` (ADR-044) — single path `core/preview-session-manager.ts`.
10. Path-guard is `realpath + path.relative`, not `startsWith` (ADR-044); null-byte hard-reject; shared `core/path-guard.ts`.
11. DO NOT hardcode `shipwright-run` / phase strings in components — read `/api/external/projects/:id/actions` (ADR-044); guard `doc-sync.test.ts`.
12. DO NOT write into `shipwright_run_config.json` — read-only via `core/run-config-reader.ts` / `useRunConfig()`.
13. Phase-task launches use the pre-bound `sessionUuid` from run-config (409 `phase_task_session_uuid_mismatch`); `phaseTaskRef` ⊕ `actionId` (400 `mixed_launch_intents`).
14. All pipeline-continuation entry points share `useContinuePipeline()` (atomic re-fetch + idempotent shadow lookup + verified launch).
15. Schema v3 additive + write-on-touch (`phaseTaskId`/`runId`/`parentRunMaster`); loader accepts v1+v2+v3.
16. Stale `in_progress` detection uses run-config timestamps only — never JSONL mtime.
17. pty-manager spawn target MUST be a whitelisted shell binary, never `claude` (ADR-067); image-paste/append-gitignore via `realPathGuard`; 8 MiB cap + 9 MiB Content-Length precheck + magic-byte sniff; WS upgrade is the authoritative pty creation path.
18. Scrollback path-guard is `realpath` at every op (ADR-068-A1); file `<taskId>.log`; rotate/read/clear via per-task PQueue; replay-on-attach uses `pty.pause/resume`, never drops chunks.
19. Auto-execute is a CLIENT-SIDE WS data-frame, not server `pty.write` (ADR-068-A1); command built only by `core/launcher.ts buildCopyCommands()`.
20. Cell-state snapshots are the SOLE replay primitive (ADR-087, amended ADR-097); one `replay_snapshot` per attach; chunked envelopes retired; failure mode = blank terminal + live shell.
21. WS replay precedence is LIVE-mirror first, disk-snapshot fallback (ADR-092); snapshot-on-detach via `detachAndCount` atomically; never `mirror.dispose()` from `flushMirrorSnapshot`.
22. xterm.js + addons exact-pinned 6.0.0 (ADR-097/098); snapshot envelope v2; `CLAUDE_CODE_NO_FLICKER` default ON; no `windowsMode`.
23. Bloat-baseline exceptions ride on explicit ADRs (`pty-manager.ts` ADR-101, `terminal/routes.ts` ADR-103); the pre-commit hook only blocks RATCHETING an existing baseline entry.

## Learnings

Hard-won, mostly empirical; many predate or complement an ADR. Tighten, do not delete.

**Testing / jsdom**
- jsdom has no `Blob.prototype.text()` — use a `FileReader` (`readAsText`) polyfill (`ActionsConfigCard.readFileAsText`).
- Radix Tabs/menus need `userEvent.click` in jsdom — `fireEvent.click` only dispatches click, Radix listens on pointer events (silent no-op).
- Radix `<Tabs.Content>` unmounts inactive subtrees — `forceMount` + CSS hide for any tab owning load-bearing state (xterm + WS); fence with a mount-counter spy.
- Playwright route-mocks: `apiFetch` endpoints need a `{ data: T }` envelope; bare-`fetch` endpoints (`/api/triage/*`) take the raw object.
- A module-level `const` reading `process.env` is baked at import — scrub env in `vi.hoisted()`, not `beforeEach` (ADR-115 CORS test).
- Drift-guard "no X imports" tests must scan whole stripped content, span newlines, anchor on path segments (ADR-080).

**xterm / terminal**
- xterm v6 needs the scoped `@xterm/*` packages + its CSS bundle; pty via `@lydell/node-pty` (node-pty-prebuilt lacks Node 22 / win32 prebuilds) (ADR-067).
- xterm Ctrl+V uses the async Clipboard API, NOT a DOM `paste` event — capture-phase listeners never see real Ctrl+V; intercept via `attachCustomKeyEventHandler`. (The v0.8.3 image-paste use of this was later REVERTED — Alt+V via Claude's TUI Just Works; ADR-073/075.)
- Pasted text must go through `term.paste()` (normalizes line-endings + bracketed-paste markers), never raw `socket.send`.
- `navigator.clipboard` is secure-context-only — over the Tailscale http IP it is `undefined`; `execCommand('copy')` still works for copy, but keyboard PASTE needs HTTPS (tracked follow-up; ADR-114).
- `term.buffer.active` is wiped by ConPTY's startup screen-clear AFTER `replay_end` — accumulate from the replay payload string, or snapshot synchronously in the callback (v0.8.7).
- `TERM=dumb` disables ConPTY's startup screen-clear, so replay-on-attach must reset cursor / clear the active area on the CLIENT (v0.8.9; the TERM=dumb fact stands under the ADR-087 snapshot model).
- Image-paste path-of-record is split: WebUI shell pastes → `<task.cwd>/.shipwright-webui/pastes/`; Claude TUI pastes → `~/.claude/image-cache/`. Do NOT migrate Claude's cache.
- A renderer-level smear may not reproduce under synthetic stress — visual UAT history is the load-bearing evidence; say so in the ADR when synthetic repro fails (ADR-099, Iterate K).

**Rendering / scroll / virtualization (the long saga)**
- Browser-coordinated layout heuristics (`overflow-anchor`, `scroll-into-view nearest`, native-dialog anchoring, `:has()`) fight virtualization the moment it recycles rows. ADR-063 acted on this and BACKFIRED (reverted same-day); the dominant flicker source was a per-poll setState cascade (ADR-064/066), not anchoring.
- Side-effects can be load-bearing — MEASURE before optimizing the React render loop / ResizeObserver / scroll. Three hypothesis-from-code-reading iterates (ADR-063, mermaid, ADR-064) all regressed and were reverted; the measurement-first fix landed clean on the fifth attempt (ADR-066). Only DevTools / instrumented counters are a safe entry point here.
- React 19 unmount cleanup is unreliable across hard navigation — use `pagehide` (+ a periodic flush), not `useEffect` cleanup, for save-on-exit (ADR-066).
- localStorage is per-origin + per-browser-profile — Playwright contexts are sandboxed from the user's Chrome; clearing cached state in a real tab needs a DevTools one-liner, not a tool-run.
- Tailwind v4 preflight zeroes `list-style` — rendered-markdown lists must declare `list-style-type` explicitly (`.markdown-body`).

**Network / dev-stack / Windows**
- `0.0.0.0` is a bind-wildcard, NOT a routable destination — build client URLs / proxy targets with `127.0.0.1` even when bound to `0.0.0.0` (ADR-081).
- When Hono moves off loopback the Vite proxy target MUST follow (`resolveProxyTarget.ts`); audit every consumer (proxy / healthcheck / smoke) on a bind change (ADR-081).
- Tailscale CLI subprocess: handle `timeout`, CRLF split, IPv6 noise — parse the first valid IPv4 via `node:net.isIPv4` (ADR-081).
- `@types/node` belongs only in `tsconfig.node.json` — exclude Node-only client helpers from the main tsconfig so browser code cannot import Node APIs (ADR-081).
- Hono multipart `parseBody()`: pre-check `Content-Length` (≈1 MiB headroom over the cap) for a deterministic 413 before the parser allocates (FR-01.27/29).

**Shipwright tooling (F0.5 / external review)**
- `uv run` on shared Python tools needs `--with openai` (e.g. `external_review.py` → OpenRouter).
- `surface_verification.py` on Windows: pass `npm.cmd` (subprocess `shell:false` does not resolve PATHEXT); pass RELATIVE `--prefix` paths (`shlex posix=False` keeps quotes); pass `--tests-run N` when the stdout parser misses vitest's line shape.
- An F0.5 web E2E must run against an ISOLATED server — point `USERPROFILE`/`HOME` at a temp dir (so `registryDir` relocates) + `SHIPWRIGHT_NETWORK_PROFILE=local`; run the prod build, not `tsx watch`. E2E against the prod build needs in-app navigation (no SPA deep-link fallback) + a real task `cwd` (a missing cwd 500s the terminal WS).
- External code/iterate review BEFORE finalization catches narrow-write-surface footguns + subtle control-flow/regex bugs the author internalized as correct (v0.8.7, lead-foundation; ADR-080/081).

**Process / signals**
- Iterate Phase Matrix "always" rows are not negotiable — adding a file output / endpoint / write surface means updating the owning FR + architecture.md, even for a one-line additive change.
- A config-default flip can silently falsify a signal another iterate depends on — grep every consumer when flipping a default. `altScreenActive` is buffer-mode-specific (NO_FLICKER makes Claude render in the main buffer); prefer buffer-mode-agnostic signals (ADR-095/098/110/111).
- `draft` is a transcript-poll-STICKY state but NOT a blanket skip: a fresh never-launched `draft` still bootstraps to `active` on its first JSONL — the distinguishing signal is `launchedAt` (ADR-112).
- A missing `.js` extension in a server ESM import surfaces as a confusing DOWNSTREAM type error (a `Pick<>` of an error-type loses optionality) — check the import line first.
- A campaign's lifecycle `status` is NOT a reliable "done?" signal — use `done>=total` (`total>0`); `status==='complete'` is only a fast-path (ADR-160).
- A cross-language wire contract is SSoT only if the fixture is GENERATED BY the canonical binary, and a boundary probe on fresh (unicode) data catches what fixtures cannot (ADR-169).
- WebUI write surfaces: the canonical list lives in `architecture.md` § Data Flow; every write inside a project path goes through `realPathGuard` or is refused.


## Convention Updates

_Convention-relevant ADRs since adoption (ADR-053), de-duplicated and in chronological order. See `decision_log.md` for the full ADR catalogue including architecture-only and bug-only entries; see `architecture.md` "Architecture Updates" for the architecture-impact view._

- **ADR-065** (2026-05-01): Filter null-rendering events out of virtualized transcript list.
- **ADR-066** (2026-05-02): Persistent virtualizer measurement cache + first-visit warmup pass.
- **ADR-067** (2026-05-03): Embedded terminal launcher (xterm.js + `@lydell/node-pty` + `@hono/node-ws`) — adds a neutral shell pane; image-paste flow eliminates the Claude-CLI clipboard-image gap; ADR-034 wording amended to allow a neutral shell pane while keeping Claude-execution user-initiated.
- **ADR-068-A1** (2026-05-04): Embedded-terminal auto-launch via WS data-frame + disk-backed scrollback persistence.
- **ADR-069** (2026-05-05, AC-1 retired by ADR-087): Post-v0.8 stabilization — terminal scrollback ANSI sanitizer (retired) + writer-stuck watchdog with per-conn pause refcount (retained).
- **ADR-077** (2026-05-08, retired by ADR-087): v0.8.7 scrollback hygiene — shell-stopped marker + PowerShell-banner-burst collapse. Retired together with the chunked-replay path.
- **ADR-080** (2026-05-09): Type-system isolation between workspaces — retires ADR-035's 4-baseline-error carve-out. Verbatim mirrors of `Task` / `GlobalSettings` / `Project` under `server/src/types/`; cross-package imports rejected by comment-aware drift-guard.
- **ADR-081** (2026-05-10): `SHIPWRIGHT_NETWORK_PROFILE` env-flag (local | tailscale | open) for unified dev-server bind security. New resolvers + Vite-proxy-target follower + cross-mirror byte-equivalence parity test.
- **ADR-082** (2026-05-10): Wire `.env.local` into both dev-server processes (`tsx --env-file-if-exists` + Vite `loadEnv`).
- **ADR-084** (2026-05-11): EmbeddedTerminal StrictMode mount-race fixes (readonly-banner grace + xterm dimensions-stub on dispose).
- **ADR-085** (2026-05-11): Resume click on idle new-plain converges to active (scope mtime-decay to non-new-plain).
- **ADR-086** (2026-05-11, retired by ADR-087): Skip disk-scrollback replay on attach for new-plain tasks. Retired together with the chunked-replay path.
- **ADR-087** (2026-05-12): Cell-state snapshots become the SOLE replay primitive. Retires ADR-069 sanitizer + ADR-077 collapse + ADR-079 pushdown + ADR-086 skip + the chunked-replay envelopes. Failure mode = blank terminal with live shell.
- **ADR-088** (2026-05-11): `@xterm/headless` server-side Terminal mirror per live pty; per-task `<scrollbackDir>/<taskId>.snapshot`.
- **ADR-092** (2026-05-12): WS replay precedence — LIVE mirror first, disk-snapshot fallback. New `serializeMirrorIfLive` + `flushMirrorSnapshot` + `detachAndCount` write surfaces on `pty-manager.ts`.
- **ADR-095** (2026-05-13, partially superseded by ADR-098): `CLAUDE_CODE_NO_FLICKER=1` default injection + new `withLiveSession` HTTP-boundary helper.
- **ADR-096** (2026-05-13): Snapshot-preservation 60 % heuristic in `finalizeMirrorSnapshot` (retained as defense-in-depth post-ADR-098).
- **ADR-097** (2026-05-13, partially superseded by ADR-098): xterm.js 5.5.0 → 6.0.0 upgrade (paired-set, exact-pin) + snapshot envelope v2 (v1 hard-reject) + `windowsMode` removal.
- **ADR-098** (2026-05-13): Restore `CLAUDE_CODE_NO_FLICKER=1` default-on (reverts only ADR-097's default-OFF clause). Empirical anchor in the ADR.
- **ADR-099** (2026-05-14, client side superseded by ADR-108): xterm.js 6.0 WebGL atlas-corruption workaround. **Server-side SGR re-emit retained** in `replay-snapshot.ts`.
- **ADR-100** (2026-05-14): `ExternalTask` 13-field extension for leadwright daemon (5 user-creatable, 8 daemon-owned). `POST /tasks/:id/launch` 409 `task_claimed` short-circuit on `claimToken`.
- **ADR-101** (2026-05-14): WebUI Triage Tab + Promote bridge — 5 new `/api/triage/*` endpoints, TS port of `triage.read_all_items` with Python-fixture parity test, cross-store Promote transaction.
- **ADR-101 (bloat)** (2026-05-26): `server/src/terminal/pty-manager.ts` accepted as a documented deep-module exception to the 300-LOC bloat baseline.
- **ADR-102** (2026-05-15): Triage card / dialog visual restyle onto existing design tokens.
- **ADR-103** (2026-05-15): Close-task handler navigates back to the board on success (`{ onSuccess: () => navigate("/") }`).
- **ADR-103 (bloat)** (2026-05-27): `server/src/terminal/routes.ts` accepted as a documented deep-module exception; WS-upgrade handler extracted into `ws-upgrade-handler.ts`.
- **ADR-104** (2026-05-15): Terminal reset banner via `terminalReset` flag on the WS `ready` envelope; Bug-B smear root cause later corrected by ADR-109.
- **ADR-105** (2026-05-15): TaskCard project-identity pill (`ProjectPill`) leading the card meta row.
- **ADR-106** (2026-05-15): Triage write 500 fix — disjoint `.weblock` directory + removed self-deadlocking double-lock + 503 on genuine contention.
- **ADR-108** (2026-05-16): Client-side replay drain gate in `EmbeddedTerminal.tsx`. Replaces ADR-099's atlas-maintenance machinery.
- **ADR-109** (2026-05-16, supersedes ADR-093): `convertEol: false` in `EmbeddedTerminal.tsx` — fixes Bug B left-column smear. New server-side regression test `embedded-terminal-convert-eol.test.ts`.
- **ADR-110** (2026-05-16): Remove the Resume-CTA activity gate; add one-shot auto-inject guard + Copy-Resume command + shared `lib/clipboard.ts`.
- **ADR-111** (2026-05-17): Remove orphaned Resume-CTA liveness-gate code (`lastPtyDataAt` / `altScreenActive` pipeline + flaky integration test).
- **ADR-112** (2026-05-18): Move-to-Backlog endpoint + In-Progress → `draft` state flip. New SSoT `taskLifecycle.ts` ↔ `BACKLOG_SOURCE_STATES` parity.
- **ADR-113** (2026-05-18): Inbox surfaces waiting terminal pickers via `extractTerminalPrompt` + live `@xterm/headless` mirror; focuses terminal on Inbox click.
- **iterate-2026-05-18-edit-task-dialog** (2026-05-18): Edit Task dialog + widened `PATCH /api/external/tasks/:id`; new `taskEditability.ts` parity mirror.
- **ADR-114** (2026-05-18): Embedded-terminal keyboard copy/paste via `attachCustomKeyEventHandler`. DOM paste listener now uses `term.paste()` (was raw `socket.send`).
- **ADR-115** (2026-05-19): oxlint adopted as the project linter — replaces the dead `eslint src/` script. CI runs `npm run lint` as a real error-gate. Server CORS test env-isolated via `vi.hoisted()`.
- **ADR-116** (2026-05-20): Triage Tab gains launchPayload rendering + Fix-now CTA — `stripControlChars` byte-equal port of canonical Python helper; cross-workspace TriageItem drift-guard.
- **ADR-117** (2026-05-21): Skip WS reconnect on clean close of a replay-only attach (no replay-flicker loop on closed tasks).
- **ADR-118** (2026-05-21): Triage Fix-now opens NewIssueModal (lifted to TriagePage scope); 4 phase slashes namespaced via `:skill` suffix in `buildSlashCommand`.
- **ADR-119** (2026-05-22): Phase 0f compliance hygiene — slim 5 bloated ADRs, add architecture marker, replace CLAUDE.md file-tree with summary.
- **ADR-120** (2026-05-22): Hono SPA fallback to `client/dist/index.html` for non-`/api` GETs; `SHIPWRIGHT_STATIC_DIR` test seam.
- **ADR-121** (2026-05-22): Thread `projectId` through `FixNowIntent` → `NewIssueModal` (`initialProjectId` prop).
- **ADR-122** (2026-05-23): VS Code-aligned terminal selection + copy-on-mouseup + mouse-mode banner.
- **ADR-123** (2026-05-23): Auto-focus xterm on Terminal tab activation (defer via `setTimeout(0)` for Radix CSS settle).
- **ADR-124** (2026-05-26, Campaign C / C7): `InboxPage.tsx` split (967 → 116 LOC) + new `client/src/pages/inbox/` subfolder.
- **ADR-125** (2026-05-26, Campaign C / C5, HIGH RISK): `EmbeddedTerminal.tsx` split (1856 → 287 LOC) + 7 extracted modules under `client/src/components/terminal/`.
- **ADR-126** (2026-05-26, Campaign C / C3): `BubbleTranscript.tsx` split (1618 → 175 LOC) + sub-modules under `client/src/components/external/BubbleTranscript/`.
- **Campaign C non-ADR splits** (2026-05-26): `NewIssueModal.tsx` (C4), `TaskDetailHeader.tsx` (C6), `server/src/external/routes.ts` (C2) all split per the Campaign-C cleanup-invariant.

- **ADR-136** (2026-05-27): actionId-aware phase pill resolution; new-iterate never derives from title

- **ADR-157** (2026-06-04): Parse campaign Sub-Iterates table by header + strip Markdown emphasis

- **ADR-160** (2026-06-05): Treat `done>=total` (with `total>0`), not lifecycle `status==='active'`, as the authoritative campaign-completion signal; `selectActiveCampaigns` hides via `isCampaignDone` (PR-driven campaigns never auto-flip to `complete`).

- **ADR-169** (2026-06-10): Cross-language wire fixtures must be generated by the canonical CLI (`PYTHONUTF8=1` on Windows), and a boundary probe on fresh unicode data catches producer bugs no committed fixture would.
- **iterate-2026-06-12-agent-docs-condense** (2026-06-12, docs): conventions.md condensed — Architecture-rules + DO-NOT blocks reduced to a terse index pointing at CLAUDE.md + ADRs (full normative text stays in CLAUDE.md); Learnings tightened (every lesson kept); Convention-Updates paragraphs converted to one-sentence ADR refs; stale `9`→`11` sub-routers corrected.
