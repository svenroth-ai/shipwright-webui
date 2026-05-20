---
iterate: J-restore-no-flicker-default
campaign: headless-terminal-refactor
type: fix
complexity: small
risk_flags: []
date: 2026-05-13
adr: ADR-098
supersedes_default_from: ADR-097
restores_default_from: ADR-095
---

# Iterate J — Restore `CLAUDE_CODE_NO_FLICKER` default to opt-out

## Context

Iterate I (ADR-097) flipped the `CLAUDE_CODE_NO_FLICKER` env-injection
default from **ON** (opt-out via `SHIPWRIGHT_TERMINAL_NO_FLICKER=0`,
ADR-095 / Iterate G) to **OFF** (opt-in via
`SHIPWRIGHT_TERMINAL_NO_FLICKER=1`). The justification rested on a
single hypothesis: xterm.js 6.0.0 honours **DECSET 2026 / Synchronized
Output** natively, so the Claude TUI's per-frame ANSI cursor moves
would arrive batched in the main buffer and the alt-screen workaround
would no longer be needed for flicker-free rendering.

UAT post-merge (Iterate I) **falsified the hypothesis**: with
`CLAUDE_CODE_NO_FLICKER=1` unset, the cursor flicker around the
animated "working… (Esc to interrupt)" label returns verbatim — same
visual symptom as the pre-Iterate-G baseline.

### Empirical evidence

A direct read of the live Claude TUI scrollback file confirmed the
root cause: **Claude Code 2.1.139 emits zero `\x1b[?2026h` and zero
`\x1b[?2026l` sequences in its main-buffer rendering.** Probe (run
against `<homedir>/.shipwright-webui/terminal-scrollback/5a5832a3-…-202b90a7f270.log`,
a real 265 711-byte capture of a working Claude session):

```
size=265711, decset_2026_enter=0, decset_2026_leave=0, cup_sequences=21690
```

A 265 KB live Claude TUI scrollback contains **21 690 raw cursor-
positioning sequences** (`\x1b[…H` / `\x1b[…;…H`) but **zero
Synchronized-Output bracket pairs.** xterm 6.0's DECSET 2026 honour is
real (the renderer batches frames when wrapped) — but Claude Code does
not wrap its frames, so there is nothing for xterm 6 to batch.

Confirmation upstream: Claude Code Issue **#37283** ("TUI flickers /
cursor jumps in tmux during streaming output (missing DECSET 2026
synchronized output)") remains **open** at the time of this iterate.
The xterm 5 → 6 upgrade was correct, but the inference "xterm 6
implements DECSET 2026 → flicker is fixed by xterm 6 alone" was
unfounded because the producer side never opted in.

### Iterate G's workaround restored

