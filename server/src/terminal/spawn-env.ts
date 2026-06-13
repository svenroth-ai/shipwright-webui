/*
 * spawn-env.ts — the pure env-map factory for the embedded-terminal pty.
 *
 * Extracted verbatim from `terminal/routes.ts` (which sits at its ADR-103
 * bloat-exception ceiling) so the empty-Transcripts fix — stripping the
 * parent/child Claude-session markers — could land without ratcheting that
 * file. `buildSpawnEnv` is the SOLE place the pty spawn env is built
 * (`createNodePtySpawnFn` in routes.ts is its only runtime caller); the
 * unit test lives in `pty-env-flicker.test.ts`.
 */

/**
 * Iterate G (ADR-095), amended Iterate I (ADR-097), restored Iterate J
 * (ADR-098) — pure helper that builds the env map handed to the spawned
 * pty. Factored out of `createNodePtySpawnFn` so it can be unit-tested
 * without the native node-pty binary.
 *
 * Layered as: baseProcessEnv → TERM/COLORTERM/FORCE_COLOR brand-fit
 * overrides (ADR-067) → CLAUDE_CODE_NO_FLICKER toggle
 * (ADR-095/ADR-097/ADR-098) → caller-supplied opts.env (last-write-wins
 * for most keys; the default-on CLAUDE_CODE_NO_FLICKER is protected
 * from accidental caller silent-revert — see opt-out-wins symmetry
 * below) → strip of parent/child Claude-session identity markers (the
 * empty-Transcripts fix, 2026-06-13).
 *
 * CLAUDE_CODE_NO_FLICKER (ADR-098):
 *   - Default ON: the key is written as `"1"` into the env map.
 *     Claude Code renders into the alt-screen buffer (vim/htop-style),
 *     bypassing per-frame ANSI cursor moves entirely. Required because
 *     Claude Code 2.1.139 emits ZERO DECSET 2026 / Synchronized Output
 *     sequences in its main-buffer rendering (empirical: 265 711-byte
 *     live scrollback, 0 `\x1b[?2026h` / 0 `\x1b[?2026l`, 21 690 raw
 *     CUP sequences). xterm 6.0's native sync-output honour has
 *     nothing to batch because the producer never opts in.
 *     Claude Code Issue #37283 remains open. Docs:
 *     https://code.claude.com/docs/en/fullscreen.
 *   - Opt-OUT via SHIPWRIGHT_TERMINAL_NO_FLICKER=0: the key is deleted
 *     from the env map so the child shell sees whatever (if anything)
 *     the upstream env set. Useful for users who explicitly want
 *     Claude in the main buffer (Cmd+F scrollback search, mouse
 *     capture, etc.) and are willing to accept the visible flicker
 *     around streaming output.
 *
 * Reversion from ADR-097's opt-in default: ADR-097 hypothesised that
 * xterm 6's DECSET 2026 honour would batch Claude TUI's main-buffer
 * frames flicker-free. UAT post-Iterate-I falsified the hypothesis;
 * ADR-098 documents the empirical scrollback investigation. The
 * default-on stance from ADR-095 is restored verbatim. The
 * "opt-out wins over caller-env override" semantic (ADR-095, external
 * code review openai medium, 2026-05-13) is preserved as the
 * symmetric default-on regression fence.
 */
