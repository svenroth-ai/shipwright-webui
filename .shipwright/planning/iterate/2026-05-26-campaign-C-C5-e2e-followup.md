# Iterate Spec: campaign-C-C5-e2e-followup

- **Run ID:** iterate-2026-05-26-campaign-C-C5-e2e-followup
- **Type:** change (test-only regression backfill for merged C5 refactor)
- **Complexity:** medium
- **Status:** draft

## Goal

Back-fill the **MANDATORY** Playwright E2E spec the C5 runner deferred
when it merged `EmbeddedTerminal.tsx` split (PR #70, merged commit
chain `d626596`). The split moved the auto-execute path (ADR-068-A1)
across `EmbeddedTerminal.tsx`, `useAutoLaunch.ts`, `useTerminalSocket.ts`,
and `useReplayDrainGate.ts`; today the LOAD-BEARING flow (Launch click
→ `ready{role:"writer"}` envelope → 250 ms quiesce → client-side
`{type:"data", payload:"claude --session-id …"}` WS frame) is driven
ONLY by vitest + jsdom mocks — never by a real browser against a live
server. This iterate adds the missing real-browser fence.

## Acceptance Criteria

- [ ] (E) New `client/e2e/flows/C5-embedded-terminal-split-smoke.spec.ts`
      exists.
- [ ] (E) **Test 1 — Launch path (fresh pty).** Create task via
      `POST /api/external/tasks` with a real tmp cwd. Capture WS frames
      via `page.on("websocket")` BEFORE navigation. `page.goto("/tasks/<id>")`.
      Click `[data-testid="cta-launch-in-terminal"]`. Within 30 s observe:
      - exactly one `ready` envelope (rx) for the task's terminal WS,
      - parsed envelope `role === "writer"`,
      - parsed envelope `ptyReused === false`,
      - at least one `{type:"data",payload:"claude --session-id …\r"}`
        envelope SENT (tx) AFTER the ready envelope,
      - `dataFrame.ts - readyFrame.ts >= 200 ms` (proves the
        prompt-readiness 250 ms quiesce gate is still wired post-split;
        loosened by 50 ms for clock jitter).
- [ ] (E) **Test 2 — Reload (pty persists; second ready has ptyReused).**
      After phase-1 Launch, `page.reload()`. Within 30 s observe a
      SECOND `ready` envelope on the freshly-attached WS with
      `ptyReused === true` — proves the pty survived the React-tree
      teardown and `pty-manager.get()` correctly reports the
      existing entry. The downstream "Resume click does NOT
      auto-fire a duplicate launch" assertion is **deferred** from
      this iterate: it requires Claude to bootstrap a JSONL so
      task.state ∈ {idle, active} renders the Resume CTA, which
      the isolated USERPROFILE intentionally prevents. The guard
      arming itself is covered by 204 vitest cases in
      `EmbeddedTerminal.test.tsx`.
- [ ] (E) Spec runs GREEN against an isolated stack (env-prefixed
      invocation documented in the spec header per memory
      `feedback_iterate_e2e_isolated_userprofile` +
      `feedback_dev_vs_autostart_port_conflict`).
- [ ] (E) Per-spec `tests_run >= 2`; F0.5 `surface_verification.json`
      shows `surface=web`, `exit_code=0`, `tests_run >= 2`.

## Spec Impact

- **Classification:** none
- **NONE justification:** Test-only addition. The C5 refactor's
  production behavior was already merged in PR #70 with bit-perfect
  semantics asserted by 204 vitest cases + 11/11 ADR-067 Playwright
  specs. This iterate adds a regression fence around the ALREADY
  IMPLEMENTED auto-execute path; it does not change any user-visible
  contract or FR.

## Out of Scope

- Further reducing `EmbeddedTerminal.tsx` 287 → ≤250 LOC (separate
  scope; not blocking).
- Extracting `parseTerminalEnvelope(raw)` helper from
  `useTerminalSocket.ts` (explicitly deferred from C5; the existing
  `__ws_frame_roundtrip.test.ts` header already tracks it).
- The C5 campaign's other ACs that ARE met (the 3 hook modules, the
  Boundary Probe, the bloat-baseline removal of the source file).
- Refactoring or touching `useAutoLaunch.ts`, `useReplayDrainGate.ts`,
  `useTerminalSocket.ts`, or any server-side code.

## Design Notes