`CLAUDE_CODE_NO_FLICKER=1` instructs Claude Code to render into the
**alt-screen buffer** (vim/htop-style fullscreen mode) — bypassing
per-frame cursor moves entirely. Anthropic ships this as the official
flicker workaround:
[`https://code.claude.com/docs/en/fullscreen`](https://code.claude.com/docs/en/fullscreen).
Required Claude Code ≥ v2.1.89 (we run 2.1.139).

The alt-screen path carries a real UX cost (browser-native Cmd+F
search of the conversation history, mouse capture, fixed input box)
that Iterate I tried to recover by reverting the default. With the
empirical proof that the recovery yields the original flicker
regression, the trade-off swings back: visible flicker degrades every
streaming response, whereas the lost Cmd+F is a recoverable
inconvenience (xterm's own scrollback + Strg+Shift+F via xterm
search-addon both remain available; the disclosure banner already
documents the retention path).

### Net effect

ADR-097's revert of ADR-095's default IS itself REVERTED. ADR-095's
default-on stance is restored. **Everything else from Iterate I stays
intact** — xterm 6 upgrade, `@xterm/headless` 6.0.0, snapshot envelope
v2, `windowsMode` removal, Iterate H 60 % preservation heuristic,
Iterate G `buildSpawnEnv` helper structure, opt-out-wins-over-caller
semantics. Only the default-injection flag flips back.

## Goal

1. Restore `terminalNoFlicker` default to **true** (opt-out via
   `SHIPWRIGHT_TERMINAL_NO_FLICKER=0`).
2. Restore `buildSpawnEnv` to inject `CLAUDE_CODE_NO_FLICKER=1`
   unconditionally unless explicit opt-out.
3. Re-baseline `pty-env-flicker.test.ts` for default-on semantics
   (preserves opt-out-wins-over-caller regression fence from Iterate G).
4. Revert `.env.example` documentation block (Iterate I left it
   documenting default-on already — see check below; if so, no change
   needed).
5. Amend CLAUDE.md DO-NOT regression guard #22 to mark the NO_FLICKER
   default-OFF clause as **SUPERSEDED by ADR-098** (default-on restored).
6. Write **ADR-098** in `.shipwright/agent_docs/decision_log.md` with
   the empirical evidence above.

## Non-Goals

- **Do not touch xterm 6 / `@xterm/headless` / snapshot envelope v2 /
  Iterate H 60 % heuristic / `windowsMode` removal / `buildSpawnEnv`
  helper structure / opt-out-wins-over-caller semantics.** Pure
  config-flag revert.
- Do not add a new test for the byte-stream pattern (zero DECSET 2026
  in a real Claude scrollback fixture). The probe lived in the
  investigation; codifying it in CI would require shipping a real
  Claude TUI scrollback fixture, which carries privacy risk and
  contaminates the iterate's "smallest diff" discipline. The
  empirical claim lives in ADR-098 instead.
- Do not change Iterate G's `liveSession` Resume-button gating
  (orthogonal; still correct).

## Scope

### Modify

- **`server/src/config.ts`** — `terminalNoFlicker` field default:
  flip from `=== "1"` (opt-in) back to `!== "0"` (opt-out). Inline
  comment is rewritten to reference ADR-098 + the empirical scrollback
  finding (zero DECSET 2026 in Claude 2.1.139), with ADR-095 cross-
  reference for the original stance and ADR-097 cross-reference noted
  as the rejected interim path.

- **`server/src/terminal/routes.ts`** — `buildSpawnEnv` helper:
  - The default branch INJECTS `CLAUDE_CODE_NO_FLICKER=1`.
  - The opt-out branch (`SHIPWRIGHT_TERMINAL_NO_FLICKER === "0"`)
    DELETES the key from the env map.
  - Caller-env override: opt-out wins over caller (preserves
    Iterate G's external-review fix verbatim — symmetric to the
    Iterate I opt-in-wins shape it's replacing).
  - Inline doc comment rewritten to mirror ADR-098.

- **`server/src/terminal/pty-env-flicker.test.ts`** — full re-baseline:
  - Default behaviour case: `CLAUDE_CODE_NO_FLICKER` IS set to `"1"`.
  - Explicit `SHIPWRIGHT_TERMINAL_NO_FLICKER=""` case: still default-on.
  - Explicit `SHIPWRIGHT_TERMINAL_NO_FLICKER="0"` case: key omitted
    (opt-out).
  - Non-canonical value (`"true"` etc.) → still default-on (only
    literal `"0"` disables; mirrors `terminalHeadlessMirror` semantics).
  - Caller-supplied `CLAUDE_CODE_NO_FLICKER` (when default is on): the
    helper's `"1"` wins; this is the symmetric Iterate G regression
    fence.
  - Opt-out + caller-supplied `CLAUDE_CODE_NO_FLICKER`: opt-out wins;
    the user-set env override is dropped. The Iterate G
    opt-out-wins-over-caller-override fence is preserved verbatim.
  - Test escape hatch: opt-in flag explicit + caller env explicit →
    caller wins for the symmetric "explicit-test-value" use case.

- **`.env.example`** — verify docs read default-on; if the I revert
  left the docs untouched (they document default-on already), no
  change. If the docs read default-off, revert.

- **`CLAUDE.md` DO-NOT regression guard #22** — amend the
  `CLAUDE_CODE_NO_FLICKER` clause:
  > **`CLAUDE_CODE_NO_FLICKER` default is ON** (opt-out via the
  > literal `SHIPWRIGHT_TERMINAL_NO_FLICKER=0` only; empty / unset /
  > `1` / any other value → key injected as `"1"`). Iterate J
  > (ADR-098) restored the ADR-095 default after empirical verification
  > that Claude Code 2.1.139 emits zero DECSET 2026 sequences in its
  > main-buffer rendering — xterm 6.0's native Synchronized-Output
  > support has nothing to batch; the alt-screen path remains the only
  > working flicker fix. DO NOT revert to default OFF without
  > empirical evidence that Claude Code emits DECSET 2026 in the main
  > buffer (Issue #37283 — currently open). Reverts based on
  > theoretical xterm-side honour alone are insufficient.

- **`.shipwright/agent_docs/decision_log.md`** — append **ADR-097**
  (back-fill — Iterate I's commit landed without the decision-log
  entry per my read of the log file) **and** **ADR-098** (this
  iterate's revert).

  *Note:* the I commit `d96fa9b` referenced ADR-097 but the file ends
  at ADR-096 in the current main. Whether the ADR-097 entry was
  intended to land in a follow-on commit that was elided, or was
  forgotten, the right cleanup here is to author both entries: ADR-097
  as a short retrospective ("flipped default OFF; rationale + UAT
  outcome documented in ADR-098"), and ADR-098 with the full empirical
  argument. This keeps the decision log consistent with CLAUDE.md
  DO-NOT guard #22 which references ADR-097.

- **`CHANGELOG.md`** — append a `### Fixed` bullet in `[Unreleased]`:

  > **Restore `CLAUDE_CODE_NO_FLICKER=1` default** (ADR-098 — campaign
  > `headless-terminal-refactor`, Iterate J). Closes the UAT-confirmed
  > flicker regression that returned after Iterate I (ADR-097) flipped
  > the default to opt-in on the theoretical assumption that xterm.js
  > 6.0's native DECSET 2026 honour would batch Claude's main-buffer
  > frames. Empirical investigation of a 265 711-byte live Claude TUI
  > scrollback confirmed Claude Code 2.1.139 emits **zero** DECSET 2026
  > sequences in main-buffer rendering (21 690 raw CUP sequences but
  > 0 sync-output bracket pairs), so xterm 6 has nothing to batch and
  > the Iterate G alt-screen workaround is restored as the only
  > working solution. References Claude Code Issue #37283 (open). All
  > other Iterate I changes (xterm 6 upgrade, snapshot envelope v2,
  > `@xterm/headless` 6.0.0, Iterate H heuristic, `buildSpawnEnv`
  > helper structure) are retained — only the env-injection default
  > flag flips back.

## Acceptance Criteria

- [ ] `config.ts:terminalNoFlicker` default = `true` again (opt-out
      via `SHIPWRIGHT_TERMINAL_NO_FLICKER === "0"`).
- [ ] `buildSpawnEnv` injects `CLAUDE_CODE_NO_FLICKER="1"` in spawn
      env on the default-on path.
- [ ] All eight existing `pty-env-flicker.test.ts` cases adapted; the
      opt-out-vs-caller-override regression fence is preserved verbatim
      (only the wrapping intent flips from "opt-out wins" to "opt-out
      wins"; the Iterate G semantic is restored, not lost).
- [ ] `CLAUDE.md` DO-NOT regression guard #22 NO_FLICKER clause amended
      per ADR-098 supersession.
- [ ] ADR-098 written with empirical evidence block, cross-references
      to ADR-095 + ADR-097, Issue #37283 reference, and the explicit
      alt-screen trade-off list (no Cmd+F of conversation, mouse
      capture, fixed input box).
- [ ] ADR-097 back-fill entry written (short — full rationale lives
      in ADR-098).
- [ ] `.env.example` documents default-on (verify; revert if Iterate
      I touched it).
- [ ] CHANGELOG bullet appended to `[Unreleased] → Fixed`.
- [ ] Server build green (`npm run build` from `server/`).
- [ ] Server tests green (936 baseline post-I).
- [ ] Client build green.
- [ ] Client tests green (784 baseline).

## Type / Complexity / Risk

- **type:** `fix` (closes user-reported UAT flicker regression after
  Iterate I).
- **complexity:** `small` (config-flag revert; ≈ 20 LOC of source
  changes + test re-baseline + docs).
- **risk flags:** NONE (env-string flip; no serialized-format change;
  no new I/O path; no new dependency; idempotent).

## F0.5 Surface

`cli` — justification: this is a config-only revert (one boolean flip
+ inverted env-key delete/set). The visual flicker confirmation is
**deferred to user UAT post-merge** (Vite HMR + pty respawn picks up
the env change automatically once the user reopens a terminal pane).
A focused `vitest run pty-env-flicker.test.ts` verifies the
default-on / opt-out / caller-override matrix at the unit level. The
empirical evidence (zero DECSET 2026 in Claude 2.1.139 scrollback)
lives in ADR-098 — codifying it in CI would require shipping a real
Claude TUI scrollback fixture (privacy risk + diff bloat).

## External Plan Review

**SKIPPED** per runner-contract gate — complexity `small`, no
canonical risk flag set. The change is a single-line default flip in
two files plus a deterministic test re-baseline; there is no plan
surface to review external against. Status:
`skipped_complexity_below_threshold`.

## External Code Review Cascade

**SKIPPED** per runner-contract gate — complexity `small`, no risk
flag, expected diff < 100 LOC. Self-Review (Step 3.6) is the sole
review. Status: `skipped_diff_below_threshold`.

## Confidence Calibration

**SKIPPED** per runner-contract gate — complexity `small`, no
`touches_io_boundary` flag. The env-injection path is single-direction
(server → pty child env); there is no producer/consumer round-trip to
probe. The empirical anchor for the change is the 265 KB live Claude
TUI scrollback analysis recorded in ADR-098. Status:
`skipped_complexity_and_no_io_boundary`.

## Rejected Alternatives

1. **Iterate I'-style: keep default-off, add a per-task opt-in toggle
   in the EmbeddedTerminal UI.** Rejected: surfaces an architectural
   choice to the end user that they cannot meaningfully evaluate, and
   defers the right behaviour ("flicker-free out of the box") to a
   manual click that most users will never find. Until Claude Code
   ships DECSET 2026, default-on is the right answer.

2. **Add a DECSET 2026 sniff in `pty-manager.onData` and auto-toggle
   the env var per session.** Rejected: env vars are set at spawn
   time and cannot be changed mid-process for a running Claude
   instance; the alt-screen mode decision is committed at Claude
   Code startup. Also: the sniff would itself need the same empirical
   anchor we already have, providing no additional confidence over
   the simpler default flip.

3. **Defer to a future Claude Code release that emits DECSET 2026.**
   Rejected: Issue #37283 is open with no announced fix. We cannot
   block a user-visible regression on upstream.

4. **Codify the byte-stream DECSET-2026-absence probe as a vitest
   fixture-driven test.** Rejected: would require shipping a real
   Claude TUI scrollback (privacy + diff bloat) AND would need
   re-validation on every Claude Code version bump. The empirical
   evidence lives in ADR-098 instead.

## Falsifiability

If a Claude Code release ships that DOES emit DECSET 2026 in the main
buffer, AND a real-Claude UAT confirms xterm 6 batches those frames
flicker-free without `CLAUDE_CODE_NO_FLICKER`, ADR-098 is falsified
and a future Iterate K can flip the default back to OFF (or remove
the flag entirely). The falsification path is:

1. Capture a fresh Claude TUI scrollback (rerun the probe).
2. Confirm `decset_2026_enter > 0`.
3. Toggle `SHIPWRIGHT_TERMINAL_NO_FLICKER=0` in a UAT session.
4. Visually verify no cursor flicker around the streaming label.
5. Then propose Iterate K.

Anything short of that empirical sequence is insufficient to revert
again.

## Files modified

- `server/src/config.ts` (~5 LOC — comment + default flip)
- `server/src/terminal/routes.ts` (~8 LOC — `buildSpawnEnv` default
  branch + comment)
- `server/src/terminal/pty-env-flicker.test.ts` (~80 LOC — test
  re-baseline)
- `.env.example` (verify; no change if I didn't touch it)
- `CLAUDE.md` (DO-NOT regression guard #22 amendment, ~80 chars of
  inline edit)
- `.shipwright/agent_docs/decision_log.md` (ADR-097 back-fill + ADR-098)
- `CHANGELOG.md` (1 bullet)
