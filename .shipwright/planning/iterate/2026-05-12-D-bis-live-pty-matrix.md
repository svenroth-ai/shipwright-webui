---
iterate_id: D-bis
campaign: headless-terminal-refactor
parent_iterate: D (audit artifact; live-pty empirical extension)
created: 2026-05-12
complexity: small
risk_flags: [touches_io_boundary]
surface: web
runner: playwright
network_profiles: [local, tailscale]
status: in-progress
---

# Sub-Iterate D-bis: Live-pty Empirical Probe + Matrix

## Goal

Empirically verify (real-browser Playwright) that an LIVE pty (mid-lifetime,
NOT done/exited) preserves terminal state across SPA-navigation
(navigate-away then navigate-back) for the four task types webui supports:

1. Pure Claude (`new-plain`)
2. Task (`new-task`, phase=build)
3. Iterate (`new-iterate`)
4. Pipeline (`new-pipeline`)

This iterate is a TEST iterate, NOT a fix iterate. If the probe reveals
a regression, this iterate DOCUMENTS it with structured evidence and
hands off to a follow-up fix iterate (Iterate E). It does NOT attempt
to fix the bug.

## Background

Iterate B introduced cell-state snapshots via `@xterm/headless` mirrors.
The persistence path is:

```
pty.onData -> headlessMirror.write(chunk)        [continuous]
cleanup(taskId)                                  [pty exit / kill only]
  -> finalizeMirrorSnapshot(taskId, mirror)
    -> mirror.serializeStable()
    -> snapshotStore.write(taskId, {...})        [DISK]

WS attach (re-attach)
  -> tryReadSnapshot(taskId)                     [DISK]
  -> if snap: sendReplaySnapshot(ws, snap)
```

Code-reading of `server/src/terminal/routes.ts:683` and
`server/src/terminal/pty-manager.ts:780-825` shows:

- `snapshotStore.write()` is called ONLY from `finalizeMirrorSnapshot`.
- `finalizeMirrorSnapshot` is called ONLY from `cleanup`.
- `cleanup` is called ONLY from `pty.onExit` / `kill`.

Therefore, for a LIVE pty (no cleanup yet), there is no on-disk
snapshot. On re-attach, `tryReadSnapshot` returns null, no
`replay_snapshot` envelope is emitted, and replay falls through to
"flush live buffer" — which only contains data emitted AFTER attach,
not historical content.

Iterate B's spec calls this out as "valid per the plan's 'no replay'
trade-off". The user has empirically observed and reported this as
unacceptable. The plan record itself documents the assumption
(`embedded-terminal-refactor-headless.md` lists the trade-off), so
this is an architectural-intent question, not a wiring oversight.

The D-bis probe answers the question: **does the bug manifest in a
real browser as described, or does some other mechanism (xterm.js
component keep-alive, React-Router preservation, etc.) compensate?**

## Affected Boundaries (ADR-024)

- WebSocket frame protocol (server -> client): `replay_snapshot`,
  `scrollback-meta`, live `data` envelopes — captured via Playwright's
  `page.on("websocket")` for differential analysis.
- xterm.js DOM rendering: row-level text contents asserted via
  `locator(".xterm-rows > div").allTextContents()`.
- React-Router navigation lifecycle: navigate-away (link click) vs
  navigate-back (link click) — NOT page.reload (different code path).

