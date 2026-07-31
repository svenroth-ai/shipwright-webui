# Shipwright Command Center (WebUI)

## WHAT
- **Purpose**: Local web application for managing multiple Shipwright SDLC projects in parallel.
- **Architecture**: Hono backend (Node.js) + React 19 frontend (Vite 6), monorepo in `webui/`. **External-launch model (Plan D'' variant a, 2026-04-19; embedded-terminal auto-execute via ADR-068-A1)**: webui owns no Claude subprocess. The user clicks Launch / Resume / Relaunch on the TaskDetail header; the same pre-bound `--session-id <uuid>` command is auto-executed inside the embedded terminal pane (xterm.js + node-pty, shell-only whitelist) via a client-side WS data-frame. Users may still copy the command and run it in their own terminal — webui observes the resulting JSONL at `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` either way.
- **Stack**: TypeScript strict, Hono, React 19, Vite 6, TailwindCSS 4, Radix UI, TanStack React Query.

## Shared vocabulary

Allowlist · Ratchet · Anti-Ratchet · Producer · Action-Unit · Canon-Gate —
shipwright-wide terminology lives in
[`../shipwright/shared/glossary.md`](../shipwright/shared/glossary.md)
(sibling clone; without one, the same file is at
https://github.com/svenroth-ai/shipwright/blob/main/shared/glossary.md).
Mandatory reference for the bloat anti-ratchet rule + ADR-template fields
(Ousterhout / YAGNI / Chesterton-Fence / Re-Review-Date / Incident-Reference).

## Pre-commit hooks

Install the bloat anti-ratchet pre-commit hook **once per clone**
(requires Python 3.10+; the install script prints remediation if missing):

```bash
bash scripts/install-hooks.sh       # POSIX / Git-Bash on Windows
.\scripts\install-hooks.ps1         # PowerShell on Windows
```

Sets `git config core.hooksPath scripts/hooks` (idempotent; refuses to
overwrite a different existing value without `--force`). The hook only
blocks commits that ratchet an existing entry in
`shipwright_bloat_baseline.json` — new crossings are advisory (caught by
the Group H detective audit in the shipwright dev repo, not webui).
Vendored from `shipwright/shared/scripts/hooks/anti_ratchet_check.py`
(canonical-source hash + version in the vendored header).

## Architecture reference

Plan of record: [`~/.claude/plans/plan-d-double-prime-external-launch.md`](../.claude/plans/plan-d-double-prime-external-launch.md).
PoC findings that shaped the implementation: [`~/.claude/plans/external-launch-poc-results.md`](../.claude/plans/external-launch-poc-results.md).
Decision record: `.shipwright/agent_docs/decision_log.md` ADR-034.

Two hard rules, survivors of every review round: **(1) webui spawns no Claude process directly** and **(2) the server is stateless on transcript reads** — Architecture rules 1 + 4 below.

## Structure

Two independent npm workspaces — **`server/`** (Hono backend on port 3847, TypeScript strict; routes under `server/src/{routes,external,terminal}/`, core domain modules under `server/src/core/`) and **`client/`** (React 19 + Vite 6 on port 5173; components grouped by UI area under `client/src/components/{external,terminal,sidebar,wizard,settings,triage,common}/`, pages under `client/src/pages/`, Playwright E2E under `client/e2e/`). Compliance + planning + agent docs live under `.shipwright/`; CHANGELOG drops accumulate in `CHANGELOG-unreleased.d/`. Full component-level inventory, data flow, and write-surface map: [`.shipwright/agent_docs/architecture.md`](.shipwright/agent_docs/architecture.md) + [`.shipwright/agent_docs/component_inventory.md`](.shipwright/agent_docs/component_inventory.md) (file-tree dumps rot fast and duplicate those docs — removed in Phase 0f).

## HOW

### Development

This repo has **no root `package.json`** — `server/` and `client/` are independent workspaces. Run each in its own terminal:

```bash
# Install (once)
cd server && npm install
cd client && npm install

# Terminal 1 — Hono backend (tsx watch, port 3847)
cd server && npm run dev

# Terminal 2 — Vite client (port 5173 by default, proxies /api to 3847)
cd client && npm run dev
```

Other scripts (run from the respective subdir):

```bash
npm run build                 # Production build
npm run test                  # Vitest
npm run test:e2e              # Playwright (client only)
npm run lint                  # oxlint (client + server)
npm run typecheck             # tsc --noEmit
```

### Key Environment Variables
```
PORT=3847                     # Hono server port (override via env)
VITE_PORT=5173                # Vite dev server port (override via env)
```

Default is a single dev-server stack. For parallel worktrees set both vars explicitly — see [shipwright docs/guide.md §8.5 "Parallel Development with Worktrees"](https://github.com/svenroth-ai/shipwright/blob/main/docs/guide.md#85-parallel-development-with-worktrees). The Vite proxy reads `PORT` at startup so `/api` routes to the matching Hono instance.

### Profile resolution (post-split)

Bundled stack profiles ship at `server/profiles/` (a snapshot of `shipwright/shared/profiles/`; refresh via `npm run sync-profiles` from `server/`, see `server/profiles/README.md`). The loader (`server/src/core/profile-loader.ts`) resolves in order: **1.** `SHIPWRIGHT_PROFILES_DIR` (explicit override) → **2.** `SHIPWRIGHT_MONOREPO_PATH` + `/shared/profiles` (monorepo dev-loop: live edits without re-syncing) → **3.** bundled `server/profiles/` (default).

### Conventions
- TypeScript strict mode everywhere.
- Hono routes in `server/src/routes/`, one file per resource. External-launch routes live at `server/src/external/routes.ts`.
- React components in `client/src/components/`, grouped by UI area.
- TanStack React Query for data fetching + sequential polling for transcript updates.
- TailwindCSS 4 for styling, Radix UI for accessible primitives.
- Files under 300 lines — split if larger.
- Conventional Commits (feat:, fix:, refactor:, test:, docs:, chore:).
- **Motion uses the tokens, never magic numbers** (A20, FR-01.64): durations/easings/stagger live in `client/src/lib/motion.ts` (TS constants) mirrored by `client/src/styles/motion.css` (CSS custom props + the earned keyframes + the global reduced-motion FLOOR). **`prefers-reduced-motion: reduce` is the PRIMARY user's everyday state** — under it every screen renders its COMPLETE FINAL state (all content present, opaque, in position, immediately). Content is NEVER hidden by default and revealed by an animation; animate FROM a visible-safe resting state, or gate the animation not the content. JS-driven moments (count-up, ring/sparkline draw) read `useReducedMotion` / `useCountUp` and render the final value immediately under reduce (and when `matchMedia` is absent — fail toward no motion, never toward hidden content). Motion only where it means something (arrived / running / decided / counting); decorative motion is out of scope.

### Architecture rules

One-line index — rationale lives in the cited ADRs (`.shipwright/agent_docs/decision_log.md`). Numbering is load-bearing (source comments cite "CLAUDE.md rule N") — never renumber.

1. **Webui never spawns Claude.** `core/launcher.ts` only builds command strings; the embedded terminal auto-executes them after an explicit CTA click (ADR-067 + ADR-068-A1); pty-manager shell-only whitelist is the enforcement line. Guard: spec `35-no-chat-panel.spec.ts`.
2. **Task state = JSONL + persistent store.** `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`; session UUID pre-bound at task creation via `crypto.randomUUID()`.
3. **Discovery is filename-first.** `<uuid>.jsonl` is the primary match (PoC finding 1); first-line sessionId is a secondary sanity check.
4. **Transcript endpoint is stateless.** `GET /api/external/tasks/:id/transcript?fromByte=<n>&expectFingerprint=<fp>` — no server-side byte-offset cache; multi-tab for free.
5. **UTF-8-safe chunking.** Server reads are cut on `\n` boundaries only.
6. **Torn-read retry budget.** `core/session-jsonl-io.ts` retries EBUSY/EPERM/EACCES/ENOENT up to 6 attempts, 50→1600 ms backoff. It also owns the POSITIONAL tail read — `readChunk` reads `[fromByte, EOF)`, never the whole file — and the append/truncate contract that goes with it. ENOENT is retryable on the READ but fatal for discovery; do not collapse the two.
7. **No SSE for transcript.** Sequential 1 s client polling via `useTaskTranscript`.
8. **No chokidar.** Heartbeat-free; watcher state derived on demand from mtime probes.
9. **Re-pass plugin dirs on every launch.** `--plugin-dir` does not reliably survive `--resume`.
10. **MIN_SUPPORTED_CLI is pinned** in `core/cli-compat.ts`; anything older shows a banner via `/api/diagnostics`.

### Preview-capability precedence

The Preview dev-server spawn path (not Claude — see ADR-044) gates on three sources: **1.** profile `stack.frontend` (capability gate) · **2.** profile `dev_server.command` (spawn target) · **3.** `.shipwright-webui/actions.json` → `actions.preview.enabled` (user-level opt-out). `<PreviewButton>` renders only when 1 AND 2 are present; `enabled = false` hides it regardless. A boot-time coherence check warns when `stack.frontend` is set but `dev_server.command` is missing (button would render, spawn would 500). Full diagram: [`.shipwright/agent_docs/architecture.md`](.shipwright/agent_docs/architecture.md).

### DO-NOT regression guards (see ADR-035)

One-line index — imperative + pointer only; rationale and full mechanics live in the cited ADRs (`.shipwright/agent_docs/decision_log.md` + `.shipwright/planning/adr/`). Numbering is load-bearing (source comments cite "CLAUDE.md rule N" / "DO-NOT #N") — never renumber.

1. **DO NOT write into Claude's JSONL files under `~/.claude/projects/`** — read-only polling observer; title sync = `--name` at launch, never JSONL mutation (ADR-035).
2. **Auto-scroll is CSS-first** (`overflow-anchor: auto`), `useAutoScroll` as safety net — DO NOT add scroll libraries (ADR-035).
3. **DO NOT re-introduce a chat composer** (ADR-034); spec 35 fails the build on any chat-* surface.
4. **DO NOT re-add `@assistant-ui/*`** — rendering is bespoke `react-markdown` + `remark-gfm` + `rehype-highlight` + `strip-ansi` (ADR-035).
5. **DO NOT run `claude --resume <uuid>` as a webui side-effect** while the user's session may be live — SQLite-lock/JSONL-interleave risk (ADR-035).
6. **Multi-writer state files MUST use `proper-lockfile`** (never just temp-file + rename); PATCH surfaces ELOCKED as 409 (ADR-035).
7. (ADR-080) **DO NOT add cross-package imports** — shared shapes are verbatim mirrors in `server/src/types/`; drift guards: `action-schema-sync.test.ts` + `no-cross-package-imports.test.ts`.
8. (ADR-044) **Schema v2 is write-on-touch** — DO NOT batch-rewrite on boot (ADR-038 rejected).
9. (ADR-044) **Preview spawn uses `shell: false`**, ONLY through `core/preview-session-manager.ts` — no parallel spawn path.
10. (ADR-044) **Path-guard is `realpath + path.relative`, NOT `startsWith`** — all tree + file routes share `core/path-guard.ts`.
11. (ADR-044) **DO NOT hardcode `shipwright-run` / `shipwright-iterate` / phase strings in components** — read from `/api/external/projects/:id/actions`; meta-test `client/src/test/doc-sync.test.ts` guards this + the file-map bundle (CLAUDE.md ∪ architecture.md ∪ component_inventory.md).
12. **DO NOT write into the user's `shipwright_run_config.json`** — read-only via `core/run-config-reader.ts` / `useRunConfig()`; the design gate is likewise a read-only observer of `run_loop_state.json` (`core/run-loop-state-reader.ts`). WebUI writes only `sdk-sessions.json` + `.shipwright-webui/actions.json` stubs + (FR-01.45) the transient gitignored `.shipwright/designs/design-feedback-round{N}.md` (via `external/design-review/feedback-write.ts` — never run_config / `run_loop_state.json` / Claude JSONL).
13. **Phase-task launches use the pre-bound run-config `sessionUuid` — never re-generate** (server rejects mismatch: `409 phase_task_session_uuid_mismatch`; `phaseTaskRef` + `actionId` together: `400 mixed_launch_intents`).
14. **All pipeline-continuation entry points funnel through `useContinuePipeline()`** — parallel launch paths bypass the staleness re-check.
15. **Schema is additive + write-on-touch** — loader accepts v1–v4, persist writes v4; DO NOT batch-rewrite on boot.
16. **Stale `in_progress` detection uses run-config timestamps only** — never JSONL mtime.
17. (ADR-067) **pty spawn target MUST be a whitelisted shell binary, never `claude`**; `paste-image` / `append-gitignore` flow through `realPathGuard`; image caps + magic-byte sniff non-negotiable; WS upgrade is the authoritative pty creation path.
18. (ADR-068-A1) **`ScrollbackStore`: `realpath` at EVERY operation**, UUID-validated, `<taskId>.log` naming (not sessionUuid), per-task `PQueue`; replay NEVER drops chunks; `/clear-scrollback` is the only destructive path.
19. (ADR-068-A1) **Auto-execute is a CLIENT-side WS data-frame, NOT server-side `pty.write`** — built EXCLUSIVELY by `core/launcher.ts buildCopyCommands()` after an explicit CTA click.
20. (ADR-087, amended by ADR-097) **Cell-state snapshots are the SOLE replay primitive** — one `replay_snapshot` per WS attach, chunked path RETIRED; no fallback without a fresh M2 re-verify. Detail: [ADR-087](.shipwright/planning/adr/087-cell-state-snapshot-iterate-c.md) + [ADR-088](.shipwright/planning/adr/088-headless-mirror-iterate-a.md).
21. (ADR-092) **WS replay is LIVE-mirror first, disk-snapshot fallback**; snapshot-on-detach via atomic `detachAndCount`; never `mirror.dispose()` in `flushMirrorSnapshot`. Guard: `v0-9-6-live-pty-replay.spec.ts`.
22. (ADR-097 + ADR-098) **xterm.js + paired addons are exact-pinned (6.0.0 family, NO carets)**; snapshot envelope v2-only; `CLAUDE_CODE_NO_FLICKER` defaults ON (opt-out `SHIPWRIGHT_TERMINAL_NO_FLICKER=0`); DO NOT add `windowsMode`.
23. (iterate-2026-06-17 + ADR-204) **Board column is DECOUPLED from session `state`** — `POST /tasks/:id/column` sets the user-owned `boardColumn` ONLY (never `state`/JSONL); `/close|/backlog|/reopen` sync it; DO NOT re-couple. Exception: a `done` card moved out of Done routes through `/reopen` (state→draft, lands unlocked — ADR-204).
24. (iterate-2026-07-14) **A self-scrolling column-flex container MUST carry `[&>*]:shrink-0`** — CSS drops the automatic minimum size of any direct child whose `overflow` is not `visible`, so that child gets squeezed below its content, silently CLIPPED, and (having eaten the negative free space) the container never scrolls, making the content unreachable. DO NOT hand-roll a dialog scroll body — use `components/common/ModalScrollBody.tsx` (the sole carrier; its `className` takes the height budget + gap ONLY). Meta-test `client/src/test/modal-scroll-body-invariant.test.ts` ratchets both.
25. (iterate-2026-07-18) **DO NOT SHA-pin GitHub-owned actions (`actions/*`, `github/*`) and DO NOT add a hosted updater** (`.github/dependabot.yml` or equivalent). The posture is deliberately ASYMMETRIC: GitHub-owned actions use MUTABLE tags — pinning them is only coherent alongside an updater keeping the pins patched, and this project takes no GitHub-hosted proprietary service (portability: adopters must not inherit one), so an unmaintained pin rots silently. THIRD-PARTY actions stay SHA-PINNED — that is where the real supply-chain risk sits. `SHIPWRIGHT_SEMGREP_ACCEPT_GH_OWNED_ACTION_TAGS` in `.claude/settings.json` is LOAD-BEARING (Chesterton-Fence) **for the LOCAL `/shipwright-security` scan** — it is consumed by `semgrep_tailoring.normalize_tailored`, whose only caller is the plugin's `oss_backend.py`, and it is what keeps this accepted finding out of `findings.json` and the triage inbox. `.claude/settings.json` is its CORRECT home: **DO NOT "fix" it by moving the toggle into `security.yml`** (verified 2026-07-29, iterate-2026-07-29-accepted-risk-ci-gate). Relocating it is not merely pointless, it is BREAKING, and for two separate reasons. **(a) It suppresses nothing there** — that workflow runs a bare `semgrep scan --config auto`, which reads no `SHIPWRIGHT_SEMGREP_*` variable; only the plugin's local `normalize_tailored` does. **(b) The accepted-risk gate WOULD see it**: `accepted_risk_scan.read_workflow_env` parses `SHIPWRIGHT_*` assignments out of `security.yml` and maps this one to a `semgrep-policy-toggle` suppression, which has no matching register entry (the entry is filed `trivy-ignore`) — so `check` fails the build with `UNRECORDED`, empirically reproduced. Relocating therefore requires changing the register entry's `target` in the same commit, for zero operational gain. In CI the finding IS emitted into the SARIF and simply never blocks, because the critical gate fires only on `security-severity >= 9.0` or a Gitleaks secret. The resulting findings are an ACCEPTED risk recorded in `shipwright_accepted_risks.yaml` (the register — WHY and until WHEN) with a paired `.trivyignore.yaml` line; note that line is a SYNTHETIC id which suppresses nothing (Trivy never emits it) and exists so the drift gate and dashboard can SEE the acceptance instead of rendering it as unexplained DRIFT. **Every entry in one needs its counterpart in the other** — `accepted_risks_cli.py check` fails both directions, and since 2026-07-29 it runs in CI (`security.yml` job `Accepted-risk register (gate)`, on every PR and on the weekly schedule; the schedule is what makes the time-based `expire` enforceable), vendored under `scripts/ci/` with a drift guard over `scripts/ci/accepted_risks_vendor.json`. **SCOPE — the gate covers the `.trivyignore.yaml` channel and the two `SHIPWRIGHT_SEMGREP_*` channels in `security.yml`, and NOT `.semgrepignore`, inline `# nosemgrep`, CodeQL `paths-ignore`, or a GitHub-side dismissal** — all of which are live here and together silence more than the gate sees. It also cannot tell a renewed acceptance from a re-reviewed one. Do not read a green Security Scan as "every suppression is recorded"; read it as "the three reconcilable channels agree with the register". PR #285 collapsed the asymmetry and was reverted. Meta-test `server/src/test/ci-action-pinning-posture.test.ts` ratchets both directions.
26. (iterate-2026-07-21) **DO NOT hand-roll a board/page create CTA — put it on `.btn-primary` / `.btn-primary-split`** (`client/src/styles/buttons.css`, which owns the contract). The standard is FIXED GEOMETRY, not merely a colour: 36px height, 132px min-width, 8px radius, `--btn-primary-bg` #0E7A6B. PageHead right-aligns the actions cluster, so equal geometry ⇒ **equal position** — a button that sets its own padding lands somewhere else on every page. A local `bg-[var(--color-primary)]` is not a near-miss but a guaranteed wrong colour: inside the board header `.chrome-dark-controls` re-points `--color-primary` at #35B8A4, the brighter teal buttons.css records as RETIRED. Sven reported this same defect THREE times (2026-07-17 ×2, then 2026-07-21 for the All-Projects trigger both passes had missed) — per-component fixes only protect the components someone remembered, which is why the guard is now a source scan over the whole family. Meta-test `client/src/test/create-cta-standard.test.ts` ratchets both drift directions (registry → disk, and disk → registry).

27. (iterate-2026-07-21) **Scroll belongs to the ROUTE, below its title bar — the shell scroller (`.scene-fore`) must never scroll and must never reserve width.** `scrollbar-gutter: stable` (and its twin `overflow-y: scroll`) permanently subtracts a scrollbar-wide strip from the RIGHT of the scrollport; `.page-head` / `.mc-top` render INSIDE that scrollport while `.scene-bg` spans the full `.screen`, so every title bar stops short and the photo shows through — the "title bar is cut on the right" defect. It reserved the NATIVE 15px, not the 6px the app draws, because `scrollbar-width: thin` sits on `html, body` and **does not inherit**. PR #8 added the gutter to hide a cross-route width spring; the correct fix is to bound the ROUTE (one element carrying BOTH `flex-1` and `overflow-y-*` under the title bar — the Diagnostics pattern), never to reserve width on the shared shell. A page with TWO body modes needs a bounded scroller in EACH: the Board's list view shipped unbounded precisely because the guard knew only about its kanban rail. Meta-test `client/src/test/shell-scroll-invariant.test.ts` ratchets both halves (registry → scroll owners, and reverse drift); `client/e2e/flows/title-bar-full-bleed.spec.ts` (`@smoke`) measures the real geometry.

28. (iterate-2026-07-24) **The embedded terminal renders via the DOM renderer BY DEFAULT — GPU acceleration (WebGL) is OPT-IN, and DO NOT flip that default back.** The WebGL glyph TEXTURE ATLAS is **ONE OF TWO** independent causes of the "smear"/wrong-letter class — it draws wrong PIXELS for correct BUFFER content — and `term.refresh` provably CANNOT heal it: it routes through `WebglRenderer._updateModel`, which SKIPS cells whose `code/fg/bg/ext` match the cached model, so a cell pointing at a stale atlas coordinate is dirty-skipped forever. Seven trigger-based fixes shipped before this (convertEol → #146 → #147 → #164 → #167 → #175 → #206 → #215); each closed one trigger and each next user report found the next — the eighth report ("resize the terminal, then scroll") landed on the one repaint path that still had no heal. The heal is not even reliable where it does run: upstream `TextureAtlas.clearTexture()` early-returns on `_pages[0].currentRow` ALONE, so a MULTI-PAGE atlas (what heavy scrolling produces) keeps pages 1..N uncleared and un-`version++`'d, and `GlyphRenderer.render` therefore never re-uploads them. xterm.js itself documents `clearTextureAtlas` as a WORKAROUND for a Chromium/NVIDIA corruption bug. The DOM renderer holds NO atlas, so the class is structurally impossible rather than patched. This mirrors VS Code (`terminal.integrated.gpuAcceleration` + a permanent DOM fallback), which runs the same xterm.js and likewise does not enumerate triggers. The accumulated WebGL heals (#146/#147/#167/#206/#215 + the scroll-trailing heal) STAY — Chesterton's Fence: they remain load-bearing for the opt-in arm; their status changed from primary defence to best-effort, not their necessity. Toggle lives in Settings → Terminal; storage key `shipwright:terminal-renderer` (unchanged across the flip, so a pre-existing pin survives). Guards: `terminal-renderer.test.ts` (default in both directions), `xtermAddons.test.ts` (default arm constructs no WebGL addon), `client/e2e/flows/93-terminal-renderer-toggle.spec.ts` (real browser, both arms). **This rule originally read "the root cause"; that was FALSIFIED the next day** — the defect recurred on a verified DOM-renderer build, which is mechanism #2 (rule 29). Fixing one does not close the other.

29. (iterate-2026-07-27) **After restoring a terminal snapshot, the pty MUST be nudged to repaint — send `{type:"redraw"}` -> `PtyManager.forceRedraw`, and DO NOT collapse it into `resize()`.** This is smear mechanism #2, renderer-INDEPENDENT (it survived rule 28's flip) and it corrupts the xterm BUFFER, not its pixels. Claude Code repaints DIFFERENTIALLY: it addresses a row with CUP then emits `ESC [ 1 C` (CUF) to SKIP cells it believes already correct — writing NO spaces at all, and skipping letters mid-word. **CUF does not erase**, so a skipped cell keeps whatever is under it: blank stays blank and merely LOOKS like a space (why a fresh terminal is always clean, and why this read as intermittent for months), but STALE TEXT shows through (`sie und habe` -> `sie.undthabe`). On re-attach we restore a cell-state snapshot (ADR-087) — a grid Claude never drew — and the only thing that makes it repaint fully is SIGWINCH, which the kernel raises ONLY on a real size change. A re-attach usually lands at the SAME size, and `PtyManager.resize` deliberately dedupes a no-op (v0.8.6 AC-2, PowerShell banner spam): that dedupe is LOAD-BEARING and STAYS, which is precisely why the nudge needs its own dimension-less path. Dimension-less on purpose — a caller able to pick a size could reflow the very grid it is repairing; writer-gated — a reader must never poke the pty; once per settled replay — the dedupe is bypassed, so a loop re-creates the v0.8.6 spam. VS Code avoids the whole class structurally by replaying a BYTE STREAM with per-entry `{cols,rows}` (`terminalRecorder.ts`) instead of a grid; Zed's snapshot approach signals SIGWINCH explicitly for the same reason. Guards: `cuf-stale-cell-repro.test.ts` (the mechanism, from verbatim captured bytes), `pty-manager.force-redraw.test.ts` (dedupe AND bypass, both directions), `client/e2e/flows/96-terminal-post-replay-redraw.spec.ts` (real browser; verified load-bearing by disabling the send).

30. (iterate-2026-07-31, ports shipwright#437) **The required `PR Review` context is a COMMIT STATUS posted by `.github/workflows/pr-review-run.yml` (stage 2) — DO NOT put it back on a job, and DO NOT move tier or waiver policy into stage 1.** GitHub scores a **SKIPPED job as a SUCCESSFUL required check**, so while the context came from a job that could be skipped, silence read as success: the old single-stage `pr-review.yml` fork-guarded its `decide` job on `head.repo.full_name == github.repository`, `review` was skipped through `needs:`, and **every fork PR went green having been reviewed by nobody** — while every other check still ran and still blocked. Stage 1 (`pr-review.yml`, `pull_request`) therefore runs on every PR including forks, holds NO credential and carries NO policy: `pull_request` runs it FROM THE PR HEAD, so anything it decides is decided by the reviewee, and its uploaded diff is an AUDIT RECORD, never an input (an upstream draft let stage 2 honour stage 1's `needs_review` and a PR could declare itself exempt). Stage 2 (`workflow_run`, default-branch code) derives BOTH the tier (labels, author, changed paths) and the diff from the API, never checks out the PR head, and is the SOLE producer of the context — if it never posts, the context is absent, and an absent required context is `pending`, which BLOCKS. That is fail-closed by construction rather than by convention. **No ruleset change is needed, and that was verified rather than argued** (two external reviewers called it a high-severity blocker): on shipwright#503 `PR Review` exists as a commit status with ZERO check runs of that name, and the PR merged under `{"context":"PR Review","integration_id":15368}` — the same app-bound entry this repo's `main-protection` ruleset carries, because a status posted with the Actions token is attributed to the Actions app. `skip-pr-review` is evaluated AFTER the sensitive-path classification, so a change to the checks cannot waive its own review; `unlabeled` is in the trigger types because otherwise a waiver could be granted but never revoked. **Four divergences from upstream are load-bearing, each earned by a review finding — do not "simplify" them back:** (1) the PR is resolved by listing the base repo's OPEN PRs and matching head SHA, because `commits/{sha}/pulls` returns EMPTY for a fork PR (probed on three real fork PRs) and upstream's use of it would leave every fork PR unresolvable and permanently red *without ever being reviewed*; (2) `--paginate --slurp` everywhere, so a match beyond page 1 is neither missed nor mistaken for uniqueness; (3) the verdict re-reads the branch's force-push HISTORY as well as the head, because `A → B → A` defeats head-equality — the reviewer fetches by PR number and can be served B while the head returns to A; (4) `if: ${{ !cancelled() }}` and an early exit on a CANCELLED stage 1, because `always()` is true for a cancelled job and `cancel-in-progress` only cancels OVERLAPPING runs, so a superseded run would otherwise post over the live one. The sensitive set covers what CI enforces AND what it may stay quiet about (`.trivyignore.yaml`, `shipwright_accepted_risks.yaml`, `.semgrepignore`, `.claude/settings.json`, `shipwright_bloat_baseline.json`, `scripts/install-hooks.*`, `.gitattributes`), reads BOTH sides of a rename (`previous_filename` — otherwise a rename *out* of a guarded directory is invisible), and treats an at-cap file list as sensitive. Guards: `scripts/ci/tests/test_pr_review_fail_closed.py` + `test_pr_review_fork_trust.py` (vendored from the monorepo — they read PARSED structure, because these workflows document the holes they close and a raw-text match hits the comment), `test_pr_review_workflow_shape.py` (stdlib-only, this repo's paths), `test_pr_review_sensitive_paths_sync.py` (the tier's alternation and the reviewer prompt must agree BOTH ways — routing a surface the prompt never mentions leaves the door un-waivable and unlocked), and `test_pr_review_stage2_decide.py` + `test_pr_review_stage2_verdict.py`, which EXECUTE stage 2's real shell bodies against a stubbed `gh` — pagination, waiver ordering, the fail-open shell traps and every verdict branch are behaviours no string match can check.

### Title integration (`--name`)

Webui owns the task title in `sdk-sessions.json`. Every launch command (initial or resume) emits `--name "<title>"` after `--session-id` / `--resume`; Claude pre-seeds the picker title and writes `custom-title` + `agent-name` JSONL events. No mid-session sync — renames apply on the NEXT user-initiated launch. See `core/launcher.ts`, `external/routes.ts` PATCH handler, and `client/src/components/external/EditableTaskTitle.tsx`.

### Dev-server troubleshooting

If recent code changes don't show up, `tsx watch` has probably gone stale on Windows — kill the PID on :3847 explicitly:

```bash
# Windows:
netstat -ano | findstr :3847
taskkill //F //PID <pid>
cd server && npm run dev
```

`EADDRINUSE` on `npm run dev` usually means another worktree's dev server holds the port. Since v0.3.2 both halves fail loud instead of silently half-starting: Hono exits with a deterministic FATAL message (also for `EACCES` / `EADDRNOTAVAIL`), Vite via `strictPort: true`. `npm run dev:fresh` (dev-restart.js) reads `PORT` + `VITE_PORT` from the environment and kills only those two ports; the historic `VITE_ALT_PORT=5177` hardcode was removed in v0.3.2 — if you run Vite on 5177, set `VITE_PORT=5177` explicitly.

## Review subagents: standing request. Workflows: ask every time.

**The review cascade is requested by default — spawn it, never pause to ask, and never record a review `not_run` citing a session policy.** That is `spec-reviewer` → `code-reviewer` → `doubt-reviewer` plus the review subagents other phase skills prescribe (build Step 6, campaign review). Claude Code withholds subagent spawning until the user asks; **this file is that request, and it stands for every session.** **The grant covers reviewers, not fan-out.** Dynamic workflows, deep-research, and parallel implementation subagents (build's `section-builder` loop) spend openly and stay the operator's call — ask explicitly, every time, and never infer them from the grant above. A project that does not want this can delete the section; it is deliberately plain and must not be compressed further, because it has to read as the user's request at runtime.

## Asking the user questions (plain language)

When you ask the user a question — a clarification, a choice between options,
or a confirmation — phrase it so a **non-senior developer or a normal user**
can understand, from a functional standpoint, what is actually being decided.
The person answering may not know the internals; do not make them decode
jargon to reply.

- **Lead with the functional meaning:** say what the choice changes about what
  the user sees or does in the Command Center — not the implementation detail.
  Ask "Should a closed task disappear from the board, or stay visible in a
  'Done' column?" rather than "Set `boardColumn` to `done` or filter the
  derived state?".
- **Avoid unexplained jargon.** If a technical term is genuinely unavoidable,
  add a short plain-language gloss in parentheses (e.g. "stateless read — the
  server keeps no memory of where you were, so multiple tabs just work").
- **Make options concrete and comparable.** Give each option in plain words
  with its real-world trade-off ("Option A shows updates instantly but uses
  more CPU; Option B refreshes once a second and is lighter"), not a raw
  technical menu.
- **Rule of thumb:** a product owner reading the question should be able to
  answer it without asking "what does that mean?". If they couldn't, rewrite it.

This applies to every interactive question — clarifications, design feedback,
and remediation choices alike. It governs *phrasing only*; the underlying rigor
of the work is unchanged.
