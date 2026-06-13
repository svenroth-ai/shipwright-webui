/*
 * pty-env-flicker.test.ts — Iterate G (ADR-095), inverted Iterate I
 * (ADR-097), restored Iterate J (ADR-098).
 *
 * Unit-tests `buildSpawnEnv` — the pure helper that constructs the env
 * map handed to `@lydell/node-pty`. Native-binary-free; covers the
 * default-ON / opt-out / caller-override semantics for
 * `CLAUDE_CODE_NO_FLICKER` (Anthropic's workaround for the Claude TUI
 * flicker — https://code.claude.com/docs/en/fullscreen).
 *
 * ADR-098 restored ADR-095's default-ON stance after empirical
 * verification (265 711-byte live Claude Code 2.1.139 scrollback
 * contained zero DECSET 2026 / Synchronized Output sequences in main-
 * buffer rendering, falsifying ADR-097's hypothesis that xterm.js 6.0's
 * native sync support would batch Claude's frames flicker-free).
 *
 * Why a helper test (vs end-to-end pty spawn): the iterate touches a
 * single field in a single env map. End-to-end coverage would require
 * either (a) the real native @lydell/node-pty binary or (b) spawning a
 * real child shell and inspecting its env — both heavy. The helper is
 * pure; one input map in, one output map out.
 */

import { describe, expect, it } from "vitest";
import { buildSpawnEnv } from "./spawn-env.js";

describe("buildSpawnEnv — Iterate J (ADR-098) CLAUDE_CODE_NO_FLICKER injection (default ON, opt-out)", () => {
  it("SETS CLAUDE_CODE_NO_FLICKER='1' by default (env var unset)", () => {
    const baseEnv: Record<string, string | undefined> = { PATH: "/usr/bin" };
    const env = buildSpawnEnv(baseEnv);
    expect(env.CLAUDE_CODE_NO_FLICKER).toBe("1");
  });

  it("SETS CLAUDE_CODE_NO_FLICKER='1' when SHIPWRIGHT_TERMINAL_NO_FLICKER='' (empty enables default)", () => {
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      SHIPWRIGHT_TERMINAL_NO_FLICKER: "",
    };
    const env = buildSpawnEnv(baseEnv);
    expect(env.CLAUDE_CODE_NO_FLICKER).toBe("1");
  });

  it("OMITS CLAUDE_CODE_NO_FLICKER when SHIPWRIGHT_TERMINAL_NO_FLICKER='0' (opt-out)", () => {
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      SHIPWRIGHT_TERMINAL_NO_FLICKER: "0",
    };
    const env = buildSpawnEnv(baseEnv);
    expect("CLAUDE_CODE_NO_FLICKER" in env).toBe(false);
  });

  it("SETS CLAUDE_CODE_NO_FLICKER='1' for any non-'0' value (canonical-falsy gate)", () => {
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      SHIPWRIGHT_TERMINAL_NO_FLICKER: "true",
    };
    const env = buildSpawnEnv(baseEnv);
    // ADR-098: only the literal string "0" opts out. Other falsy-looking
    // values (`"false"`, `"off"`, `"no"`) are intentionally NOT honoured
    // so the contract stays tight and unambiguous. Mirrors the
    // `terminalHeadlessMirror` convention.
    expect(env.CLAUDE_CODE_NO_FLICKER).toBe("1");
  });

  it("SETS CLAUDE_CODE_NO_FLICKER='1' when SHIPWRIGHT_TERMINAL_NO_FLICKER='1' (explicit opt-in matches default)", () => {
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      SHIPWRIGHT_TERMINAL_NO_FLICKER: "1",
    };
    const env = buildSpawnEnv(baseEnv);
    expect(env.CLAUDE_CODE_NO_FLICKER).toBe("1");
  });

  it("default-ON wins even if upstream had CLAUDE_CODE_NO_FLICKER unset upstream", () => {
    // With no explicit opt-out flag, the helper injects "1" regardless
    // of upstream env state. The upstream value, if any, is overwritten
    // — this is the documented default-on contract (ADR-095/ADR-098).
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      CLAUDE_CODE_NO_FLICKER: "would-be-overwritten-by-default",
    };
    const env = buildSpawnEnv(baseEnv);
    expect(env.CLAUDE_CODE_NO_FLICKER).toBe("1");
  });

  it("preserves the ADR-067 brand-fit env overrides", () => {
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    };
    const env = buildSpawnEnv(baseEnv);
    expect(env.TERM).toBe("dumb");
    expect(env.COLORTERM).toBe("");
    expect(env.FORCE_COLOR).toBe("1");
  });

  it("caller-supplied env overrides (test escape hatch) — default-ON path", () => {
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      // no SHIPWRIGHT_TERMINAL_NO_FLICKER (default ON)
    };
    const callerEnv = { CLAUDE_CODE_NO_FLICKER: "explicit-test-value" };
    const env = buildSpawnEnv(baseEnv, callerEnv);
    // Caller wins over the helper's default "1" when the user has NOT
    // explicitly opted OUT. Used by tests + future per-task overrides.
    expect(env.CLAUDE_CODE_NO_FLICKER).toBe("explicit-test-value");
  });

  it("opt-OUT wins over caller-supplied CLAUDE_CODE_NO_FLICKER (ADR-098 contract — symmetric to ADR-095)", () => {
    // ADR-098 contract: with explicit opt-out, the caller cannot
    // silently re-introduce CLAUDE_CODE_NO_FLICKER. Verbatim mirror
    // of the ADR-095 opt-out-wins regression fence (external code
    // review openai medium, 2026-05-13). Other caller-env vars
    // still flow through.
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      SHIPWRIGHT_TERMINAL_NO_FLICKER: "0",
    };
    const callerEnv = {
      CLAUDE_CODE_NO_FLICKER: "would-reintroduce",
      MY_OTHER_VAR: "still-flows-through",
    };
    const env = buildSpawnEnv(baseEnv, callerEnv);
    expect("CLAUDE_CODE_NO_FLICKER" in env).toBe(false);
    expect(env.MY_OTHER_VAR).toBe("still-flows-through");
  });

  it("propagates base env entries (PATH etc.) unchanged", () => {
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin:/bin",
      HOME: "/home/user",
      SOMETHING_ELSE: "value",
    };
    const env = buildSpawnEnv(baseEnv);
    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.HOME).toBe("/home/user");
    expect(env.SOMETHING_ELSE).toBe("value");
  });
});