n/a — no UI change. The spec exercises the existing CTA testids
`cta-launch-in-terminal` (LaunchCTA.tsx:109) and
`cta-copy-resume-command` (ResumeCTA.tsx:95) which are already
load-bearing for specs 30/36/36b/43/48/70-d/70-f.

## Affected Boundaries

The new spec ASSERTS the WS envelope contract; it does not produce or
consume changes to any boundary.

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| `server/src/terminal/routes.ts` (lines 714-742) | `client/src/hooks/useTerminalSocket.ts` (`JSON.parse` on receive) | JSON WS envelope: `{type:"ready", role, shellKind, cwd, replayOnly, terminalReset, ptyReused, scrollbackBytes, retentionDays, scrollbackDir}` |
| `client/src/components/terminal/useAutoLaunch.ts` (line 174) → `useTerminalSocket.send` | `server/src/terminal/routes.ts` (WS `message` handler) | JSON: `{type:"data", payload:"<bytes>"}` |

`touches_io_boundary` = **YES**. The existing
`__ws_frame_roundtrip.test.ts` covers the JSON.stringify/JSON.parse
round-trip at the unit level (deep-equal of all 9 envelope shapes).
This iterate adds the second leg: end-to-end frame capture against
the REAL Hono server, asserting the envelopes still travel byte-stable
through the network + the production split shells.

## Verification (F0.5)

- **Surface:** `web` — MANDATORY. Memory
  `feedback_browser_fixes_need_real_browser_smoke` says vitest +
  policy-boot-log ≠ "terminal works". The whole point of this iterate
  is that the auto-execute LOAD-BEARING path was never driven by a
  real browser against a live stack.
- **Runner command** (isolated stack — temp USERPROFILE, loopback bind,
  PORT=4847 so the production `:3847` listener stays untouched):
  ```bash
  # 1. Prebuild (only on first run / after source changes)
  cd server && npm run build && cd ../client && npm run build

  # 2. Boot isolated server in a separate shell (foreground or `&`):
  TMPDIR_FOR_E2E="$(mktemp -d)"   # PowerShell: New-Item -ItemType Directory ...
  USERPROFILE="$TMPDIR_FOR_E2E"  HOME="$TMPDIR_FOR_E2E" \
    SHIPWRIGHT_NETWORK_PROFILE=local  PORT=4847 \
    node server/dist/index.js

  # 3. Run the new spec against it:
  BASE_URL=http://127.0.0.1:4847 \
    cmd /c client/node_modules/.bin/playwright.cmd test \
      --config=client/playwright.config.ts \
      client/e2e/flows/C5-embedded-terminal-split-smoke.spec.ts
  ```

  Notes:
  - `PORT=4847` is loopback; the production listener on `:3847` is
    not disturbed (memory `feedback_dev_vs_autostart_port_conflict`).
  - `USERPROFILE`/`HOME` redirect makes `~/.shipwright-webui/*.json`
    land in the tmp dir; the user's real task board is not polluted
    (memory `feedback_iterate_e2e_isolated_userprofile`).
  - `SHIPWRIGHT_NETWORK_PROFILE=local` is the env-isolation knob from
    iterate-2026-05-19-oxlint-and-cors-env (memory
    `project_server_vitest_needs_network_profile_local`).
  - `client/playwright.config.ts` already supports `BASE_URL` per
    iterate-2026-05-23 (terminal-selection-uxd) — passing `BASE_URL`
    suppresses the managed `webServer` autostart.
  - Spec is authored to use only RELATIVE paths (`/api/...`,
    `/tasks/<id>`) so it works against any port via `BASE_URL`.
  - The production server serves `client/dist` via serveStatic, so
    no separate Vite is required → StrictMode double-mount is OFF
    (memory `strictmode_aborts_first_ws_in_e2e`). The first WS
    attach is observed through `page.on("websocket")` straightforwardly
    — no raw `new WebSocket()` probe needed in this scenario.

- **Evidence path:** `playwright-report/index.html` +
  `e2e-results.json` + `.shipwright/runs/<run_id>/surface_verification.json`.

## Confidence Calibration

