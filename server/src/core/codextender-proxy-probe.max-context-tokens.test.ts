/*
 * codextender-proxy-probe.max-context-tokens.test.ts — operator finding
 * (2026-09-26): Claude Code assumes a 200K context window for any model id
 * it doesn't recognize (the Codex alias) and over-compacts against that
 * wrong ceiling. Covers `max_input_tokens` parsing (including the PR-review
 * preflight BLOCK, round 14: the field lives NESTED under each entry's
 * `model_info` object on a real LiteLLM proxy, not flat/top-level) and
 * `resolveCodextenderMaxContextTokens` — split out of
 * codextender-proxy-probe.test.ts (bloat anti-ratchet) as its own concern.
 */

import { describe, it, expect, vi } from "vitest";

import {
  probeCodextenderModels,
  resolveCodextenderMaxContextTokens,
} from "./codextender-proxy-probe.js";
import { DEFAULT_CODEXTENDER_MODEL_ALIAS } from "./launcher-codextender.js";

const FIXTURE_TOKEN = "test-fixture-token";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

describe("probeCodextenderModels — max_input_tokens", () => {
  it("PR-review preflight BLOCK (round 14, 2026-09-26) — carries a valid max_input_tokens through to the entry from LiteLLM's real, NESTED model_info shape", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ data: [{ id: "sol", model_info: { max_input_tokens: 1_050_000 } }] }),
    ) as unknown as typeof fetch;
    const result = await probeCodextenderModels(4000, { fetchFn, authToken: FIXTURE_TOKEN });
    expect(result).toEqual({
      ok: true,
      models: [{ slug: "sol", display_name: "sol", max_input_tokens: 1_050_000 }],
    });
  });

  it("forward-compat fallback — also accepts a flat, top-level max_input_tokens (in case a future proxy version flattens it)", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ data: [{ id: "sol", max_input_tokens: 1_050_000 }] }),
    ) as unknown as typeof fetch;
    const result = await probeCodextenderModels(4000, { fetchFn, authToken: FIXTURE_TOKEN });
    expect(result).toEqual({
      ok: true,
      models: [{ slug: "sol", display_name: "sol", max_input_tokens: 1_050_000 }],
    });
  });

  it("prefers the nested model_info.max_input_tokens over a flat one when both are somehow present", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        data: [{ id: "sol", max_input_tokens: 999, model_info: { max_input_tokens: 1_050_000 } }],
      }),
    ) as unknown as typeof fetch;
    const result = await probeCodextenderModels(4000, { fetchFn, authToken: FIXTURE_TOKEN });
    expect(result.models[0]?.max_input_tokens).toBe(1_050_000);
  });

  it("operator finding (2026-09-26) — drops a non-positive/non-integer/non-numeric max_input_tokens (nested or flat) rather than passing through a bogus value", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        data: [
          { id: "zero", model_info: { max_input_tokens: 0 } },
          { id: "negative", model_info: { max_input_tokens: -5 } },
          { id: "fraction", model_info: { max_input_tokens: 1000.5 } },
          { id: "string", model_info: { max_input_tokens: "1050000" } },
          { id: "flat-string", max_input_tokens: "1050000" },
          { id: "no-model-info" },
          { id: "empty-model-info", model_info: {} },
          { id: "non-object-model-info", model_info: "nope" },
        ],
      }),
    ) as unknown as typeof fetch;
    const result = await probeCodextenderModels(4000, { fetchFn, authToken: FIXTURE_TOKEN });
    expect(result.ok).toBe(true);
    for (const entry of result.models) {
      expect(entry.max_input_tokens).toBeUndefined();
    }
  });
});

describe("resolveCodextenderMaxContextTokens", () => {
  it("operator finding (2026-09-26) — resolves the selected alias's max_input_tokens (nested model_info shape)", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        data: [
          { id: "sol", model_info: { max_input_tokens: 1_050_000 } },
          { id: "astra", model_info: { max_input_tokens: 500_000 } },
        ],
      }),
    ) as unknown as typeof fetch;
    await expect(
      resolveCodextenderMaxContextTokens(4000, "astra", { fetchFn, authToken: FIXTURE_TOKEN }),
    ).resolves.toBe(500_000);
  });

  it("operator finding (2026-09-26) — defaults to DEFAULT_CODEXTENDER_MODEL_ALIAS when no model is given, mirroring buildCodextenderCommands", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        data: [
          {
            id: DEFAULT_CODEXTENDER_MODEL_ALIAS,
            model_info: { max_input_tokens: 1_050_000 },
          },
        ],
      }),
    ) as unknown as typeof fetch;
    await expect(
      resolveCodextenderMaxContextTokens(4000, undefined, { fetchFn, authToken: FIXTURE_TOKEN }),
    ).resolves.toBe(1_050_000);
  });

  it("operator finding (2026-09-26) — resolves undefined (never throws, never guesses) when the probe fails", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, false)) as unknown as typeof fetch;
    await expect(
      resolveCodextenderMaxContextTokens(4000, "sol", { fetchFn, authToken: FIXTURE_TOKEN }),
    ).resolves.toBeUndefined();
  });

  it("operator finding (2026-09-26) — resolves undefined when the selected alias isn't in the response", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ data: [{ id: "astra", model_info: { max_input_tokens: 500_000 } }] }),
    ) as unknown as typeof fetch;
    await expect(
      resolveCodextenderMaxContextTokens(4000, "sol", { fetchFn, authToken: FIXTURE_TOKEN }),
    ).resolves.toBeUndefined();
  });

  it("operator finding (2026-09-26) — resolves undefined when the matching entry carries no usable max_input_tokens (older/unpatched proxy)", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ data: [{ id: "sol" }] }),
    ) as unknown as typeof fetch;
    await expect(
      resolveCodextenderMaxContextTokens(4000, "sol", { fetchFn, authToken: FIXTURE_TOKEN }),
    ).resolves.toBeUndefined();
  });
});
