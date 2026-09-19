/*
 * codex-models-probe tests (iterate-2026-09-19-codex-model-catalog).
 * Fixture-driven from the real `codex debug models` JSON shape captured
 * during this iterate's Confidence Calibration probe (7 models, 5
 * visibility:"list" / 2 "hide").
 */

import { describe, it, expect } from "vitest";

import { runCodexModelsProbe } from "./codex-models-probe.js";
import type { RunResult } from "./readiness-probe-run.js";

function run(result: Partial<RunResult>): () => Promise<RunResult> {
  return () => Promise.resolve({ ok: true, stdout: "", stderr: "", code: 0, ...result });
}

const REAL_SAMPLE = JSON.stringify({
  models: [
    { slug: "gpt-6-astra", display_name: "GPT-6-Astra", visibility: "list" },
    { slug: "gpt-reserve", display_name: "GPT-Reserve", visibility: "hide" },
    { slug: "gpt-5.6-sol", display_name: "GPT-5.6-Sol", visibility: "list" },
    { slug: "gpt-5.6-terra", display_name: "GPT-5.6-Terra", visibility: "list" },
    { slug: "gpt-5.6-luna", display_name: "GPT-5.6-Luna", visibility: "list" },
    { slug: "gpt-5.5", display_name: "GPT-5.5", visibility: "list" },
    { slug: "codex-auto-review", display_name: "Codex Auto Review", visibility: "hide" },
  ],
});

describe("runCodexModelsProbe", () => {
  it("filters to visibility=list and maps to {slug, display_name}", async () => {
    const result = await runCodexModelsProbe({ run: run({ stdout: REAL_SAMPLE }) });
    expect(result).toEqual({
      ok: true,
      models: [
        { slug: "gpt-6-astra", display_name: "GPT-6-Astra" },
        { slug: "gpt-5.6-sol", display_name: "GPT-5.6-Sol" },
        { slug: "gpt-5.6-terra", display_name: "GPT-5.6-Terra" },
        { slug: "gpt-5.6-luna", display_name: "GPT-5.6-Luna" },
        { slug: "gpt-5.5", display_name: "GPT-5.5" },
      ],
    });
  });

  it("drops an individual malformed entry instead of failing the whole list", async () => {
    const sample = JSON.stringify({
      models: [
        { slug: "gpt-5.5", display_name: "GPT-5.5", visibility: "list" },
        { slug: 42, display_name: "Bad Slug Type", visibility: "list" },
        { slug: "no-display-name", visibility: "list" },
        { slug: "not a valid slug!", display_name: "Invalid Shape", visibility: "list" },
        { display_name: "Missing Slug", visibility: "list" },
        "not-even-an-object",
      ],
    });
    const result = await runCodexModelsProbe({ run: run({ stdout: sample }) });
    expect(result).toEqual({ ok: true, models: [{ slug: "gpt-5.5", display_name: "GPT-5.5" }] });
  });

  it("is not-ok when models is missing or not an array", async () => {
    const result = await runCodexModelsProbe({ run: run({ stdout: JSON.stringify({ models: "nope" }) }) });
    expect(result).toEqual({ ok: false, models: [] });
  });

  it("is not-ok on unparseable stdout", async () => {
    const result = await runCodexModelsProbe({ run: run({ stdout: "not json" }) });
    expect(result).toEqual({ ok: false, models: [] });
  });

  it("is not-ok on a non-zero exit code even with parseable stdout", async () => {
    const result = await runCodexModelsProbe({
      run: run({ stdout: REAL_SAMPLE, code: 1, ok: false }),
    });
    expect(result).toEqual({ ok: false, models: [] });
  });

  it("is not-ok on a timeout (code: null, ok: false)", async () => {
    const result = await runCodexModelsProbe({ run: run({ stdout: "", code: null, ok: false }) });
    expect(result).toEqual({ ok: false, models: [] });
  });

  it("still succeeds when the shared version-regex heuristic reports ok:false for an all-integer-slug catalog (code-review fix)", async () => {
    // readiness-probe-run.ts's parseExecResult sets `ok` from a \d+\.\d+
    // regex over stdout+stderr, written for `--version` probes. A real
    // `codex debug models` catalog with no dotted-version slug anywhere
    // (all integer-suffixed) trips that heuristic to false on a genuinely
    // clean exit — this locks in gating on `code === 0` instead.
    const allIntegerSlugs = JSON.stringify({
      models: [
        { slug: "gpt-6-astra", display_name: "GPT-6-Astra", visibility: "list" },
        { slug: "o3", display_name: "O3", visibility: "list" },
      ],
    });
    const result = await runCodexModelsProbe({
      run: run({ stdout: allIntegerSlugs, code: 0, ok: false }),
    });
    expect(result).toEqual({
      ok: true,
      models: [
        { slug: "gpt-6-astra", display_name: "GPT-6-Astra" },
        { slug: "o3", display_name: "O3" },
      ],
    });
  });

  it("is not-ok (never throws) when the run override REJECTS (external code-review fix)", async () => {
    const result = await runCodexModelsProbe({ run: () => Promise.reject(new Error("ENOENT")) });
    expect(result).toEqual({ ok: false, models: [] });
  });

  it("de-duplicates a repeated slug, first-wins (doubt-review fix)", async () => {
    const sample = JSON.stringify({
      models: [
        { slug: "gpt-5.5", display_name: "GPT-5.5 (first)", visibility: "list" },
        { slug: "gpt-5.5", display_name: "GPT-5.5 (duplicate)", visibility: "list" },
      ],
    });
    const result = await runCodexModelsProbe({ run: run({ stdout: sample }) });
    expect(result).toEqual({ ok: true, models: [{ slug: "gpt-5.5", display_name: "GPT-5.5 (first)" }] });
  });

  it("defaults to defaultRunShim when no run override is passed", async () => {
    // Smoke-checks the wiring only (real spawn would ENOENT in CI without
    // codex installed) — asserts the function is callable with no deps and
    // resolves to a well-shaped, never-throwing result either way.
    const result = await runCodexModelsProbe({});
    expect(result).toHaveProperty("ok");
    expect(Array.isArray(result.models)).toBe(true);
  });
});
