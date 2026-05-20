# Iterate Spec: terminal-smear-reset

- **Run ID:** iterate-20260515-terminal-smear-reset
- **Type:** bug
- **Complexity:** medium
- **Status:** draft
- **Branch:** iterate/fix-terminal-smear-reset (worktree `.worktrees/terminal-smear-reset`, off main)
- **Session role:** secondary (parallel sessions active — no direct push to main; deliver via PR)

## Goal

Fix two embedded-terminal defects surfaced by real-browser UAT and a
three-task scrollback/JSONL investigation:

1. **Bug B — remount smear.** Navigating back to a task during active
   Claude streaming produces heavy left-side smearing/flicker. Root cause
   (codex:codex-rescue): the ADR-099-v10 `setTimeout(0)` maintenance pass
   fires *before* `term.write()` finishes parsing the ~100 KiB
   `replay_snapshot`, so `clearTextureAtlas()` races the in-flight async
   write. Every ADR-099 patch up to v10 chased a symptom; the real cause
   is "maintenance always raced the async write."

2. **Freeze recovery is silent.** When the webui server restarts (dev runs
   under `tsx watch`; saving any `server/src/**` file — including from the
   webui's own embedded-terminal Claude tasks — restarts it; on Windows
   the restart hard-kills the process so `SIGTERM`/`killAll()` never runs,
   confirmed by 0 `shell stopped` markers across 9–15 pty respawns), every
   embedded pty dies and a fresh PowerShell is spawned on reconnect. The
   user is left staring at a bare `PS>` prompt with no indication that
   Claude was interrupted — they type into a dead terminal ("noch da?"
   with no answer, seen in all 3 investigated transcripts).

   The restart-storm itself is operational (run the server without
   `tsx watch` during multi-task sessions) and out of scope for code. The
   in-scope code fix is **resilience**: detect the fresh-pty-after-prior-
   session condition and surface a clear "terminal was reset" banner so
   the user knows to click Resume.

## Acceptance Criteria

- [ ] **AC-1 (Bug B):** `onReplaySnapshot` writes the snapshot via
  `term.write(data, callback)`; the post-write maintenance pass
  (`scrollToBottom` + atlas maintenance) runs only inside that completion
  callback, never via a `setTimeout(0)` that races the parse.
- [ ] **AC-2 (Bug B):** while a snapshot write is in flight, the
  `onWriteParsed` burst-trigger does NOT call `safeAtlasMaintenance()` —
  it only advances `writesSinceLastClear` / `lastWriteTime` and returns.
  Verified by a component test asserting maintenance is not invoked during
  the in-flight window and runs exactly once on completion.
- [ ] **AC-3 (Bug B robustness):** if `term.write` throws synchronously,
  the in-flight flag is cleared so atlas maintenance is not permanently
  suppressed.
- [ ] **AC-4 (reset banner — server):** the terminal WS `ready` envelope
  carries a boolean `terminalReset`, true exactly when this WS attach
  freshly created the pty (`ptyManager.get` was undefined immediately
  before `spawn`) AND the task has `firstJsonlObservedAt` set (Claude ran
  here before). False on first-ever launch and on re-attach to a live pty.
- [ ] **AC-5 (reset banner — client):** `useTerminalSocket` parses
  `terminalReset` from the `ready` envelope and exposes it; defaults to
  `false` when the field is absent (back-compat with an old server).
