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

  it("returns a registryDir path containing .shipwright-webui", () => {
    const config = getConfig();
    expect(config.registryDir).toContain(".shipwright-webui");
  });

  // Iterate G (ADR-095), inverted Iterate I (ADR-097) — terminalNoFlicker
  // default-OFF + opt-IN semantics. xterm.js 6.0.0 honours DECSET 2026
  // natively so the alt-screen workaround is no longer the baseline.
  it("terminalNoFlicker defaults to false when SHIPWRIGHT_TERMINAL_NO_FLICKER is unset", () => {
    delete process.env.SHIPWRIGHT_TERMINAL_NO_FLICKER;
    const config = getConfig();
    expect(config.terminalNoFlicker).toBe(false);
  });

  it("terminalNoFlicker stays false for non-'1' values (empty / '0' / arbitrary string)", () => {
    process.env.SHIPWRIGHT_TERMINAL_NO_FLICKER = "";
    expect(getConfig().terminalNoFlicker).toBe(false);
    process.env.SHIPWRIGHT_TERMINAL_NO_FLICKER = "0";
    expect(getConfig().terminalNoFlicker).toBe(false);
    process.env.SHIPWRIGHT_TERMINAL_NO_FLICKER = "true";
    // ADR-097: canonical-truthy gate accepts ONLY the literal "1".
    // `"true"` / `"yes"` / `"on"` etc. are intentionally not honoured
    // so the contract stays tight and unambiguous.
    expect(getConfig().terminalNoFlicker).toBe(false);
  });

  it("terminalNoFlicker flips to true on SHIPWRIGHT_TERMINAL_NO_FLICKER='1' (opt-in)", () => {
    process.env.SHIPWRIGHT_TERMINAL_NO_FLICKER = "1";
    const config = getConfig();
    expect(config.terminalNoFlicker).toBe(true);
  });
});
