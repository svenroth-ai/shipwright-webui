# ADR-103: Bloat exception — `server/src/terminal/routes.ts` raised to 1013-LOC

<!-- Filed under iterate-2026-05-27-fix-pty-reused-prewarm-race. This
     ADR transitions the baseline entry for terminal/routes.ts from
     `state=grandfathered` (anonymous TODO) to `state=exception`
     (named accepted decision). The triggering edit (the prewarm-race
     fix) landed at net-zero LOC vs origin/main, but the file is
     already 3.4× the 300-LOC default limit — the Stop-hook iron law
     is right that touching an over-limit file without a named
     exception is a ratchet, even at +0 net. This ADR pays that debt. -->

- **Status:** accepted
- **Date:** 2026-05-27
- **Re-Review-Date:** 2026-08-27 _(3 months out. Reviewer at that
  date checks whether the seven-handler argument still holds — in
  particular, whether `external/routes.ts` C2 split (sibling file,
  separate iterate scope) suggests a similar split for
  terminal/routes.ts.)_
- **Incident Reference:** iterate-2026-05-27-fix-pty-reused-prewarm-race,
  branch `iterate/fix-pty-reused-prewarm-race`, PR #75.

## Context

`server/src/terminal/routes.ts` is the single Hono route module for
the embedded-terminal subsystem. It is 1013 LOC against the project
default limit of 300, has lived in `shipwright_bloat_baseline.json`
as `state=grandfathered` since Campaign A.defense seeded the baseline,
and has accumulated mass through ten load-bearing endpoints + the
WebSocket upgrade handler:

