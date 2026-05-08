/*
 * diagnostics.cli-context.test.ts — iterate v0.8.8 AC-4
 *
 * When `claudeCli.supported` is `false` (CLI not found OR out-of-range),
 * the diagnostics response includes a `diagnostic` block with the
 * primary lookup output, a PATH sample, and the curated fallback
 * paths checked. Empowers operators to self-diagnose PATH-drift
 * without reading server logs.
 *
 * When supported=true, the `diagnostic` block is omitted (no UI noise
 * on the happy path).
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createDiagnosticsRoutes } from "./diagnostics.js";
import type { SdkSessionsStore } from "../core/sdk-sessions-store.js";

function fakeStore(): SdkSessionsStore {
  return {
    list: () => [],
    get: () => undefined,
  } as unknown as SdkSessionsStore;
}

async function probe(
  versionInfo: () => {
    raw: string;
    parsed: { major: number; minor: number; patch: number } | null;
    supported: boolean;
  },
): Promise<{
  claudeCli: {
    raw: string;
    parsed: unknown;
    supported: boolean;
    minSupported: string;
    diagnostic?: {
      whereOutput: string;
      pathSample: string[];
      checkedFallbacks: string[];
    };
  };
}> {
  const app = new Hono();
  app.route("/", createDiagnosticsRoutes({
    store: fakeStore(),
    versionInfo: versionInfo as never,
  }));
  const res = await app.request("/api/diagnostics");
  return res.json() as never;
}

describe("AC-4 — diagnostics.claudeCli.diagnostic surfaces lookup context when CLI not found", () => {
  it("supported=true → no `diagnostic` field (happy path stays terse)", async () => {
    const json = await probe(() => ({
      raw: "2.1.132 (Claude Code)",
      parsed: { major: 2, minor: 1, patch: 132 },
      supported: true,
    }));
    expect(json.claudeCli.supported).toBe(true);
    expect(json.claudeCli.diagnostic).toBeUndefined();
  });

  it("supported=false (raw empty) → `diagnostic` block present with PATH sample + checked-fallbacks", async () => {
    const json = await probe(() => ({
      raw: "",
      parsed: null,
      supported: false,
    }));
    expect(json.claudeCli.supported).toBe(false);
    expect(json.claudeCli.diagnostic).toBeDefined();
    expect(typeof json.claudeCli.diagnostic?.whereOutput).toBe("string");
    expect(Array.isArray(json.claudeCli.diagnostic?.pathSample)).toBe(true);
    expect(Array.isArray(json.claudeCli.diagnostic?.checkedFallbacks)).toBe(true);
    // Sample is bounded — protects against a 30-entry PATH bloating the JSON.
    expect((json.claudeCli.diagnostic?.pathSample.length ?? 0)).toBeLessThanOrEqual(8);
  });

  it("supported=false (out-of-range version) → `diagnostic` block ALSO present", async () => {
    const json = await probe(() => ({
      raw: "1.99.0 (Claude Code)",
      parsed: { major: 1, minor: 99, patch: 0 },
      supported: false,
    }));
    expect(json.claudeCli.supported).toBe(false);
    expect(json.claudeCli.diagnostic).toBeDefined();
    // raw is NOT empty here but still surfaces the diagnostic for
    // troubleshooting (e.g., "I have an old version installed somewhere
    // on PATH — which path is it?").
  });

  it("checkedFallbacks entries are annotated with (exists)/(missing) (external review fix — openai medium #5)", async () => {
    const json = await probe(() => ({
      raw: "",
      parsed: null,
      supported: false,
    }));
    const fallbacks = (json.claudeCli.diagnostic as { checkedFallbacks: string[] }).checkedFallbacks;
    expect(fallbacks.length).toBeGreaterThan(0);
    // Every entry must end with " (exists)" or " (missing)" — operators
    // need to spot the case where a path EXISTS on disk but PATH
    // lookup didn't surface it (= "add this dir to PATH or set
    // SHIPWRIGHT_CLAUDE_BIN").
    for (const entry of fallbacks) {
      expect(entry).toMatch(/ \((exists|missing)\)$/);
    }
  });

  it("envOverride is included with annotation when SHIPWRIGHT_CLAUDE_BIN is set (external review fix — openai medium #2)", async () => {
    const prev = process.env.SHIPWRIGHT_CLAUDE_BIN;
    try {
      // Set to a path that surely doesn't exist for the assertion.
      process.env.SHIPWRIGHT_CLAUDE_BIN = "/this/path/does/not/exist/claude";
      const json = await probe(() => ({ raw: "", parsed: null, supported: false }));
      const diag = json.claudeCli.diagnostic as { envOverride: string | null };
      expect(diag.envOverride).toBe("/this/path/does/not/exist/claude (missing)");
    } finally {
      if (prev === undefined) {
        delete process.env.SHIPWRIGHT_CLAUDE_BIN;
      } else {
        process.env.SHIPWRIGHT_CLAUDE_BIN = prev;
      }
    }
  });

  it("envOverride is null when SHIPWRIGHT_CLAUDE_BIN is unset", async () => {
    const prev = process.env.SHIPWRIGHT_CLAUDE_BIN;
    delete process.env.SHIPWRIGHT_CLAUDE_BIN;
    try {
      const json = await probe(() => ({ raw: "", parsed: null, supported: false }));
      const diag = json.claudeCli.diagnostic as { envOverride: string | null };
      expect(diag.envOverride).toBeNull();
    } finally {
      if (prev !== undefined) process.env.SHIPWRIGHT_CLAUDE_BIN = prev;
    }
  });
});