- **Boundaries touched:** WS envelopes per the table above.
- **Empirical probes run:**
  1. **Test 1 — Launch path GREEN.** WS-frame capture against the
     isolated live server: first `ready{role:"writer", ptyReused:false,
     shellKind:"pwsh"}` observed AFTER the EmbeddedTerminal lazy mount;
     `{type:"data", payload:"claude --session-id <uuid> … \r"}` sent
     within QUIESCE_MIN_MS ≤ delta < QUIESCE_MAX_MS of the click.
     **Empirical note (Iterate B from external review):** the FIRST
     run with `clickAt` filter on socket-open time failed because
     EmbeddedTerminal is lazy-loaded (TaskDetailPage.tsx:51) — the
     test was clicking BEFORE the WS attached. Mirroring real-user
     timing (wait-for-ready-then-click) is what proved the
     auto-execute path; this is now documented in the spec header.
  2. **Test 2 — Reload path GREEN.** After page.reload, second
     `ready{ptyReused:true}` observed on the freshly-attached WS;
     proves the pty survived the React-tree teardown.
  3. **Regression sweep:** specs 73 (embedded-terminal) + 74
     (auto-launch + scrollback) pass against the same isolated stack
     (18/18 GREEN). Spec 82 fails 3/3 on `unknown_project_id` — a
     PRE-EXISTING dependency on a hardcoded project UUID that the
     isolated USERPROFILE lacks; NOT a C5-split regression.
  4. **TypeScript:** `tsc --noEmit` clean across the spec + 2 new
     helpers.
- **Edge cases NOT probed + why acceptable:**
  - **Resume click → no duplicate launch.** Requires Claude to
    bootstrap a JSONL so task.state ∈ {idle, active} renders Resume
    CTA; the isolated USERPROFILE intentionally prevents this
    (auth + plugin config under `$tmp/.claude/` not seeded). The
    guard arming itself (`ptyReused:true` → one-shot guard) is
    covered by 204 vitest cases in `EmbeddedTerminal.test.tsx`. A
    future iterate could pre-seed a JSONL fixture to drive the full
    flow.
  - **Cross-shell variants** (cmd.exe vs bash). The spec runs
    Chromium on Windows → exercises the `pwsh` branch (default
    shell). Cross-shell covered by `pickShellCommand` unit logic +
    spec 75 launch matrix.
  - **StrictMode-aborted first WS.** Production build chosen
    deliberately (memory `strictmode_aborts_first_ws_in_e2e`);
    dev-mode coverage would need the raw `new WebSocket()` probe.
- **Confidence-pattern check:** One yes-then-bug pattern fired in
  this run — the FIRST `clickAt` filter assumption was falsified by
  the lazy-mount race. Resolved by mirroring real-user timing
  (wait-for-ready-then-click). No further pattern.

## Self-Review (7-point)

1. **Scope match:** ACs delivered — Test 1 (Launch path) + Test 2
   (Reload + ptyReused). Test 2's downstream "Resume click → no
   duplicate launch" is explicitly **deferred** with rationale
   (env constraint); not a silent drop.
2. **Test coverage:** 2 Playwright tests GREEN against isolated
   stack; 18 regression specs (73 + 74) still GREEN; spec 82
   failures are PRE-EXISTING `unknown_project_id` dependency, not
   a C5-regression. The Boundary Probe (`__ws_frame_roundtrip.test.ts`)
   was already merged in C5.
3. **Side effects:** None. Test-only addition. No production code
   touched.
4. **Architecture:** No new write surface; no new component; no new
   convention. `client/e2e/helpers/{ws-capture,task-fixture}.ts` are
   spec support modules — they live next to the existing
   `client/e2e/helpers/terminal-selection.ts` and follow the same
   pattern.
5. **Code quality:** Helpers extracted to keep the spec under
   300 LOC. Buffer-safe payload coercion, predicates filter on
   FRAME timestamp (not socket-open), explicit type predicates.
6. **Compliance:** `spec_impact = none` with justification recorded;
   no FR changes; ADR will be a short decision-drop documenting the
   test backfill + the lazy-mount race finding.
7. **Affected Boundaries:** WS envelope JSON contract — touched
   only as an ASSERTION target (the spec verifies the existing
   contract; no producer/consumer change). Unit-level Boundary
   Probe (`__ws_frame_roundtrip.test.ts`) already covers the
   round-trip; the new E2E adds the live-network leg.

## References

- Campaign spec: `.shipwright/planning/iterate/campaigns/2026-05-25-bloat-cleanup-C-webui/sub-iterates/C5-embedded-terminal-split.md`
- Source-of-truth on auto-execute: ADR-068-A1; CLAUDE.md rule 19.
- Auto-launch handshake constants: `client/src/components/terminal/useAutoLaunch.ts` lines 34-38 (PROMPT_QUIESCE_MS=250).
- Existing prior art for WS frame capture: `client/e2e/flows/76-autolaunch-reader-writer-race.spec.ts`.