Producer: pty-manager.ts + scrollback-store.ts + snapshot-store.ts.
Consumer: useTerminalSocket.ts + EmbeddedTerminal.tsx.
Round-trip probe IS the test (see AC #0).

## Acceptance Criteria

### AC #0 — STANDALONE PROBE (run FIRST, blocks matrix)

The probe is at `client/e2e/flows/_v0-9-6-live-pty-probe.spec.ts`
(underscore prefix matches existing `_v089-evidence.spec.ts` convention).

Probe steps:

1. Create + launch a fresh task (`new-task`, phase=build).
2. Open in browser, wait for `data-ws-ready=true`.
3. Wait up to 10s for any shell prompt (`$`, `>`, `PS`) in `.xterm-rows`.
   If no prompt: fail with captured DOM evidence.
4. Type a deterministic marker via real keyboard:
   `echo MARKER_<timestamp>` + Enter.
5. Wait up to 5s for the MARKER to appear in `.xterm-rows`.
6. Capture `xtermRowsBefore`.
7. Install `page.on("websocket")` collector capturing all frames.
8. Navigate-away: click task-board link (route change, NOT reload).
9. Wait 1s. Verify pty is still alive server-side (process listing
   optional; cleanest signal is whether the second WS attach gets a
   `second-attach` envelope or proceeds as a fresh writer).
10. Navigate-back: click the task. Wait for `data-ws-ready=true`.
11. Capture `xtermRowsAfter`.
12. Inspect captured WS frames for the post-navigate-back connection:
    look for `replay_snapshot` envelope.

Decision matrix (probe outcomes):

| Outcome | xtermRowsAfter contains MARKER? | `replay_snapshot` emitted on re-attach? | Interpretation                                |
|---------|---------------------------------|-----------------------------------------|-----------------------------------------------|
| A       | yes                             | yes                                     | Snapshot wires up for live ptys (refute bug)  |
| B       | no                              | no                                      | BUG CONFIRMED: live-pty state lost on nav     |
| C       | yes                             | no                                      | Component keep-alive preserves state somehow  |

Artifacts (always saved to `client/playwright-report/v0.9.6-live-pty-probe/`):

- `pre-navigate.png` — terminal after the MARKER is typed
- `post-navigate-back.png` — terminal after navigate-back
- `ws-frames.json` — all collected WS frames for both connections
- `probe-result.json` — outcome (A/B/C) + summary

### AC #1..#4 — FULL MATRIX (only if probe outcome ∈ {A, C})

At `client/e2e/flows/v0-9-6-live-pty-matrix.spec.ts`:

For each task type ∈ {new-plain, new-task (build), new-iterate, new-pipeline}:

1. **Lifecycle axis (A):** open -> launch -> wait-prompt -> type
   `echo <type>-fixture` -> wait-output -> navigate-away ->
   navigate-back -> assert live pty still owns the WS.
2. **Rendering axis (B):** `xtermRowsAfter` must contain the
   `<type>-fixture` text emitted before navigate-away.
3. **Cursor axis (C):** cursor position (probed via
   `window.__embeddedTerminal.buffer.active.cursorX/Y`) must equal
   the position recorded immediately before navigate-away (give or
   take a single-row delta for the prompt redraw).
4. **Single-pty axis (D):** server-side, the pty.pid must be the same
   before navigate-away and after navigate-back. Probe via a new
   diagnostic endpoint OR via the existing scrollback-bytes
   monotonicity check (bytes only grow; never reset to 0).

Network profile loop: run the matrix once with
`SHIPWRIGHT_NETWORK_PROFILE=local` (or unset, default), then with
`SHIPWRIGHT_NETWORK_PROFILE=tailscale`. If `tailscale` env not
detectable (`tailscale status` fails OR no IPN_HOST), skip cleanly
with a soft notice — NOT a test failure.

### AC #5 — Outcome handling (no fix attempted)

- If probe outcome = B: matrix MUST NOT run; commit only the probe
  spec, the ADR documenting the bug, and the artifacts.
- If probe outcome = A or C: matrix runs and all axes must pass; the
  ADR documents that the architectural concern is empirically refuted
  OR refined.

## Verification

- F0 unit + typecheck (server + client) — green
- F0.5 web surface — the probe IS the F0.5 evidence
- F3 decision log — ADR-091 (next free number) "Live-pty re-attach
  state preservation — empirical finding"
- F4 changelog — bullet under [Unreleased]: probe spec + (optionally)
  matrix spec
- F6 commit message — Conventional Commits

## Out of Scope

- Implementing snapshot-on-detach / snapshot-on-interval mid-lifetime
  writes. That is Iterate E.
- Tailscale-specific bug investigation — D-bis only runs the matrix
  on tailscale, it does not chase regressions specific to it.
- xterm.js upgrade paths.

## Notes

- Do NOT touch Iterate D branch; it remains as audit artifact on origin.
- Real browser is non-negotiable; no test-mode simulation.
- Conventional Commits, TypeScript strict, files under 300 lines.
- Use `npm.cmd` on Windows (subprocess gotcha).
