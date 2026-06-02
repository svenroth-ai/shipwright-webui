# Iterate: Terminal idle-ceiling attachment-gating (data-loss fix)

- **Run ID:** iterate-2026-06-02-terminal-idle-attachment-gate
- **Intent:** BUG (data-loss) + hardening — Path C
- **Complexity:** medium (override of classifier `small`)
- **Date:** 2026-06-02
- **Spec Impact:** MODIFY (terminal pty lifecycle) + ADD (idle-reaper module, resume-safety banner copy)

## Problem (root cause — established forensically)

A webui-terminal Claude session left idle at an interactive prompt (e.g.
AskUserQuestion) over a remote/mobile connection lost its finished,
un-persisted final turn on `claude --resume`.

**Evidence (session 42feb775, task 560c99f6, 2026-06-02):**
- `pty-manager.ts` 30-min idle ceiling (`idleTimeoutMs ?? 1_800_000`, the
  "orphan GC", `touchIdle` at pty-onData :433 / write :540 / spawn) resets
  ONLY on pty I/O. It ignores whether any WS client is attached.
- While Claude waits at an interactive menu there is zero pty I/O for 30 min
  → ceiling fires `entry.pty.kill()` (:1082-1093) → `──── shell stopped at
  HH:MM:SS ────` marker. Timing proof: last screen output + exactly 30:00 =
  kill time (05:54:30 UTC).
- The finished turn (proposal + AskUserQuestion) lived only in the running
  Claude process's memory, never in the session JSONL. `claude --resume`
  rebuilds state ONLY from the JSONL (webui = read-only observer), which
  ended at the last completed step (a mid-research Glob `tool_result`) →
  the work was lost.
- Recoverable only from the webui scrollback `.log` (displayed bytes,
  independent of JSONL).

WS heartbeat liveness (`ws-heartbeat.ts`, shipped 2026-05-31) was already
live at incident time and freed the writer slot on disconnect — but the
idle ceiling is **independent** of the writer-slot/heartbeat machinery, so
the waiting Claude was still reaped. The idle ceiling is the missing fix.

## Scope (FULL = A + B + C)

### Part A — Idle-ceiling gated on client-attachment (the core fix)
The orphan-GC must only reap a pty that is genuinely orphaned: **idle AND
no WS client attached**. Today it reaps on I/O-silence regardless of
attachment.

- Extract the idle-reaping concern into a new cohesive neutral module
  `server/src/terminal/idle-reaper.ts` (mirrors the ADR-101/103-sanctioned
  shape of `ws-heartbeat.ts` / `terminal-reset.ts`): pure, timer/now-seam
  injectable, unit-testable. This also REDUCES `pty-manager.ts` LOC
  (currently at the ADR-101 bloat ceiling, 1219), avoiding a ratchet.
- Gating rule: the idle timer is **armed only when `attachCount === 0`**.
  First attach → disarm (a watching client is never an orphan, however long
  Claude waits). Last detach (`attachCount → 0`) → arm the grace. pty I/O
  while detached still resets the grace (an actively-producing pty isn't an
  orphan).