export function buildSpawnEnv(
  baseProcessEnv: Record<string, string | undefined>,
  callerEnv?: Record<string, string | undefined>,
): Record<string, string | undefined> {
  // ADR-067 brand fit on Windows: chalk's `supports-color` package
  // has a hardcoded Windows branch that returns level 3 (truecolor)
  // for Windows 10 build ≥14931 — REGARDLESS of TERM, COLORTERM, or
  // FORCE_COLOR=1. Claude Code uses chalk under ink, so its
  // "auto mode on" banner emits RGB \x1b[38;2;...m escapes that
  // bypass our 16-slot xterm theme and render the original neon
  // yellow on beige.
  //
  // The single escape hatch in supports-color:
  //
  //   if (env.TERM === 'dumb') { return min; }   // min = FORCE_COLOR || 0
  //
  // So `TERM=dumb` + `FORCE_COLOR=1` returns level 1 (16-color),
  // which falls into our brand theme. Trade-off: ncurses-based tools
  // (vim, less, htop) also see TERM=dumb and disable their colors;
  // power users can override per-shell via `$env:TERM = "xterm"`
  // before invoking those tools. For Claude Code as the primary
  // workload of this pane, brand consistency wins over vim color.
  //
  // Iterate K UAT 2026-05-14: empirically tested `TERM=xterm-256color`
  // (siteboon-parity) hoping it would unlock Claude/Ink sync-output
  // emission. Falsified: byte-stream histogram of pre/post scrollback
  // for the same task showed 0 DECSET 2026 sequences in BOTH eras.
  // TERM=dumb does NOT block Claude's sync-output. It DOES, however,
  // suppress PowerShell 7's xterm window manipulation + cursor-shape
  // + ED2 sequences emitted on each PSReadLine prompt redraw — which
  // added visible new flicker / minor smearing on Strg+C return to
  // shell. Keeping TERM=dumb. Real flicker fix is xterm.js side:
  // scrollOnEraseInDisplay (see EmbeddedTerminal.tsx) — see xtermjs
  // issue #5620 + maintainer @jerch's diagnosis.
  const env: Record<string, string | undefined> = {
    ...baseProcessEnv,
    TERM: "dumb",
    COLORTERM: "",
    FORCE_COLOR: "1",
  };
  // Iterate G (ADR-095), restored Iterate J (ADR-098) after the
  // Iterate I (ADR-097) opt-in attempt was empirically falsified.
  // Claude TUI flicker workaround: default ON — Claude Code 2.1.139
  // emits zero DECSET 2026 sequences in its main-buffer rendering, so
  // xterm 6.0's native Synchronized-Output honour cannot batch frames
  // the producer never wraps. Opt-OUT via SHIPWRIGHT_TERMINAL_NO_FLICKER=0.
  const optedOut = baseProcessEnv.SHIPWRIGHT_TERMINAL_NO_FLICKER === "0";
  if (optedOut) {
    // Explicit-off path: ensure the key is absent so the child shell
    // sees whatever (if anything) the upstream env set. We delete
    // rather than set to undefined because undefined keys can survive
    // some spread operations in TypeScript erasure paths.
    delete env.CLAUDE_CODE_NO_FLICKER;
  } else {
    env.CLAUDE_CODE_NO_FLICKER = "1";
  }
  // Caller-supplied env wins for ALL keys EXCEPT CLAUDE_CODE_NO_FLICKER
  // when the user has explicitly opted OUT via SHIPWRIGHT_TERMINAL_NO_FLICKER=0.
  // External code review (openai medium, 2026-05-13) — allowing the
  // caller to silently re-inject the key would break the documented
  // opt-out contract. The opt-out wins; the rest of the caller env
  // still flows through. Symmetric to ADR-097's opt-in-wins fence,
  // now restored to the ADR-095 default-on stance per ADR-098.
  if (callerEnv) {
    for (const [k, v] of Object.entries(callerEnv)) {
      if (optedOut && k === "CLAUDE_CODE_NO_FLICKER") continue;
      env[k] = v;
    }
  }
  // Strip parent/child Claude-session identity markers so the embedded
  // claude ALWAYS launches as a fresh TOP-LEVEL session. When the webui
  // server is started from inside a Claude Code session (e.g. claude-vscode),
  // its process.env carries these markers and the `{ ...baseProcessEnv }`
  // spread forwards them into every pty. Claude Code 2.1.x, on seeing
  // CLAUDE_CODE_CHILD_SESSION=1, runs as a CHILD session and SUPPRESSES the
  // flat ~/.claude/projects/<cwd>/<uuid>.jsonl transcript the Transcripts tab
  // reads → empty transcript for every embedded session (root-caused
  // 2026-06-13; pty A/B/C isolation proved CHILD_SESSION=1 alone is the
  // trigger). Allowlist of identity markers ONLY — auth/config CLAUDE_* vars
  // pass through; the embedded claude sets its own on boot. Stripped AFTER
  // the callerEnv merge so neither base nor caller can leak them back.
  for (const k of PARENT_SESSION_ENV_KEYS) delete env[k];
  return env;
}

/** Claude-session identity markers stripped by {@link buildSpawnEnv}. */
const PARENT_SESSION_ENV_KEYS = [
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDECODE",
] as const;
