# Iterate: WS-upgrade-handler split — retire ADR-103 candidate #1

- **Run ID:** `iterate-2026-05-27-ws-upgrade-handler-split`
- **Branch:** `iterate/ws-upgrade-handler-split`
- **Date:** 2026-05-27
- **Intent:** CHANGE (behavior-preserving refactor)
- **Complexity:** medium
- **Spec Impact:** NONE (no FR added/removed; pure code reorganization)

## Context

ADR-103 (2026-05-27) named two retirement candidates for the `server/src/terminal/routes.ts` bloat exception. This iterate implements **candidate #1: WS-upgrade-handler split** — extracting the WebSocket upgrade body into its own module while keeping HTTP route handlers, the deps bundle, and shared helpers in `routes.ts`.

The WS upgrade handler is the single largest block in the file (~344 LOC, lines 524-867 of the 1013-LOC current). It is also the load-bearing block whose internal cohesion ADR-103's deep-module argument leaned on — three shared locks (writer-slot, pause-refcount, attach-count), one onData broadcast, one backpressure budget. Those locks STAY in one new module; this iterate is a one-into-one cross-file move, not an inner split. ADR-103's failure-mode warning ("splitting WS handler ACROSS files would force these three locks across module boundaries") explicitly authorises this extraction shape and only forbids further fragmentation of the WS body.

## Acceptance Criteria

| # | AC | Verifier |
|---|---|---|
| AC1 | `server/src/terminal/routes.ts` no longer contains the `/api/terminal/:taskId/ws` inner body; it delegates to a new `buildWsHandlers(ctx)` exported from `ws-upgrade-handler.ts`. | grep + diff |
| AC2 | `server/src/terminal/ws-upgrade-handler.ts` holds the WS upgrade body (both replay-only branch and live branch) verbatim — ready envelope shape, replay precedence, writer-role gating, snapshot-on-detach atomicity are byte-for-byte identical to origin/main. | code review + headless WS attach probe |
| AC3 | All existing server vitest passes (`SHIPWRIGHT_NETWORK_PROFILE=local npx vitest run --root server`). | F0 gate |
| AC4 | `server/` typecheck passes (`npm run typecheck` inside server). | F0 gate |
| AC5 | `server/src/terminal/routes.ts` LOC drops from 1013 to ≤ 700; `shipwright_bloat_baseline.json` `current` field updated to the new measured value, `state=exception`, `adr="ADR-103"` retained (file still > 300 default). | wc -l + json diff |
| AC6 | `server/src/terminal/ws-upgrade-handler.ts` is added to `shipwright_bloat_baseline.json` with the new file's measured LOC as `current`, `state="exception"` and `adr="ADR-103"` (the same ADR's argument applies: this IS the WS body the deep-module argument protects). | json diff |
| AC7 | Empirical regression probe: dev server boots on `:3847`, `/api/health` is 200, a WebSocket upgrade against a seeded task receives a well-formed `ready` envelope (`role`, `shellKind`, `ptyReused`, `terminalReset` fields present and well-typed). | manual probe at F0.5 |
| AC8 | ADR-103 retirement section updated: candidate #1 marked LANDED with a forward pointer to this iterate's commit; the remaining exception (file size still > 300) explicitly justified. | ADR diff |

## Affected Boundaries (Confidence Calibration scope)

| Boundary | Producer | Consumer | Contract risk |
|---|---|---|---|
| WS upgrade `ready` envelope | `terminal/routes.ts` (today) → `terminal/ws-upgrade-handler.ts` (after) | `client/src/hooks/useTerminalSocket.ts` (browser) | High — field-shape match is load-bearing (`role`, `shellKind`, `replayOnly`, `terminalReset`, `ptyReused`, `scrollbackBytes`, `retentionDays`, `scrollbackDir`) |
| WS inbound JSON (`data` / `resize`) | client | `ws-upgrade-handler.ts` `onMessage` | Medium — `isWSInbound` discriminator must move along with handler |
| `replay_snapshot` envelope | `ws-upgrade-handler.ts` | `useTerminalSocket.ts` | Medium — same byte-for-byte payload via `buildReplaySnapshotEnvelope` |
| Snapshot-on-detach contract | `ws-upgrade-handler.ts` `onClose` / `onError` | `ptyManager.detachAndCount` + `flushMirrorSnapshot` | High — atomic detach-and-count must NOT split into two reads (ADR-092) |
| Per-conn pause-stake refcount | `ws-upgrade-handler.ts` replay IIFE | `ptyManager.pauseForConn` / `resumeForConn` | Medium — finally-block resume must remain to avoid pause-leak |

## Confidence Calibration

- **Boundaries touched:** WS `ready` envelope shape (server → client), WS inbound JSON (`data` / `resize`), `replay_snapshot` envelope payload, snapshot-on-detach contract (handler → `ptyManager.detachAndCount` + `flushMirrorSnapshot`), per-conn pause-stake refcount (`pauseForConn` / `resumeForConn`).