- [ ] **AC-6 (reset banner — UI):** `EmbeddedTerminal` renders a warning
  banner ("Terminal wurde zurückgesetzt … Claude unterbrochen — Resume
  klicken") when `socket.terminalReset === true`, no launch is pending,
  and the banner has not been dismissed. The banner hides once a launch is
  dispatched (`pendingLaunch` set) or the user dismisses it.
- [ ] **AC-7:** no regression — full unit suite + typecheck green; the
  ADR-092 live-replay E2E guard still passes.

## Affected FRs

- Embedded terminal FR (FR covering the xterm.js terminal pane / ADR-067 /
  ADR-068-A1 / ADR-087). Extend with `(E)` acceptance-criteria lines for
  the `replay_snapshot` write-completion contract and the `terminalReset`
  ready-envelope field. Exact FR id resolved against
  `.shipwright/planning/01-adopted/spec.md` during build.

## Out of Scope

- The `tsx watch` restart storm itself — operational, not a code bug.
  Delivered as guidance (run the server as `node dist/index.js`, no watch,
  during multi-task sessions), not code.
- Keeping a pty alive across a server-process restart — impossible
  (node-pty children die with the parent).
- The Resume-CTA gate / JSONL-signal logic — owned by the in-flight
  `iterate/resume-cta-jsonl-signal` branch; this iterate must not touch
  `resumeCtaGate.ts`, `TaskCard.tsx`, `TaskDetailHeader.tsx`,
  `session-watcher.ts`, or `external/routes.ts` to avoid a merge conflict.
- Hardening the auto-execute WS data-frame path — the launch command shape
  is already correct (`claude --resume` for new-iterate tasks with JSONL).

## Design Notes

UI: one new conditional header-strip banner in `EmbeddedTerminal`, styled
like the existing read-only banner (amber/warning tokens, `-mx-2 -mt-2 mb-2`
header strip). 4th banner in the precedence stack; mutually exclusive with
the `previewCommand` banner by construction (`!pendingLaunch` gate).
No new design tokens — reuses `--color-warning*`.

## Affected Boundaries

The terminal WS `ready` envelope is a producer/consumer contract, not a
file-based IO boundary — no `touches_io_boundary` file pattern matches.

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| `server/src/terminal/routes.ts` (ready envelope) | `client/src/hooks/useTerminalSocket.ts` | WS JSON envelope |

The new `terminalReset` field is additive + optional; an old client
ignores it, an old server omits it (client defaults `false`). Covered by
the server route test + the hook parse test (AC-4 / AC-5).

## Confidence Calibration

- **Boundaries touched:** the terminal WS `ready` envelope (producer
  `routes.ts` `deriveTerminalReset` + envelope literal; consumer
  `useTerminalSocket.ts` parser). Not a file-based IO boundary.
- **Empirical probes run:**
  - AC-2 RED→GREEN round-trip: the component test defers the snapshot
    `term.write` callback to hold the parse "in flight", fires
    `onWriteParsed` 5× during that window, and asserts
    `clearTextureAtlas` is NOT called; then the completion callback
    fires it exactly once. RED confirmed without the guard (7 client
    failures); GREEN with it (33/33). This is a deterministic
    reproduction of the ADR-099 maintenance-vs-async-write race.
  - AC-3: a synchronous `term.write` throw → the catch clears
    `replaySnapshotInFlightRef` → a later `onWriteParsed` still runs
    maintenance (the flag did not get stuck `true`).
  - `deriveTerminalReset` truth table — fresh+JSONL→true,
    fresh+{undefined,null,""}→false, live-pty re-attach→false.
  - `terminalReset` envelope back-compat — hook test with the field
    present (`true`) and absent (defaults `false`).
  - Full regression: server 1021/1021, client 864/864, `tsc --noEmit`
    clean on both workspaces.
- **Edge cases NOT probed + why acceptable:**
  - The actual GPU texture-atlas visual smear — no automated probe is
    possible (transient WebGL render artifact). The user explicitly
    scoped Bug B's confirmation as a manual A/B UAT in the iterate
    request; that remains the verification for the visual outcome.
  - Live-stack real-browser E2E — deferred: an isolated worktree stack
    collides with the user's active parallel sessions on the shared
    `~/.shipwright-webui` registry (`registryDir` is not env-overridable).
    The component tests render the real `EmbeddedTerminal` against a
    real DOM with real WS envelopes — the closest faithful automated
    surface without disrupting the running environment.
- **Confidence-pattern check:** no "are you confident?" yes-then-finding
  pattern fired in this run. The codex:codex-rescue root cause was itself
  empirically grounded (3 real-browser probes falsified the WebGL-leak
  hypothesis before landing on the async-write race).

## Verification (medium+)

- **Surface:** web
- **Runner command:** `npx vitest run` (server 1021 + client 864) +
  `npx tsc --noEmit` (both workspaces). Component layer renders the real
  `EmbeddedTerminal` against a real DOM with real WS envelopes.
- **Evidence path:** vitest run logs (F0 gate output).
- **Live-stack E2E note:** deferred — see Confidence Calibration. Bug B's
  visual smear is a transient GPU artifact verified by the user's manual
  A/B UAT (per the user's own scoping of the iterate); the reset banner
  is faithfully covered by the `EmbeddedTerminal` component test.
