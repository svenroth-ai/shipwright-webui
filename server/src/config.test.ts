import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getConfig } from "./config.js";

describe("getConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns default port 3847 when no PORT env var is set", () => {
    delete process.env.PORT;
    const config = getConfig();
    expect(config.port).toBe(3847);
  });

  it("reads PORT env var and returns parsed number", () => {
    process.env.PORT = "4000";
    const config = getConfig();
    expect(config.port).toBe(4000);
  });

  it("returns default maxConcurrent of 3", () => {
    delete process.env.SHIPWRIGHT_MAX_CONCURRENT;
    const config = getConfig();
    expect(config.maxConcurrent).toBe(3);
  });

  it("reads SHIPWRIGHT_MAX_CONCURRENT env var", () => {
    process.env.SHIPWRIGHT_MAX_CONCURRENT = "5";
    const config = getConfig();
    expect(config.maxConcurrent).toBe(5);
  });

  it("returns heartbeatIntervalMs of 30000", () => {
    const config = getConfig();
    expect(config.heartbeatIntervalMs).toBe(30000);
  });

  // iterate-2026-06-02 — orphan-GC grace raised 30min → 12h (attachment-gated
  // idle ceiling). Overridable for ops via SHIPWRIGHT_TERMINAL_IDLE_TIMEOUT_MS.
  it("terminalIdleTimeoutMs defaults to 12h (43_200_000) when unset", () => {
    delete process.env.SHIPWRIGHT_TERMINAL_IDLE_TIMEOUT_MS;
    expect(getConfig().terminalIdleTimeoutMs).toBe(43_200_000);
  });

  it("reads SHIPWRIGHT_TERMINAL_IDLE_TIMEOUT_MS as a positive-int override", () => {
    process.env.SHIPWRIGHT_TERMINAL_IDLE_TIMEOUT_MS = "60000";
    expect(getConfig().terminalIdleTimeoutMs).toBe(60000);
  });

  it("returns a registryDir path containing .shipwright-webui", () => {
    const config = getConfig();
    expect(config.registryDir).toContain(".shipwright-webui");
  });

  // Iterate G (ADR-095), inverted Iterate I (ADR-097), restored Iterate J
  // (ADR-098) — terminalNoFlicker default-ON + opt-OUT semantics. Claude
  // Code 2.1.139 emits zero DECSET 2026 sequences in main-buffer rendering
  // (empirical: 265 711-byte live scrollback, 0 sync-output bracket pairs,
  // 21 690 raw CUP sequences) so xterm 6.0's native sync support has
  // nothing to batch; the alt-screen workaround is the only working
  // solution and is restored as the baseline.
  it("terminalNoFlicker defaults to true when SHIPWRIGHT_TERMINAL_NO_FLICKER is unset", () => {
    delete process.env.SHIPWRIGHT_TERMINAL_NO_FLICKER;
    const config = getConfig();
    expect(config.terminalNoFlicker).toBe(true);
  });

  it("terminalNoFlicker stays true for non-'0' values (empty / '1' / arbitrary string)", () => {
    process.env.SHIPWRIGHT_TERMINAL_NO_FLICKER = "";
    expect(getConfig().terminalNoFlicker).toBe(true);
    process.env.SHIPWRIGHT_TERMINAL_NO_FLICKER = "1";
    expect(getConfig().terminalNoFlicker).toBe(true);
    process.env.SHIPWRIGHT_TERMINAL_NO_FLICKER = "true";
    // ADR-098: canonical-falsy gate accepts ONLY the literal "0".
    // `"false"` / `"off"` / `"no"` etc. are intentionally not honoured
    // so the contract stays tight and unambiguous. Mirrors the
    // `terminalHeadlessMirror` `!== "0"` convention.
    expect(getConfig().terminalNoFlicker).toBe(true);
  });

  it("terminalNoFlicker flips to false on SHIPWRIGHT_TERMINAL_NO_FLICKER='0' (opt-out)", () => {
    process.env.SHIPWRIGHT_TERMINAL_NO_FLICKER = "0";
    const config = getConfig();
    expect(config.terminalNoFlicker).toBe(false);
  });
});
