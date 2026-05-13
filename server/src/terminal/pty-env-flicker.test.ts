/*
 * pty-env-flicker.test.ts — Iterate G (ADR-095).
 *
 * Unit-tests `buildSpawnEnv` — the pure helper that constructs the env
 * map handed to `@lydell/node-pty`. Native-binary-free; covers the
 * default-on / opt-out / caller-override semantics for
 * `CLAUDE_CODE_NO_FLICKER` (Anthropic's official workaround for the
 * Claude TUI flicker on terminals that don't implement DECSET 2026 —
 * https://code.claude.com/docs/en/fullscreen).
 *
 * Why a helper test (vs end-to-end pty spawn): the iterate touches a
 * single field in a single env map. End-to-end coverage would require
 * either (a) the real native @lydell/node-pty binary or (b) spawning a
 * real child shell and inspecting its env — both heavy. The helper is
 * pure; one input map in, one output map out.
 */

import { describe, expect, it } from "vitest";
import { buildSpawnEnv } from "./routes.js";

describe("buildSpawnEnv — Iterate G CLAUDE_CODE_NO_FLICKER injection", () => {
  it("sets CLAUDE_CODE_NO_FLICKER=1 by default (env var unset)", () => {
    const baseEnv: Record<string, string | undefined> = { PATH: "/usr/bin" };
    const env = buildSpawnEnv(baseEnv);
    expect(env.CLAUDE_CODE_NO_FLICKER).toBe("1");
  });

  it("sets CLAUDE_CODE_NO_FLICKER=1 when SHIPWRIGHT_TERMINAL_NO_FLICKER=''", () => {
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      SHIPWRIGHT_TERMINAL_NO_FLICKER: "",
    };
    const env = buildSpawnEnv(baseEnv);
    expect(env.CLAUDE_CODE_NO_FLICKER).toBe("1");
  });

  it("sets CLAUDE_CODE_NO_FLICKER=1 when SHIPWRIGHT_TERMINAL_NO_FLICKER=1 (any non-'0' value)", () => {
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      SHIPWRIGHT_TERMINAL_NO_FLICKER: "1",
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

  it("opt-out wins even if upstream had CLAUDE_CODE_NO_FLICKER already set", () => {
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      CLAUDE_CODE_NO_FLICKER: "1",
      SHIPWRIGHT_TERMINAL_NO_FLICKER: "0",
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

  it("caller-supplied env overrides (test escape hatch) — non-opt-out path", () => {
    const baseEnv: Record<string, string | undefined> = { PATH: "/usr/bin" };
    const callerEnv = { CLAUDE_CODE_NO_FLICKER: "explicit-test-value" };
    const env = buildSpawnEnv(baseEnv, callerEnv);
    // Caller wins over the helper's default when opt-out is NOT in
    // force. Used by tests + future per-task overrides.
    expect(env.CLAUDE_CODE_NO_FLICKER).toBe("explicit-test-value");
  });

  it("opt-out wins over caller-supplied CLAUDE_CODE_NO_FLICKER (external code-review fix)", () => {
    // External code-review finding (openai medium, 2026-05-13):
    // allowing the caller to silently reintroduce CLAUDE_CODE_NO_FLICKER
    // would break the opt-out contract from ADR-095. The opt-out wins;
    // the rest of the caller env still flows through.
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