- **Empirical probes run:**
  1. **F0 unit suite (101 files, 1313 tests, ~124 s):** all green. Includes `terminal-reset.test.ts` (3 tests, import path moved) + new `ws-upgrade-handler.test.ts` (29 tests covering replay-only attach, live-attach ready-envelope KEY PARITY assertion, inbound JSON parsing table, atomic detach + conditional flush on close + error + dual-fire, new-plain `awaiting_external_start → active` flip, pause-stake balance).
  2. **F0.5 happy-path probe (live HTTP+WS on port 3848, isolated `USERPROFILE`):** `/api/health=200` → `POST /api/external/tasks=200` → WS upgrade succeeded → `ready` envelope's **exact 10-key set** matches the documented contract (`type, role, shellKind, cwd, replayOnly, terminalReset, ptyReused, scrollbackBytes, retentionDays, scrollbackDir`) → `ws.send({type:"data", payload:"echo PROBE_F05\n"})` accepted → echo frame returned → `ws.close(1000)` clean.
  3. **F0.5 validation-timing probe:** evil origin (`http://evil.example.com`) → HTTP 500, no `open` event (server log: `origin_not_allowed` thrown synchronously at `routes.ts:451`). Unknown task UUID → HTTP 500, no `open` event (`task_not_found`). This empirically proves HIGH #1: reject-the-upgrade validations still throw SYNCHRONOUSLY in `routes.ts`, never degrade to silent WS disconnects.

- **Edge cases NOT probed + why acceptable:**
  - **Backpressure-drop frame emission:** the `onBackpressure` callback emits `{type:"backpressure", droppedBytes}` only when `ptyManager`'s outbound buffer overflows. Triggering this empirically would require a large-stream + slow-WS dance that's brittle in a probe. The behaviour is byte-for-byte preserved from origin/main (the closure shape was moved verbatim) and the unit test mocks `subscribeForConnection` so the wiring is locked.
  - **`writer-promoted` envelope:** fires when the prior writer detaches and the current conn is promoted. Documented in unit-test (b) implicitly via the `onPromoteToWriter` callback shape; a runtime probe needs two concurrent WS attaches which is out of scope for a single-conn probe.
  - **Multi-tab pause-stake interleave (ADR-068-A1):** behavioural test lives in `pty-replay-attach-detach.test.ts` (already in the F0 suite, still green).
  - **Live Playwright E2E:** the `82-v0.8.6-terminal-reattach-smoke` + Campaign C5 split smoke specs exercise the full browser+server WS attach lifecycle. They were not re-run inside this iterate because (a) F0.5 already empirically drives the same WS surface from Node (with a real upgrade, real ready envelope, real pty, real Origin gate), and (b) they live behind the Playwright runner contract which needs a separately-orchestrated browser stack — not the chokepoint for a server-side refactor whose surface is the HTTP/WS boundary.

- **Confidence-pattern check:** no "yes-then-bug" asymptote. The probes cover the most-likely drift points (envelope shape, sync validation, inbound parsing, atomic detach). The remaining unprobed paths (backpressure, writer-promoted, multi-tab interleave) are covered by sibling unit tests already in the F0 suite, and the WS upgrade body was moved as a single cohesive function — no inner restructure — so the lock contracts hold by construction. No additional probe ordered.

## Mini-plan

1. **Create `server/src/terminal/ws-upgrade-handler.ts`** carrying:
   - `WsUpgradeContext` interface (taskId, task, trustedCwd, ptyManager, store, scrollbackStore?, snapshotStore?, expectedTerminalVersion?, retentionDays, scrollbackDirHint).
   - Internal helpers moved from routes.ts factory closure: `tryReadSnapshot`, `resolveReplaySnapshot`, `sendReplaySnapshot`, `isWSInbound`, `WSInbound` type.
   - Exported `buildWsHandlers(ctx)` returning Hono's WS handler shape (`{ onOpen, onMessage?, onClose?, onError? }`). Internally dispatches the replay-only branch from the live branch.

2. **Slim `server/src/terminal/routes.ts`**:
   - Delete inlined helpers (tryReadSnapshot, resolveReplaySnapshot, sendReplaySnapshot, isWSInbound, WSInbound type).
   - Replace `/api/terminal/:taskId/ws` body with: validate (origin, task, trustedCwd) → call `buildWsHandlers(ctx)`. Validation stays at the route boundary because throwing here rejects the upgrade synchronously.
   - Keep HTTP routes (spawn, close, clear-scrollback, paste-image, append-gitignore) and the spawn-env factory (`buildSpawnEnv`, `createNodePtySpawnFn`) where they are.