- **NOT gated on "Claude alive in pty"** — Claude process-liveness is
  un-observable from the webui (4 signals falsified; Resume-gate removed in
  PR #29 / memory `project_altscreenactive_is_claude_foreground`).
  Attachment is the only reliable signal.
- Raise the detached-grace default 30 min → **12 h** (`config.ts`
  `terminalIdleTimeoutMs` default 1_800_000 → 43_200_000); stays
  overridable via `SHIPWRIGHT_TERMINAL_IDLE_TIMEOUT_MS`. With attachment
  gating, the value only governs genuinely-disconnected sessions; the
  single-user-local asymmetry (a lingering pty is cheap; reaping wanted work
  is costly) justifies a generous default.

### Part B — WS ping/pong liveness (ALREADY DONE — integration guard only)
`ws-heartbeat.ts` already terminates a half-open/dead socket within ~30-45 s
→ `onClose` → `detachAndCount` → `attachCount → 0`, which (with Part A) arms
the idle grace. No new production code. Add ONE integration test proving the
A↔B composition: a terminated dead socket detaches and arms the grace; a
live (ponging) socket keeps it disarmed indefinitely.

### Part C — Resume-safety UX backstop (extend ADR-104 banner)
When a fresh pty replaced a lost session (`terminalReset === true`,
ADR-104), the EmbeddedTerminal already shows a dismissable banner. Extend
its copy so the user is warned that on-screen content from before the
suspension may not have been restored into the resumed Claude session
(resume rebuilds from JSONL only). Surface that scrollback history exists
(`scrollbackBytes > 0`) as the recovery pointer. (A full raw-scrollback
"view last screen" viewer is a larger follow-up — see Open Question 2.)

## Acceptance Criteria

- **AC1** Given a live pty with ≥1 attached WS client, when no pty I/O
  occurs for longer than `idleTimeoutMs`, then the pty is NOT reaped (no
  `shell stopped` marker). *(regression guard for the exact bug)*
- **AC2** Given a live pty, when the last WS client detaches
  (`attachCount → 0`), then the idle grace arms; after `idleTimeoutMs` of
  no I/O and no re-attach the pty is reaped (one `shell stopped` marker).
- **AC3** Given an armed idle grace (detached), when a client re-attaches
  before the grace elapses, then the grace is disarmed and the pty survives.
- **AC4** `config.terminalIdleTimeoutMs` defaults to 43_200_000 (12 h) and
  honours `SHIPWRIGHT_TERMINAL_IDLE_TIMEOUT_MS` (clamped positive int).
- **AC5** (B-composition) Given a heartbeat-terminated dead socket, when its
  `onClose` runs, then `attachCount → 0` and the idle grace arms (the
  half-open / OS-sleep / Tailscale path the incident hit).
- **AC6** (C) Given `terminalReset === true` AND `scrollbackBytes > 0`, the
  reset banner includes the data-loss-aware warning + scrollback pointer;
  given `terminalReset === false`, no such warning renders.
- **AC7** `pty-manager.ts` line count does NOT ratchet its ADR-101 baseline
  (net ≤ 0 after the idle-reaper extraction).

## Affected Boundaries
- `server/src/terminal/pty-manager.ts` (idle timer lifecycle — MODIFY, net ≤0)
- `server/src/terminal/idle-reaper.ts` (NEW cohesive module)
- `server/src/config.ts` (`terminalIdleTimeoutMs` default — io_boundary env)
- `client/src/components/terminal/EmbeddedTerminal.tsx` (reset-banner copy)
- (read-only dependency, unchanged) `server/src/terminal/ws-heartbeat.ts`,
  `ws-upgrade-handler.ts`

## Confidence Calibration
- **Boundaries touched:** pty idle-timer lifecycle; env/config io_boundary;
  reset-banner client copy.
- **Empirical probes run:**
  - `idle-reaper.test.ts` (8) — armed iff attachCount 0; reaps after timeout;
    re-attach before expiry disarms; re-touch resets; cancel; per-task
    independence; 12h default const. Deterministic manual scheduler.
  - `pty-manager.idle-attachment.test.ts` (4) — real PtyManager: attached
    pty survives 5× the ceiling (AC1); detached reaped (AC2); re-attach
    saves (AC3); actively-producing detached pty not reaped.
  - `idle-heartbeat-composition.test.ts` (1, AC5) — real ws-heartbeat +
    real detach: attached-but-dying socket survives until heartbeat reaps
    it, THEN grace arms + reaps (the exact incident path).
  - `config.test.ts` (+2, AC4) — default 43_200_000; env override parsed.
  - `TerminalBanners.test.tsx` (4, AC6) — data-loss note iff reset shown &&
    scrollbackBytes > 0; absent for 0/null/no-reset.
  - Full suites green: server 1379 / client 1381; tsc server+client EXIT 0;
    changed files oxlint-clean. pty-manager.ts 1217 ≤ 1219 baseline (AC7).
- **Test Completeness Ledger:**
  | Behavior (AC) | Disposition | Evidence |
  |---|---|---|
  | AC1 attached → not reaped | tested | idle-attachment AC1; idle-reaper AC1 |
  | AC2 detached → reaped | tested | idle-attachment AC2; idle-reaper AC2 |
  | AC3 re-attach disarms | tested | idle-attachment AC3; idle-reaper AC3 |
  | AC4 config 12h default + env | tested | config.test.ts (+2) |
  | AC5 heartbeat→detach→arm | tested | idle-heartbeat-composition |
  | AC6 banner data-loss note | tested | TerminalBanners.test.tsx (4) |
  | AC7 no pty-manager ratchet | tested | wc -l 1217 ≤ 1219; anti-ratchet hook |
  | Browser-rendered banner in a real reset | untestable (`requires-interactive-tty`) | reset needs a real pty kill+re-attach across a server restart; the conditional render is fully covered by the component test |
  - 0 testable-but-untested behaviors.
- **Confidence-pattern check:** depth — the reaper is tested at the pure-unit
  layer AND wired-into-PtyManager layer AND composed-with-heartbeat layer (no
  single-asymptote reliance). breadth — both gate directions (arm/disarm),
  the timer-reset path, the config boundary, and the UI note are each
  covered; the only gap (full browser reset E2E) is justified untestable.

## Open Questions (for approval gate)
1. Confirm 12 h detached-grace default (vs 4 h / keep 30 min + env-only).
2. Part C depth: warning-banner-only now (recommended), or also include a
   raw-scrollback "view last screen" viewer in THIS iterate (bigger; needs a
   new read endpoint)?
