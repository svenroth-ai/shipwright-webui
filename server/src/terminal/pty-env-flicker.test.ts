/*
 * pty-env-flicker.test.ts — Iterate G (ADR-095), inverted Iterate I (ADR-097).
 *
 * Unit-tests `buildSpawnEnv` — the pure helper that constructs the env
 * map handed to `@lydell/node-pty`. Native-binary-free; covers the
 * default-OFF / opt-in / caller-override semantics for
 * `CLAUDE_CODE_NO_FLICKER` (Anthropic's workaround for the Claude TUI
 * flicker on terminals that don't implement DECSET 2026 —
 * https://code.claude.com/docs/en/fullscreen).
 *
 * ADR-097 inverted ADR-095's default: xterm.js 6.0.0 honours DECSET
 * 2026 natively in the main buffer so the alt-screen workaround is no
 * longer the baseline. The opt-in shape is forward-compatible (no
 * churn if Anthropic deprecates `CLAUDE_CODE_NO_FLICKER`).
 *
 * Why a helper test (vs end-to-end pty spawn): the iterate touches a
 * single field in a single env map. End-to-end coverage would require
 * either (a) the real native @lydell/node-pty binary or (b) spawning a
 * real child shell and inspecting its env — both heavy. The helper is
 * pure; one input map in, one output map out.
 */

import { describe, expect, it } from "vitest";
import { buildSpawnEnv } from "./routes.js";

describe("buildSpawnEnv — Iterate I (ADR-097) CLAUDE_CODE_NO_FLICKER injection (default OFF, opt-in)", () => {
  it("OMITS CLAUDE_CODE_NO_FLICKER by default (env var unset)", () => {
    const baseEnv: Record<string, string | undefined> = { PATH: "/usr/bin" };
    const env = buildSpawnEnv(baseEnv);
    expect("CLAUDE_CODE_NO_FLICKER" in env).toBe(false);
  });

  it("OMITS CLAUDE_CODE_NO_FLICKER when SHIPWRIGHT_TERMINAL_NO_FLICKER=''", () => {
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      SHIPWRIGHT_TERMINAL_NO_FLICKER: "",
    };
    const env = buildSpawnEnv(baseEnv);
    expect("CLAUDE_CODE_NO_FLICKER" in env).toBe(false);
  });

  it("OMITS CLAUDE_CODE_NO_FLICKER when SHIPWRIGHT_TERMINAL_NO_FLICKER='0' (legacy opt-out, now redundant with default)", () => {
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      SHIPWRIGHT_TERMINAL_NO_FLICKER: "0",
    };
    const env = buildSpawnEnv(baseEnv);
    expect("CLAUDE_CODE_NO_FLICKER" in env).toBe(false);
  });

  it("OMITS CLAUDE_CODE_NO_FLICKER for any non-'1' value (canonical-truthy gate)", () => {
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      SHIPWRIGHT_TERMINAL_NO_FLICKER: "true",
    };
    const env = buildSpawnEnv(baseEnv);
    // ADR-097: only the literal string "1" opts in. Other truthy-looking
    // values (`"true"`, `"yes"`, `"on"`) are intentionally NOT honoured
    // so the contract stays tight and unambiguous.
    expect("CLAUDE_CODE_NO_FLICKER" in env).toBe(false);
  });

  it("SETS CLAUDE_CODE_NO_FLICKER='1' when SHIPWRIGHT_TERMINAL_NO_FLICKER='1' (opt-in)", () => {
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      SHIPWRIGHT_TERMINAL_NO_FLICKER: "1",
    };
    const env = buildSpawnEnv(baseEnv);
    expect(env.CLAUDE_CODE_NO_FLICKER).toBe("1");
  });

  it("default-OFF wins even if upstream had CLAUDE_CODE_NO_FLICKER already set", () => {
    // Mirror image of the ADR-095 opt-out-wins guarantee: with no
    // explicit opt-in flag, an upstream-leaked CLAUDE_CODE_NO_FLICKER
    // is scrubbed so the child shell sees the documented default
    // (alt-screen path INACTIVE, main-buffer rendering ACTIVE).
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      CLAUDE_CODE_NO_FLICKER: "1",
    };
    const env = buildSpawnEnv(baseEnv);
    expect("CLAUDE_CODE_NO_FLICKER" in env).toBe(false);
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

  it("caller-supplied env overrides (test escape hatch) — opt-IN path", () => {
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      SHIPWRIGHT_TERMINAL_NO_FLICKER: "1",
    };
    const callerEnv = { CLAUDE_CODE_NO_FLICKER: "explicit-test-value" };
    const env = buildSpawnEnv(baseEnv, callerEnv);
    // Caller wins over the helper's opt-in default of "1" when the
    // opt-in flag IS in force. Used by tests + future per-task overrides.
    expect(env.CLAUDE_CODE_NO_FLICKER).toBe("explicit-test-value");
  });

  it("default-OFF wins over caller-supplied CLAUDE_CODE_NO_FLICKER (ADR-097 contract)", () => {
    // ADR-097 contract: without explicit opt-in, the caller cannot
    // silently re-introduce CLAUDE_CODE_NO_FLICKER. Mirrors the
    // ADR-095 opt-out-wins guarantee verbatim, inverted to the
    // opt-in default. Other caller-env vars still flow through.
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      // no SHIPWRIGHT_TERMINAL_NO_FLICKER (default OFF)
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