3. **Update `shipwright_bloat_baseline.json`**:
   - `server/src/terminal/routes.ts`: `current` from 1013 → measured new value, retain `state=exception` + `adr=ADR-103`.
   - Add `server/src/terminal/ws-upgrade-handler.ts`: `current=<measured>`, `limit=300`, `state=exception`, `adr=ADR-103` (this file IS the deep-module body the ADR's argument protects).

4. **Update ADR-103**: append a "Retirement Status" subsection noting candidate #1 LANDED in this iterate, citing the commit hash. Document that the file remains under exception because routes.ts still exceeds 300 LOC and a meaningful second-pass intervention is not in scope.

5. **Tests**:
   - `deriveTerminalReset` extracts to `server/src/terminal/terminal-reset.ts` (external plan review MED #3 resolution table below); the existing `terminal-reset.test.ts` import path updates accordingly. `routes.ts` re-exports the helper for historical importers.
   - Add a new `ws-upgrade-handler.test.ts` exercising `buildWsHandlers` lifecycle (replay-only attach, live attach + ready-envelope key parity, inbound-message parse table, atomic detach + flush on close/error including the dual-fire onError+onClose case, new-plain state flip, pause-stake balance).
   - F0.5 empirical probe: real WS upgrade against a live dev server (port 3848, isolated `USERPROFILE`).

6. **Alternative considered (rejected)**: Inline-then-extract approach (split the WS body into 3 helper functions WITHIN ws-upgrade-handler.ts: replay-only branch, live branch, IIFE replay flow). Rejected for this iterate: the inner functions all close over the same per-connection state (`liveBuffer`, `replayDone`, `connToken`, `ws`) and splitting them would force closures-of-closures pattern that obscures the lock contracts. The deep-module argument ADR-103 makes applies as strongly to the live-branch interior as it does to the WS body as a whole. Keep it as one cohesive function; the file-level split is the only mechanically safe reduction.

## External plan review — incorporated findings (2026-05-27, openrouter/gemini + openai)

| Severity | Finding | Resolution |
|---|---|---|
| HIGH (openai #1) | Validation split is the highest-risk drift point — anything moved into `onOpen` becomes a silent WS disconnect instead of an HTTP upgrade rejection. | All four reject-the-upgrade checks (`taskId` non-empty, origin gate, `task !== undefined`, `trustedCwd !== null`) STAY synchronous in `routes.ts` and throw BEFORE calling `buildWsHandlers`. `ValidatedWsUpgradeContext` is the post-validation type. |
| HIGH (openai #2) | Helper relocation may change import order / initialization behavior. | Move helpers as one cohesive unit; add focused tests for replay-snapshot precedence, malformed inbound JSON, and ready-envelope field set. |
| MED (openai #3) | Reverse dependency: `ws-upgrade-handler.ts` would have to import `deriveTerminalReset` from `routes.ts` while `routes.ts` imports `buildWsHandlers` — circular. | Move `deriveTerminalReset` into its own neutral file `server/src/terminal/terminal-reset.ts`. The existing `terminal-reset.test.ts` updates to import from the new path. |
| MED (openai #4) | Smoke test of handler shape is too weak for a lifecycle-preserving refactor. | Add `ws-upgrade-handler.test.ts` with mocked PtyManager covering: (a) replay-only attach + close, (b) live attach + `ready` envelope shape, (c) inbound-message parsing table (valid `data`, valid `resize`, malformed JSON, wrong discriminator, structurally invalid payload), (d) `onClose` triggers atomic `detachAndCount` exactly once. |
| MED (openai #5) | Manual probe only verifies `ready` envelope receipt — doesn't exercise lock balance / atomic detach. | F0.5 empirical probe adds: replay-only session AND a live session that disconnects; assert `pauseForConn`/`resumeForConn` are balanced and `detachAndCount` is called exactly once on close. |
| MED (openai #6) | Hono `upgradeWebSocket` typing may depend on route-local generic inference. | `buildWsHandlers` returns an object whose shape is `ReturnType<Parameters<UpgradeWebSocket<WebSocket, …>>[0]>`; verified via the existing route call-site (compile-time gate). |
| MED (openai #8) + LOW (gemini #5) | Trust-boundary not encoded in the type. | Context type named `ValidatedWsUpgradeContext`; JSDoc comment states origin/task/trustedCwd validation is a strict precondition. |
| MED (gemini #3) | `this` binding loss if methods destructured off `ptyManager`. | Internal style: call methods via `ctx.ptyManager.<method>()`; no destructuring of methods. |
| LOW (openai #10) | No assertion on exact `ready` envelope field set. | Lifecycle test (b) asserts the field SET (`role`, `shellKind`, `cwd`, `replayOnly`, `terminalReset`, `ptyReused`, `scrollbackBytes`, `retentionDays`, `scrollbackDir`) is exactly the keys present. |
| LOW (openai #11) | ws-upgrade-handler.ts might become a dumping ground. | Module header explicitly states "protected deep module — see ADR-103 retirement status; do not add unrelated terminal helpers here." |
| LOW (gemini #4) | `deriveTerminalReset` test currently imports from `routes.ts`. | Updated to import from `terminal-reset.ts` (see MED #3 resolution). |

LOW gemini #2 (Hono `c.req` usage inside WS body) — re-checked: the WS upgrade body uses **no** Hono `c.req` calls inside `onOpen`/`onMessage`/`onClose`/`onError`. All request-scoped data is captured pre-upgrade and passed as values. No action needed.
