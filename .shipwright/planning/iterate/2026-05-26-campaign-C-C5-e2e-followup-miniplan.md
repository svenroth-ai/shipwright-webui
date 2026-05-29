# Mini-Plan: campaign-C-C5-e2e-followup

- **Run ID:** iterate-2026-05-26-campaign-C-C5-e2e-followup
- **Spec:** `2026-05-26-campaign-C-C5-e2e-followup.md`
- **Branch:** `iterate/campaign-C-C5-e2e-followup` (worktree
  `.worktrees/campaign-C-C5-e2e-followup`, base `origin/main` @
  `d626596`)

## Files to add / change

1. **NEW** `client/e2e/flows/C5-embedded-terminal-split-smoke.spec.ts`
   — ~200-260 LOC Playwright spec with 2 tests (Launch path, Resume
   re-attach). Self-contained — no production-code change. Header
   carries the operator-invocation snippet from the iterate spec's
   "Runner command" block so future runs of the spec are
   reproducible.

That's it. No other source edits planned.

## Test strategy (RED → GREEN)

RED definition: the spec file does NOT exist on `main`. The very fact
that adding it produces a passing E2E run is GREEN — there is no
intermediate "tests fail because production is broken" state to engineer
because the production behavior is already merged.

To make the RED side meaningful, the spec is authored to FAIL closed if
ANY of the contract assertions drift:

- `ready.role !== "writer"` → fails Test 1.
- `ready.ptyReused !== false` on FIRST attach → fails Test 1.
- `data` frame fires < 200 ms after `ready` → fails Test 1 (proves the
  handshake is still gating; a regression that bypasses the quiesce
  would surface here).
- No `data` frame with `claude --session-id` within 30 s → fails
  Test 1.
- `ready.ptyReused !== true` on SECOND attach → fails Test 2.
- A duplicate `claude --session-id` data-frame fires within 3 s of
  the Resume click → fails Test 2 (regression of the one-shot guard).

## Approach

- Model after `76-autolaunch-reader-writer-race.spec.ts` for the
  `page.on("websocket")` + `framesent` / `framereceived` capture
  pattern.
- Filter captured frames by `ws.url().includes("/api/terminal/" + taskId)`
  so the spec is robust to other WS instances (e.g. a future
  diagnostics WS).
- Parse rx frames as JSON only when `payload[0] === "{"` (text frames
  carrying envelopes); skip otherwise.
- Use `test.setTimeout(120_000)` for headroom on the launch / replay
  / reload steps.
- Avoid relying on `attachWsCapture` from spec 76 — duplicate the small
  helper inline to keep the spec self-contained (no cross-spec import
  surface — keeps the regression fence durable).

## Test runner

- F0.5 surface `web`, invoked via the operator snippet in the iterate
  spec's "Runner command" section.
- The spec sits alongside specs 73-89 in `client/e2e/flows/`; same
  Playwright config, same `BASE_URL` env contract.

## Regression sweep (after the new spec is GREEN)

Re-run the existing terminal regression specs against the same
isolated stack to confirm zero interference:

```bash
BASE_URL=http://127.0.0.1:4847 cmd /c \
  client/node_modules/.bin/playwright.cmd test \
  --config=client/playwright.config.ts \
  client/e2e/flows/{73-embedded-terminal,74-auto-launch-disk-persistence,76-autolaunch-reader-writer-race,82-v0.8.6-terminal-reattach-smoke,v0-9-6-live-pty-replay}.spec.ts
```

(`v0-9-6-live-pty-replay.spec.ts` doesn't exist under `flows/` per
the directory listing — the regression-guard for ADR-092 lives
elsewhere; if it's not under flows/ it's a vitest spec under
`server/`. Adjust at runtime; do not block on it.)

## Risks + mitigations

- **R1: The 200 ms quiesce assertion is tight.** Clock jitter on a
  busy dev box may produce 195 ms occasionally. Mitigation: assert
  `>= 200 ms`, not `>= 250 ms`. The handshake constant is 250 ms
  so any real implementation will be ≥ 200 ms in practice; if a
  future iterate genuinely shortens the constant below 200 ms we
  WANT to know.
- **R2: `page.reload()` may not produce a fresh WS attach if the
  terminal pane has not mounted yet.** Mitigation: in Test 2,
  `await expect(terminalReadyEnvelope_TX2).toBeDefined()` BEFORE
  clicking Resume; if the second `ready` never arrives within
  30 s the test fails the precondition assertion explicitly so
  the failure is diagnostic (not a confusing timeout downstream).
- **R3: Production `node dist/index.js` does not serve a SPA
  fallback** (memory `feedback_browser_fixes_need_real_browser_smoke`
  and the iterate-2026-05-18-inbox-terminal-prompts learning).
  Mitigation: navigate via `page.goto("/")` first then
  `page.goto("/tasks/<id>")` once the React Router is mounted — OR
  navigate directly to `/tasks/<id>` since the server happens to
  have a `serveStatic` fallback for unknown paths; verify
  empirically. (Per the existing spec 74 which uses
  `page.goto("/tasks/<id>")` directly, this works.)
- **R4: Resume CTA might not render if the task is in a state that
  doesn't surface it.** Mitigation: after Launch, give the JSONL
  observer ≥ 3 s to populate `firstJsonlObservedAt` so the task
  transitions into a state where Resume renders. If the CTA does
  not appear within a 20 s window after reload, fail the
  precondition explicitly (R2 pattern).
- **R5: The isolated server build process can be slow + fragile on
  Windows.** Out of scope for THIS iterate — the build is the
  operator's responsibility; the spec itself doesn't shell out.

## Done-when

1. The new spec file exists in the worktree.
2. F0.5 run shows `surface=web, exit_code=0, tests_run>=2`.
3. The terminal regression sweep is GREEN against the same isolated
   stack.
4. Self-review + Confidence Calibration sections of the iterate spec
   are filled in with empirical findings.
5. F0..F12 finalize completes; PR opens for review.