| Surface | ADR | Concern |
|---|---|---|
| `WS GET /api/terminal/:id/ws` | ADR-067 | authoritative pty creation + role assignment |
| `POST /api/terminal/:id/spawn` | ADR-067 | idempotent prewarm |
| `POST /api/terminal/:id/close` | ADR-068-A1 (Decision #18) | kill pty, keep scrollback |
| `POST /api/terminal/:id/clear-scrollback` | ADR-068-A1 | destructive scrollback wipe |
| `POST /api/terminal/:id/paste-image` | ADR-067 | multipart upload, magic-byte sniff, 8 MiB cap |
| `POST /api/terminal/:id/append-gitignore` | ADR-067 | idempotent append to project `.gitignore` |
| `POST /api/terminal/:id/resize` | ADR-067 | cols/rows pass-through |
| `POST /api/terminal/:id/write` | ADR-067 | writer-role-gated pty.write |
| `WS replay-snapshot envelope emit` | ADR-087/092 | live-mirror-first / disk-fallback |
| `WS attach replay-drain handshake` | ADR-068-A1 | pause/resume sequencing |

The triggering edit for this ADR (iterate-2026-05-27-fix-pty-reused-prewarm-race)
was net-zero LOC: it changed one destructure (`{ role }` →
`{ role, hadPriorWriter }`), retitled one inline comment, and swapped
one field source (`ptyReused: ptyExistedBeforeAttach` →
`ptyReused: hadPriorWriter`). The Stop-hook iron law correctly
flagged that touching an oversize file without a named exception is
a ratchet anyway. This ADR records the named decision.

## Ousterhout Argument

`terminal/routes.ts` is a **wide module** by route count (ten
handlers) but a **deep module** by shared-state count (one): every
handler closes over `ptyManager`, `scrollbackStore`, `snapshotStore`,
`store`, `realPathGuard`, and the dependency-injected
`TerminalRoutesDeps` bundle. The narrow public interface is a single
exported `createTerminalRoutes(deps)` function returning a Hono
sub-router; everything else is encapsulated inside the factory
closure.

Splitting along route boundaries — e.g. `terminal-spawn-routes.ts`,
`terminal-replay-routes.ts`, `terminal-paste-routes.ts` — would
require either (a) duplicating the `TerminalRoutesDeps` plumbing
across N factory functions, or (b) extracting the dependency bundle
itself into a shared module the route files import. Option (a) is
mechanical churn; option (b) is exactly the move ADR-101 calls out
as the failure mode for `pty-manager.ts`: moving the complexity
outward rather than reducing it.

The WS upgrade handler is the load-bearing example. It is one
function that integrates:
- pre-attach pty-existence probe (`ptyExistedBeforeAttach`,
  drives ADR-104 `terminalReset`)
- atomic `ptyManager.attach(taskId, conn)` returning
  `{role, hadPriorWriter}` (this iterate's contract)
- new-plain `awaiting_external_start → active` state flip on
  WS upgrade (iterate v0.8.5 AC-4)
- live-buffer subscription + replay-snapshot emit + buffer flush
  (ADR-087 / ADR-092)
- per-conn pause-stake refcount for replay drain (ADR-068-A1)
- atomic detach-and-count for snapshot-on-last-detach
  (ADR-092)
- writer-stuck watchdog enforcement (ADR-069)

These steps share three locks (writer-slot, pause-refcount,
attach-count), one stream (the pty.onData broadcast), and one
backpressure budget. Splitting the WS upgrade handler across files
would force these three locks across module boundaries — exactly
the failure mode ADR-101 documents for pty-manager.ts.

## YAGNI Check

Walk through each of the ten endpoints and ask "needed today?":

1. **`WS /ws`** — needed today (ADR-067 authoritative pty creation).
2. **`POST /spawn`** — needed today (latency prewarm; ADR-067).
3. **`POST /close`** — needed today (explicit "Stop terminal
   session" menu action; ADR-068-A1 Decision #18).
4. **`POST /clear-scrollback`** — needed today (privacy boundary;
   ADR-068-A1).
5. **`POST /paste-image`** — needed today (ADR-067 user-facing
   image-paste flow into the embedded terminal).
6. **`POST /append-gitignore`** — needed today (ADR-067 idempotent
   `.shipwright-webui/` line in `.gitignore`).
7. **`POST /resize`** — needed today (xterm-resize forwarding;
   ADR-067).
8. **`POST /write`** — needed today (DOM paste text-only branch
   sends through here; ADR-067 + iterate-2026-05-18-terminal-copy-paste).
9. **`WS replay-snapshot emit`** — needed today (ADR-087/092
   replay primitive).
10. **`WS attach replay-drain handshake`** — needed today
    (ADR-068-A1; without it, attach-replay corrupts ANSI/UTF-8).

None of the endpoints is speculative scope; none can be deleted;
the size is load-bearing.

## Chesterton-Fence Check

Four ADRs document why the current shape exists:

- **ADR-067** — embedded-terminal launcher (xterm.js + node-pty + WS).
  Established the spawn whitelist + the loopback-only Origin gate
  + `realPathGuard` enforcement for paste-image / append-gitignore.
  The fence here is "webui spawns no Claude process directly"; the
  WS upgrade handler is the enforcement line.
- **ADR-068-A1** — auto-execute via client-side WS data-frame +
  disk-backed scrollback persistence. Established the per-conn
  pause-stake refcount, the per-task PQueue, and the
  `<taskId>.log` filename convention.
- **ADR-087** — cell-state snapshot as the SOLE replay primitive.
  Retired the four byte-stream compensations (sanitizer, collapse,
  pushdown, skip-for-new-plain) AND the legacy chunked-replay
  path. The replay-snapshot emit in `routes.ts` is the single
  enforcement line.
- **ADR-092** — live-mirror-first / disk-fallback replay precedence.
  Established `detachAndCount` as the atomic detach primitive and
  fire-and-forget `flushMirrorSnapshot` on last detach. Both
  primitives are exercised inside the WS upgrade handler.

All four fences stand for documented reasons; tearing any of them
down would require revisiting the parent ADR. None is a candidate
for "tear it down and refactor instead".

## Decision

Grant a bloat exception: `server/src/terminal/routes.ts` is allowed
to remain at its current 1013 LOC. Baseline entry transitions from
`state=grandfathered` + `adr=null` to `state=exception` + `adr="ADR-103"`.
The anti-ratchet rule (Campaign A.defense) continues to apply — the
`current` value in the baseline is a ceiling, not a sliding target.

**Retirement plan:** retire this exception when one of the following
lands:
- A separate iterate splits the WS upgrade handler from the HTTP
  endpoints (the WS handler is the largest single block at ~400 LOC
  and is where the shared-locks argument is strongest; splitting
  IT alone would be a meaningful reduction).
- An auth layer is added to the embedded-terminal subsystem that
  genuinely separates concerns (e.g. a distinct module owning
  "who is allowed to attach to which task" so the writer-role
  decision can move out of the WS upgrade handler).

**Out of scope for retirement:** mechanical extraction of
"paste-image into a file" or "spawn into a file" — these are HTTP
endpoints that share the same `realPathGuard` + `TerminalRoutesDeps`
plumbing as the WS handler. Splitting them mechanically is option
(a) above (duplicate plumbing) and creates churn without reducing
complexity.

## Retirement Status — Candidate #1 PARTIALLY LANDED (2026-05-27)

Iterate `iterate-2026-05-27-ws-upgrade-handler-split` executed
retirement candidate #1 ("split the WS upgrade handler from the HTTP
endpoints"):

- `server/src/terminal/routes.ts`: 1013 → 620 LOC (-39 %). The WS
  upgrade body moved to `server/src/terminal/ws-upgrade-handler.ts`
  (527 LOC) as a single cohesive function `buildWsHandlers(ctx:
  ValidatedWsUpgradeContext)`. The four reject-the-upgrade validations
  (origin gate, taskId non-empty, task lookup, `resolveTrustedCwd`)
  STAY synchronous in `routes.ts` and throw before `buildWsHandlers`
  is called — anything that throws inside `onOpen` degrades to a
  silent WS disconnect instead of the HTTP upgrade rejection the
  contract requires (external plan review HIGH #1, 2026-05-27).
- `deriveTerminalReset` extracted to neutral module
  `server/src/terminal/terminal-reset.ts` to break the cycle risk
  (external plan review MED #3).
- New lifecycle/parse tests in `server/src/terminal/ws-upgrade-
  handler.test.ts` (28 tests covering replay-only attach, live attach
  ready envelope key parity, inbound-message parsing table, atomic
  detach-and-flush on close/error, new-plain state flip, pause-stake
  balance).
- Bloat baseline updated: `routes.ts.current` lowered from 1013 → 620
  (anti-ratchet ceiling moves DOWN with the file shrink — allowed by
  rule), `ws-upgrade-handler.ts` added with `state=exception`,
  `adr=ADR-103` (this file IS the deep-module body whose argument
  ADR-103 protects).

### Exception not yet fully retired — why

`routes.ts` at 620 LOC still exceeds the 300-LOC default limit, so
the named exception is still needed. The remaining mass is the five
HTTP route handlers (spawn / close / clear-scrollback / paste-image /
append-gitignore) + the spawn-env factory (`buildSpawnEnv`,
`createNodePtySpawnFn`). These all share the same
`TerminalRoutesDeps` bundle + `realPathGuard` flow; mechanically
splitting them across files is the very failure mode this ADR
rejected. Candidate #2 (auth layer extraction) remains the path
toward full retirement; the Re-Review-Date of 2026-08-27 still
applies.

### Protected deep module — anti-dumping anchor

`ws-upgrade-handler.ts` is itself a protected cohesive module. It
exists for ONE purpose: the WS upgrade body with its three shared
locks (writer-slot, pause-refcount, attach-count), one onData
broadcast, and one backpressure budget. Do NOT add unrelated
terminal helpers (HTTP-only logic, spawn-env factory, image-paste
utilities, etc.) to it — that would convert the exception from a
named cohesive boundary back into the anonymous-grandfathered mass
the Stop-hook iron law correctly flags. The module header repeats
this anchor as a maintenance fence (external plan review LOW #11).

## Consequences

- Baseline entry records the named decision via `adr="ADR-103"`.
  Campaign A.defense Group H audit recognises `state=exception` +
  valid `adr` as the named-decision satisfied state.
- The pre-commit anti-ratchet hook continues to block any commit
  that increases the `current` value upward. This exception raises
  the *allowed* ceiling for this file; it does not relax the
  anti-ratchet rule.
- Downstream tests do NOT change. The exception is purely a
  baseline metadata flip.
- Cost if the exception holds longer than 2026-08-27: none,
  provided the deep-module argument still holds. The cost is borne
  by the reviewer at that date.

## Rejected alternatives

1. **"Split per HTTP method into separate route files."** —
   Rejected: ten handlers × shared `TerminalRoutesDeps` bundle =
   either ten duplications of plumbing (mechanical) or extracting
   the bundle into a shared module that all the route files
   import (the failure mode ADR-101 calls out as "moving complexity
   outward").
2. **"Extract the WS upgrade handler into its own file."** —
   Acceptable in principle as a future iterate; explicitly listed
   in the retirement plan above. NOT done in this iterate because
   the triggering edit was net-zero LOC and the WS handler split
   is a separate scope that warrants its own RED→GREEN test cycle.
3. **"Leave it at `state=grandfathered` and never write the ADR."**
   — Rejected: the Stop-hook iron law correctly flags the touch
   as a ratchet. Anonymous TODO entries accumulate review debt
   for future maintainers who have to re-derive the deep-module
   argument from scratch. Naming the decision is the entire point.
4. **"Revert the prewarm-race fix to avoid touching routes.ts."**
   — Rejected: the prewarm-race fix is a real production bug
   affecting real users (memory
   `feedback_e2e_wait_for_first_ws_ready_before_click`). Trading
   the fix to dodge an exception ADR would be the opposite of
   the bloat policy's intent.

---

## External Sources Acknowledged

This ADR's YAGNI Check + Chesterton-Fence Check headings + the
Ousterhout-deep-module framing are adapted verbatim from ADR-101
(`server/src/terminal/pty-manager.ts` bloat exception, filed under
Campaign C / C8). The wider Ousterhout / YAGNI / Chesterton-Fence /
Re-Review-Date / Incident-Reference template is mandated by
`shipwright/shared/glossary.md` (Campaign A.defense, MIT).