describe("buildSpawnEnv — strip parent/child Claude-session markers (empty-Transcript fix, 2026-06-13)", () => {
  // Root cause: when the webui SERVER is started from inside a Claude Code
  // session (e.g. a claude-vscode / CLI terminal), its process.env carries
  // CLAUDE_CODE_CHILD_SESSION=1 (+ SESSION_ID / ENTRYPOINT / CLAUDECODE).
  // buildSpawnEnv spreads the whole server env into the pty, so every
  // embedded `claude` inherits those markers. Claude Code 2.1.x, on seeing
  // CLAUDE_CODE_CHILD_SESSION=1, runs as a CHILD session and SUPPRESSES the
  // flat ~/.claude/projects/<cwd>/<uuid>.jsonl transcript the Transcripts
  // tab reads → every embedded session shows an empty transcript.
  // Empirically isolated via pty A/B/C tests: CHILD_SESSION=1 ALONE
  // suppresses the jsonl; SESSION_ID / ENTRYPOINT / CLAUDECODE do not, but
  // are stripped defensively so the embedded claude shares no identity with
  // the server's launching session. The embedded terminal must ALWAYS spawn
  // claude as a fresh TOP-LEVEL session.
  it("strips CLAUDE_CODE_CHILD_SESSION (the proven jsonl-suppression trigger)", () => {
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      CLAUDE_CODE_CHILD_SESSION: "1",
    };
    const env = buildSpawnEnv(baseEnv);
    expect("CLAUDE_CODE_CHILD_SESSION" in env).toBe(false);
  });

  it("strips the defensive parent-session markers (SESSION_ID / ENTRYPOINT / CLAUDECODE)", () => {
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      CLAUDECODE: "1",
      CLAUDE_CODE_SESSION_ID: "c2061135-07fc-474c-9b01-eb23b7142cff",
      CLAUDE_CODE_ENTRYPOINT: "claude-vscode",
    };
    const env = buildSpawnEnv(baseEnv);
    expect("CLAUDECODE" in env).toBe(false);
    expect("CLAUDE_CODE_SESSION_ID" in env).toBe(false);
    expect("CLAUDE_CODE_ENTRYPOINT" in env).toBe(false);
  });

  it("does NOT strip unrelated CLAUDE_* vars the embedded claude needs (auth/config pass through)", () => {
    // The strip list is an explicit allowlist of parent-session identity
    // markers, NOT a blanket CLAUDE_* sweep — auth/config vars the embedded
    // claude depends on (e.g. CLAUDE_CONFIG_DIR, CLAUDE_CODE_API_BASE_URL)
    // must flow through untouched.
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      CLAUDE_CONFIG_DIR: "/home/user/.claude",
      CLAUDE_CODE_API_BASE_URL: "https://api.example.test",
    };
    const env = buildSpawnEnv(baseEnv);
    expect(env.CLAUDE_CONFIG_DIR).toBe("/home/user/.claude");
    expect(env.CLAUDE_CODE_API_BASE_URL).toBe("https://api.example.test");
  });

  it("preserves the webui's own CLAUDE_CODE_NO_FLICKER injection (ADR-098 default-ON)", () => {
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      CLAUDE_CODE_CHILD_SESSION: "1",
    };
    const env = buildSpawnEnv(baseEnv);
    expect(env.CLAUDE_CODE_NO_FLICKER).toBe("1");
  });

  it("a caller-supplied env cannot re-introduce the child-session marker", () => {
    const baseEnv: Record<string, string | undefined> = { PATH: "/usr/bin" };
    const callerEnv = { CLAUDE_CODE_CHILD_SESSION: "1", KEEP_ME: "yes" };
    const env = buildSpawnEnv(baseEnv, callerEnv);
    expect("CLAUDE_CODE_CHILD_SESSION" in env).toBe(false);
    expect(env.KEEP_ME).toBe("yes");
  });
});
