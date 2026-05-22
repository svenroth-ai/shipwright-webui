# ADR-098 spec — Iterate J: restore `CLAUDE_CODE_NO_FLICKER=1` default to opt-out

**Linked decision:** `.shipwright/agent_docs/decision_log.md` → ADR-098.
**Status:** accepted.
**Date:** 2026-05-13.
**Campaign:** `headless-terminal-refactor`, Iterate J.
**Type:** fix (config-only revert).
**Complexity:** small.
**Risk flags:** none.
**Supersedes:** ADR-097's `CLAUDE_CODE_NO_FLICKER` default-OFF clause ONLY (other Iterate I changes — xterm 6 upgrade, snapshot v2, `windowsMode` removal, `@xterm/headless` 6.0.0, Iterate H heuristic, `buildSpawnEnv` helper structure, opt-out-wins-over-caller semantics — ALL RETAINED).
**Restores:** ADR-095 default-on stance for `CLAUDE_CODE_NO_FLICKER`.

## Extended Context

ADR-097 flipped the `CLAUDE_CODE_NO_FLICKER` env-injection default from ON (opt-out) to OFF (opt-in) on the theoretical assumption that xterm.js 6.0's native DECSET 2026 / Synchronized Output support would batch Claude TUI's main-buffer rendering frames flicker-free. UAT post-merge falsified the hypothesis: with `CLAUDE_CODE_NO_FLICKER=1` unset, the cursor flicker around the animated "working… (Esc to interrupt)" label returns verbatim, identical to the pre-Iterate-G baseline.

## Empirical Evidence

A direct read of the live Claude TUI scrollback file confirmed the root cause. Probe (run against a real 265 711-byte capture of a working Claude session, `<homedir>/.shipwright-webui/terminal-scrollback/5a5832a3-6e76-44bd-bf10-202b90a7f270.log`):

```
$ python -c "data=open('<…>/5a5832a3-…-202b90a7f270.log','rb').read(); print(f'size={len(data)}, decset_2026_enter={data.count(b\"\\x1b[?2026h\")}, decset_2026_leave={data.count(b\"\\x1b[?2026l\")}, cup_sequences={data.count(b\"\\x1b[\")}')"
size=265711, decset_2026_enter=0, decset_2026_leave=0, cup_sequences=21690
```

A 265 KB live Claude Code 2.1.139 scrollback contains **21 690 raw cursor-positioning sequences** (`\x1b[…H` / `\x1b[…;…H`) but **zero Synchronized-Output bracket pairs**. xterm 6.0's DECSET 2026 honour is real (the renderer batches frames when the producer wraps them) — but Claude Code does not wrap its frames, so there is nothing for xterm 6 to batch. The Iterate I inference "xterm 6 implements DECSET 2026 → flicker is fixed by xterm 6 alone" was unfounded because the producer side never opts in.

Confirmation upstream: Claude Code Issue **#37283** ("TUI flickers / cursor jumps in tmux during streaming output (missing DECSET 2026 synchronized output)") remains **open** at the time of this ADR.

## Decision

1. Restore `config.ts:terminalNoFlicker` default to `process.env.SHIPWRIGHT_TERMINAL_NO_FLICKER !== "0"` (default-on; opt-out via literal `"0"`; matches `terminalHeadlessMirror` inverted-falsy convention).
2. Restore `terminal/routes.ts buildSpawnEnv` default branch to inject `CLAUDE_CODE_NO_FLICKER="1"` unconditionally unless `SHIPWRIGHT_TERMINAL_NO_FLICKER === "0"`.
3. Preserve the "opt-out wins over caller-env override" symmetry from Iterate G (external code review openai medium, 2026-05-13) — verbatim, just semantically inverted from Iterate I's "opt-in wins" shape.
4. Re-baseline `pty-env-flicker.test.ts` for default-on (10 cases including the regression fence) and `config.test.ts` (3 cases).
5. Amend CLAUDE.md DO-NOT regression guard #22 to mark the NO_FLICKER default-OFF clause as superseded by ADR-098; document the empirical falsification path required before any future revert.
6. Retain ALL other Iterate I changes verbatim — xterm 6, `@xterm/headless` 6.0.0, snapshot envelope v2, Iterate H 60 % preservation heuristic, `windowsMode` removal, version pins.

## Rationale

