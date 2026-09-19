/*
 * NewIterateModal.codex-model.test.tsx —
 * iterate-2026-09-17-codex-model-tier-parameterization, revised 2026-09-18
 * after shipwright#771.
 *
 * Split out of NewIterateModal.test.tsx (which crossed the 300-LOC
 * guideline) rather than grown in place — same pattern as
 * payload-launch.codex-model.test.tsx / runtime-chokepoint.model-override.
 * test.ts elsewhere in this iterate.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { fireEvent, screen, waitFor, cleanup } from "@testing-library/react";

import { ITERATE_ACTION, openMoreOptions, renderModal } from "./__testFixtures";

const CLAUDE_TIER_PARAMS = ["plan-review-model", "review-model"].map((name) => ({
  name,
  type: "enum" as const,
  label: `${name} override`,
  enum: ["opus", "sonnet", "haiku", "inherit"],
  cli_flag: `--${name}`,
  value_separator: "space" as const,
}));

beforeEach(() => {
  if (typeof window !== "undefined" && window.sessionStorage)
    window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("NewIterateModal — Codex model override (post-#771)", () => {
  it("Runtime=Codex shows the Implementation-model free-text field in the same slot", async () => {
    renderModal({ action: { ...ITERATE_ACTION, parameters: CLAUDE_TIER_PARAMS } });
    openMoreOptions();
    fireEvent.click(screen.getByTestId("runtime-codex"));
    const field = await screen.findByTestId(
      "model-tier-override-codex-implementation-model",
    );
    expect(field).toBeTruthy();
    expect(field.tagName).toBe("INPUT");
    expect(field).toHaveValue("");
    expect(field).toHaveAttribute(
      "placeholder",
      "Suggested policy (AGENTS.md) — gpt-5.6-terra",
    );
    expect(screen.queryByTestId("codex-implementation-model-hint")).toBeNull();

    fireEvent.change(field, { target: { value: "has space" } });
    expect(
      await screen.findByTestId("codex-implementation-model-hint"),
    ).toBeTruthy();

    fireEvent.change(field, { target: { value: "gpt-5.6-luna" } });
    expect(screen.queryByTestId("codex-implementation-model-hint")).toBeNull();
  });

  it("Runtime=Codex shows real free-text Plan review / Review overrides, not a read-only identity block", async () => {
    renderModal({ action: { ...ITERATE_ACTION, parameters: CLAUDE_TIER_PARAMS } });
    openMoreOptions();
    fireEvent.click(screen.getByTestId("runtime-codex"));
    await screen.findByTestId("model-tier-override-codex-implementation-model");

    expect(screen.queryByTestId("codex-reviewer-identity")).toBeNull();

    const planReviewField = screen.getByTestId(
      "model-tier-override-codex-plan-review-model",
    );
    const reviewField = screen.getByTestId("model-tier-override-codex-review-model");
    expect(planReviewField.tagName).toBe("INPUT");
    expect(reviewField.tagName).toBe("INPUT");
    expect(planReviewField).toHaveValue("");
    expect(reviewField).toHaveValue("");

    fireEvent.change(planReviewField, { target: { value: "gpt-5.6-terra" } });
    fireEvent.change(reviewField, { target: { value: "gpt-5.6-sol" } });
    expect(planReviewField).toHaveValue("gpt-5.6-terra");
    expect(reviewField).toHaveValue("gpt-5.6-sol");
  });

  it("Plan review / Review inputs show the same invalid-shape hint as Implementation model", async () => {
    renderModal({ action: { ...ITERATE_ACTION, parameters: CLAUDE_TIER_PARAMS } });
    openMoreOptions();
    fireEvent.click(screen.getByTestId("runtime-codex"));
    const reviewField = await screen.findByTestId(
      "model-tier-override-codex-review-model",
    );
    expect(screen.queryByTestId("codex-review-model-hint")).toBeNull();
    fireEvent.change(reviewField, { target: { value: "has space" } });
    expect(await screen.findByTestId("codex-review-model-hint")).toBeTruthy();
    fireEvent.change(reviewField, { target: { value: "gpt-5.6-sol" } });
    expect(screen.queryByTestId("codex-review-model-hint")).toBeNull();
  });

  it("Runtime=Codex populates the shared datalist from a successful /api/codex-models fetch, free text still accepted", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/codex-models")) {
        return new Response(
          JSON.stringify({
            status: "ok",
            models: [{ slug: "gpt-5.6-sol", display_name: "GPT-5.6-Sol" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      renderModal({ action: { ...ITERATE_ACTION, parameters: CLAUDE_TIER_PARAMS } });
      openMoreOptions();
      fireEvent.click(screen.getByTestId("runtime-codex"));
      const field = await screen.findByTestId(
        "model-tier-override-codex-implementation-model",
      );
      await waitFor(() => {
        const datalistId = field.getAttribute("list");
        expect(datalistId).toBeTruthy();
        const option = document.querySelector(
          `#${CSS.escape(datalistId as string)} option[value="gpt-5.6-sol"]`,
        );
        expect(option).toBeTruthy();
      });
      expect(screen.queryByTestId("codex-model-catalog-status")).toBeNull();
      // Free text is still accepted regardless of the catalog contents.
      fireEvent.change(field, { target: { value: "my-custom-slug" } });
      expect(field).toHaveValue("my-custom-slug");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("Runtime=Codex shows an 'unavailable' caption when the catalog probe has no data, without blocking typing", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/codex-models")) {
        return new Response(JSON.stringify({ status: "unavailable", models: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      renderModal({ action: { ...ITERATE_ACTION, parameters: CLAUDE_TIER_PARAMS } });
      openMoreOptions();
      fireEvent.click(screen.getByTestId("runtime-codex"));
      const field = await screen.findByTestId(
        "model-tier-override-codex-implementation-model",
      );
      expect(
        await screen.findByTestId("codex-model-catalog-status"),
      ).toHaveTextContent("Model suggestions unavailable");
      fireEvent.change(field, { target: { value: "gpt-5.6-luna" } });
      expect(field).toHaveValue("gpt-5.6-luna");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("Runtime=Claude (toggled back from Codex) shows the Claude fields again, unchanged", async () => {
    renderModal({ action: { ...ITERATE_ACTION, parameters: CLAUDE_TIER_PARAMS } });
    openMoreOptions();
    fireEvent.click(screen.getByTestId("runtime-codex"));
    await screen.findByTestId("model-tier-override-codex-implementation-model");
    fireEvent.click(screen.getByTestId("runtime-claude"));
    await waitFor(() =>
      expect(screen.getByTestId("model-tier-override-plan-review-model")).toBeTruthy(),
    );
    expect(
      screen.queryByTestId("model-tier-override-codex-implementation-model"),
    ).toBeNull();
  });
});
