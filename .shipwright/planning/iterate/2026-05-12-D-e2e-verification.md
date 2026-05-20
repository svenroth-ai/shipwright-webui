# Iterate Spec: D — Post-campaign E2E verification matrix

- **Run ID:** iterate-2026-05-12-D-e2e-verification
- **Type:** change (test-only authorship)
- **Complexity:** small (classified 2026-05-12; risk-flag `touches_auth` is a regex-FP — no real auth touch)
- **Status:** in-progress
- **Campaign:** headless-terminal-refactor (post-A/B/C; supersedes ADR-069/077/079/086 via ADR-087)

## Goal

Empirically verify the headless-terminal-refactor campaign's end-to-end behavior
across all four supported task types (Pure Claude / Task / Iterate / Pipeline)
× four verification axes (lifecycle, rendering, cursor, single-session-guarantee)
× two network profiles (local + tailscale auto-detect). Closes the F0.5 gap
deferred at Iterate C and validates the user-erlebbare Surface against the
merged main state (commit `b369819`).

## Acceptance Criteria

- [ ] Playwright spec authored at `client/e2e/flows/v0-9-5-task-type-matrix.spec.ts`
- [ ] 4 task types × 4 axes describe-blocks. Tests skip cleanly when an axis
      is not applicable to the task type (with explicit `test.skip(..., reason)`)
- [ ] Local-profile run: ALL applicable scenarios PASS (or skip with reason).
- [ ] Tailscale-profile run: ALL applicable scenarios PASS OR cleanly-skipped
      on no-tailscale-env (`skipped_no_tailscale_env`).
- [ ] WS-frame-stream evidence: each scenario captures via `page.on("websocket")`
      and asserts spawn count + replay envelope sequence.
- [ ] No unwanted additional pty sessions: each task produces EXACTLY ONE
      pty-spawn-equivalent over its full lifecycle (asserted via WS-URL count
      where each `/api/terminal/<taskId>/ws` upgrade implies at-most-one pty
      ensure-or-create); subsequent re-attaches yield `replay_snapshot` only.
- [ ] Evidence captured at `client/playwright-report/` AND
      `.shipwright/runs/sub_iterate-20260511-204305/D/playwright-report-{local,tailscale}/`

## Affected FRs

- The embedded-terminal user surface (TaskDetail → embedded terminal tab) — no
  explicit FR-number in the campaign plan; the contract under verification is
  ADR-087 + ADR-088 + ADR-089 cell-state-snapshot replay.

## Out of Scope

- Fixing any regression discovered. If tests fail on a real bug, document it
  and fail this iterate — Iterate E (or a separate fix-iterate) is the fix.
- New feature work or production-code changes.
- Verifying that Claude (the binary) actually launches successfully — the
  pty's spawn target is the SHELL (per pty-manager whitelist, ADR-067); the
  auto-launched command string is sent to that shell. The test verifies the
  command reaches the shell, not that the shell's child process succeeds.

## Design Notes

n/a — test-only authorship.

## Affected Boundaries

The WS protocol envelope (`replay_snapshot` from ADR-089) is the primary
boundary under test. Server emits; client consumes via `useTerminalSocket`.

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| `server/src/terminal/routes.ts` (WS upgrade replay branch) | `client/src/hooks/useTerminalSocket.ts` (replay_snapshot handler) | WS JSON envelope (`replay_snapshot` type) |
| `server/src/terminal/pty-manager.ts` (`pty.onData`) | `client/src/components/terminal/EmbeddedTerminal.tsx` (`xterm.write`) | WS data frames (`data` type) |
| `client/src/contexts/LaunchCoordinatorContext.tsx` (`dispatchAutoLaunch`) | `EmbeddedTerminal` (token-dedup via `consumedTokens`) | In-process React context |

The boundary under test is observed (not modified). No producer change.

## Confidence Calibration

- **Boundaries touched:** WS envelope read path (observation only — test code)
- **Empirical probes run:** the 4-axis × 4-type Playwright matrix IS the probe set
- **Edge cases NOT probed:**
  - Network-partition mid-replay (out of scope — needs network-conditioning infra)
  - Multi-tab attach race on the SAME task (out of scope — covered by spec 45 separately)
  - Real Claude subprocess lifecycle (out of scope — pty is shell-only per ADR-067)
- **Confidence-pattern check:** Iterate-D IS the asymptote probe for the campaign.
  If matrix passes on local AND (tailscale OR cleanly-skipped), the campaign
  boundary is calibrated. If it fails on a real bug → fix-iterate E.

## Verification

- **Surface:** web
- **Runner command:**
  ```
  npx playwright test e2e/flows/v0-9-5-task-type-matrix.spec.ts \
    --reporter=html,line
  ```
  (Run twice: local-profile = default `BASE_URL=http://127.0.0.1:5173`;
  tailscale-profile = `BASE_URL=http://<tailscale-ip>:5173` with Hono bound
  to Tailscale.)
- **Evidence path:** `client/playwright-report/index.html` + on-failure screenshots/videos +
  copy archived to `.shipwright/runs/sub_iterate-20260511-204305/D/`.

## Plan-D″ + ADR invariants preserved

This is test-only authorship. ADR-067 shell whitelist + ADR-068-A1 client-side
auto-launch + ADR-087/088/089 snapshot replay are observed, not modified.
