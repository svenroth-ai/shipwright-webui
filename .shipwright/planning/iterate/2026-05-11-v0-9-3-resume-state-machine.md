# Iterate Spec: v0.9.3-resume-state-machine

- **Run ID:** iterate-2026-05-11-v0-9-3-resume-state-machine
- **Type:** bug
- **Complexity:** medium
- **Status:** draft
- **ADR slot:** ADR-085

## Goal

Close a state-machine bug surfaced post-v0.9.2: Resume click on a `new-plain` task in `idle` state never settles on `active` — state ping-pongs idle ↔ active every transcript-poll cycle, the Resume button stays visible, and every additional click injects the launch command into the running pty (53× accumulated copies in disk-scrollback for the reported task `31b4076d-...`).

## Acceptance Criteria

### AC-1 — new-plain idle → active transition is durable when pty is alive

- [ ] Given a `new-plain` task in `state="idle"` AND a live pty entry (i.e. claude is running in the embedded terminal), when the transcript-poll fires (regardless of JSONL mtime), then the state-machine MUST NOT decay to `idle` based on `now - mtime > ACTIVE_IDLE_THRESHOLD_MS`. The pty existence is the authoritative signal — JSONL mtime is meaningless for new-plain (Claude doesn't write to it until the user types).
- [ ] Given a `new-plain` task in `state="active"` AND the pty entry has been removed (kill or exit), when the next transcript-poll fires with `result.status === "missing"`, then the existing v0.8.7 AC-1 path at `external/routes.ts:889` still correctly transitions `active → idle`. This iterate adds no rule to that path.
- [ ] Given a non-`new-plain` task (slash-command launch, fork, adopted brownfield), when the transcript-poll fires with `now - mtime > ACTIVE_IDLE_THRESHOLD_MS`, then the existing JSONL-mtime-driven `active → idle` decay still fires. The new rule is scoped strictly to `actionId === "new-plain"`.

### AC-2 — Resume click on idle new-plain converges to active within one transcript-poll cycle

- [ ] Given a `new-plain` task in `state="idle"` with the existing pty alive, when the user clicks Resume, then within at most TWO transcript-poll cycles (~2 seconds at 1s polling) the client-side state badge reads `Active` and the Resume button is no longer rendered. (The first poll moves `awaiting_external_start → active` via the existing path at line 916-919; the AC-1 fix prevents the immediate decay back to idle.)

### AC-3 — Real-browser F0.5 regression spec replaces the diagnostic debug spec

- [ ] A new Playwright spec at `client/e2e/flows/v0-9-3-resume-state-machine.spec.ts` runs against the live Tailscale dev stack via `playwright.tailscale.config.ts` (extended testMatch list). It asserts both AC-1 (state stays active across multiple poll cycles after Resume) and AC-2 (state badge reads Active + Resume button hidden within 2.5s).
- [ ] The diagnostic spec `client/e2e/flows/_v092-debug-resume-state.spec.ts` is DELETED at finalization.

## Affected FRs

- **FR-01.28** (Embedded terminal — pty + WebSocket bidi + disk-backed scrollback): one new acceptance criterion appended for AC-1. The existing v0.8.5 AC-4 + v0.8.7 AC-1 ACs are unchanged.

## Out of Scope

- Retroactive cleanup of the existing 53× accumulated launch-command echoes in disk-scrollback — user can manually invoke "Clear terminal history" from the overflow menu. AC-1 prevents FUTURE accumulation.
- Client-side Resume button debounce while a launch is in flight — defer to a follow-up iterate if multi-click races re-emerge.
- Modifying the `/api/external/tasks/:id/launch` endpoint to skip the awaiting → active dance for new-plain (set state="active" directly) — purely a UX polish; the AC-1 fix is sufficient to make the visible state correct after ~1 transcript-poll.

## Design Notes

- No UI change. Pure server-side state-machine fix.
- The fix introduces an `actionId`-conditional inside the existing transcript-poll branch — the smallest possible surgery that closes the bug.

## Affected Boundaries

The diff touches server-side state-machine logic + tests. No new serialized format. `touches_io_boundary` does NOT fire.

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| n/a | n/a | n/a |

## Confidence Calibration

(Filled before F0 Fresh Verification Gate — mandatory at medium+.)

- **Boundaries touched:** none new.
- **Empirical probes run:**
  - **P1 (debug spec capture against live stack):** `_v092-debug-resume-state.spec.ts` captured task state before/after Resume click + WS frames + xterm snapshot. Found: state stays "idle" before+after click despite `launchedAt` updating (server SAW the launch); `launchCmdCount=53` in xterm buffer (53× accumulated launch echo lines).
  - **P2 (server-side code read):** confirmed `/launch` sets state="awaiting_external_start" unconditionally (line 503); transcript-poll line 916-919 flips `awaiting → active` when JSONL exists; transcript-poll line 925-926 unconditionally decays `active → idle` when `now - mtime > 120s` — for new-plain that doesn't write JSONL, this fires on every poll after first launch, so state ping-pongs every 1-2 seconds.
  - **P3 (existing v0.8.5 AC-4 / v0.8.7 AC-1 ACs read):** confirmed v0.8.5 AC-4 only fires once per WS-onOpen (not on Resume click, since WS is already open); v0.8.7 AC-1 only fires in result="missing" branch (not result="ok" where this bug lives).
- **Edge cases NOT probed + why acceptable:**
  - Concurrent multi-tab Resume clicks — out of scope; the existing proper-lockfile contract on `sdk-sessions.json` serializes writes.
  - Non-`new-plain` actionIds (`new-task`, `new-iterate`, `new-pipeline`, slash-command launches) — AC-1 explicitly preserves existing behavior for these. Server unit tests cover both branches.
- **Confidence-pattern check:** none — root-cause traced through code + empirical evidence converge cleanly.

## Verification (medium+)

- **Surface:** web
- **Runner command:** `cd client && npx playwright test e2e/flows/v0-9-3-resume-state-machine.spec.ts --config=playwright.tailscale.config.ts --reporter=list`
- **Evidence path:** `.shipwright/runs/iterate-2026-05-11-v0-9-3-resume-state-machine/surface_verification.json`