- The alt-screen path's UX cost (no browser-native Cmd+F of conversation history, mouse capture, fixed input box) was the only argument for ADR-097's flip. With empirical proof that the flip yields the original flicker regression, the trade-off swings back: visible flicker degrades every streaming Claude response, whereas the lost Cmd+F is a recoverable inconvenience (xterm's own scrollback + Strg+Shift+F via xterm search-addon both remain available).
- The Iterate H 60 % preservation heuristic STAYS in force as defense-in-depth even though its original load-bearing rationale (alt-screen-leave-empty failure mode) is now active again rather than dormant.
- The fix is the smallest possible diff: two source-code single-line gate flips + a comment block per file + test re-baseline. No new dependency, no architecture change, no new I/O surface.

## Consequences

- `server/src/config.ts` (~5 LOC source + doc comment): default flips back; injected as `"1"` whenever `SHIPWRIGHT_TERMINAL_NO_FLICKER !== "0"`.
- `server/src/terminal/routes.ts` (~8 LOC source + doc comment): `buildSpawnEnv` default branch injects; opt-out wins over caller-env override (symmetric Iterate G regression fence preserved).
- `server/src/terminal/pty-env-flicker.test.ts` (10 cases re-baselined): default-on, empty-still-on, `=0` opt-out, non-`0` defaults-on, explicit `=1` opt-in matches default, default-on wins over upstream, brand-fit overrides, caller-supplied wins on default path, opt-out-wins-over-caller regression fence, base env propagation. 936/936 server tests green (same as post-I baseline).
- `server/src/config.test.ts` (3 cases re-baselined): default-on, non-`0` stays on, `=0` opt-out.
- `.env.example`: no change needed — Iterate I did not touch it; the file already documents default-on.
- `CLAUDE.md` DO-NOT regression guard #22 NO_FLICKER clause amended to ADR-098 supersession with the empirical falsification path explicit.
- `CHANGELOG.md` `[Unreleased] → Fixed` bullet appended.
- 784/784 client tests green (no client surface touched).

## External Plan Review / Code Review Cascade / Confidence Calibration

ALL SKIPPED — runner contract gates require medium+ OR risk flag OR diff > 100 LOC OR `touches_io_boundary`. Iterate J is complexity=small per the spec frontmatter with no risk flags; total diff ~30 LOC source + ~80 LOC test re-baseline + docs. The empirical anchor for the change is the 265 KB live Claude TUI scrollback analysis recorded under "Empirical Evidence" above.

## Self-Review (7-item canonical checklist)

1. **Spec Compliance** — PASS: all 8 AC items satisfied.
2. **Error Handling** — PASS: no new throw / try-catch surface; the env-injection branch is a pure conditional.
3. **Security Basics** — PASS: no new I/O surface, no user-controlled paths, no new env-var reads beyond the already-validated `SHIPWRIGHT_TERMINAL_NO_FLICKER`.
4. **Test Quality** — PASS: 10 cases in `pty-env-flicker.test.ts` exercise default-on / opt-out / caller-override matrix + opt-out-wins regression fence + base env propagation. 3 cases in `config.test.ts` re-baselined.
5. **Performance Basics** — PASS: zero perf impact. Same number of property-write/delete operations per pty spawn; only the inverted gate condition.
6. **Naming & Structure** — PASS: no new exports, no new public API, no new files. Inline comments cross-reference ADR-095/097/098 + the empirical anchor + Issue #37283.
7. **Affected Boundaries (ADR-024)** — PASS: no serialized-format change. The boundary in scope is server→pty-child-env (single-direction; no consumer round-trip).

## F0.5 Surface Verification

`surface=cli` per spec frontmatter. The flag flip is unit-tested with 10 vitest cases in `pty-env-flicker.test.ts` + 3 in `config.test.ts`. Visual flicker confirmation deferred to user UAT post-merge. A Playwright spec would require driving a real Claude TUI through a real pty in CI with frame-stepping renderer inspection — exceeds scope and would require shipping a Claude scrollback fixture (privacy + diff bloat).

## Falsifiability

If a future Claude Code release emits DECSET 2026 in the main buffer AND a real-Claude UAT confirms xterm 6 batches those frames flicker-free without `CLAUDE_CODE_NO_FLICKER`, ADR-098 is falsified and a future Iterate K can flip the default back to OFF (or remove the flag entirely). The required falsification sequence: (1) capture a fresh Claude TUI scrollback; (2) confirm `decset_2026_enter > 0`; (3) toggle `SHIPWRIGHT_TERMINAL_NO_FLICKER=0` in a UAT session; (4) visually verify no cursor flicker around the streaming label; (5) propose Iterate K. Anything short of that empirical sequence is insufficient to revert again.

## Rejected Alternatives

1. **Per-task opt-in toggle in EmbeddedTerminal UI** — surfaces an architectural choice the end user cannot meaningfully evaluate; defers the right behaviour (flicker-free out of the box) to a manual click most users will never find.
2. **DECSET 2026 sniff in `pty-manager.onData` with auto-toggle.** Rejected: env vars are set at spawn time and cannot be changed mid-process; the alt-screen-mode decision is committed at Claude Code startup. Sniffing would itself need the same empirical anchor we already have.
3. **Defer to a future Claude Code release that emits DECSET 2026.** Rejected: Issue #37283 is open with no announced fix; cannot block a user-visible regression on upstream.
4. **Codify the byte-stream DECSET-2026-absence probe as a vitest fixture-driven test.** Rejected: would require shipping a real Claude TUI scrollback (privacy + diff bloat) AND would need re-validation on every Claude Code version bump.

## Files modified

`server/src/config.ts`, `server/src/terminal/routes.ts`, `server/src/terminal/pty-env-flicker.test.ts` (10 cases re-baselined), `server/src/config.test.ts` (3 cases re-baselined), `CLAUDE.md` (DO-NOT regression guard #22 amendment), `.shipwright/agent_docs/decision_log.md` (ADR-097 back-fill + ADR-098 entry), `CHANGELOG.md` (1 Fixed bullet), `.shipwright/planning/iterate/2026-05-13-J-restore-no-flicker-default.md` (NEW spec).
