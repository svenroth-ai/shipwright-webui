/*
 * ModelTierOverrideFields.codextender.test.tsx — Codextender integration
 * Part B.5: when `settings.codexIntegrationMode === "codextender"`, the
 * Codex-runtime model fields source their datalist from `/api/codextender-
 * models` instead of `/api/codex-models`, and fall back to the static
 * sol/astra suggestions (not an empty list) on an unreachable proxy.
 *
 * Same `renderModal`/`openMoreOptions` fixture pattern as
 * NewIterateModal.codex-model.test.tsx (the Codex Light sibling coverage).
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { fireEvent, screen, waitFor, cleanup } from "@testing-library/react";

import { ITERATE_ACTION, openMoreOptions, renderModal } from "./__testFixtures";

function mockFetch(
  handlers: Record<string, () => Response>,
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [match, respond] of Object.entries(handlers)) {
      if (url.includes(match)) return respond();
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
}

const settingsResponse = (body: Record<string, unknown>) => () =>
  new Response(JSON.stringify({ data: body }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  if (typeof window !== "undefined" && window.sessionStorage) window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ModelTierOverrideFields — Codextender mode (Part B.5)", () => {
  it("populates the shared datalist from a successful /api/codextender-models fetch", async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetch({
      "/api/settings": settingsResponse({ codexIntegrationMode: "codextender" }),
      "/api/codextender-models": () =>
        new Response(
          JSON.stringify({ status: "ok", models: [{ slug: "astra", display_name: "astra" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    });
    try {
      renderModal({ action: { ...ITERATE_ACTION } });
      openMoreOptions();
      fireEvent.click(screen.getByTestId("runtime-codex"));
      const field = await screen.findByTestId(
        "model-tier-override-codex-implementation-model",
      );
      await waitFor(() => expect(field).toHaveAttribute("placeholder", "e.g. sol"));
      await waitFor(() => {
        const datalistId = field.getAttribute("list");
        const option = document.querySelector(
          `#${CSS.escape(datalistId as string)} option[value="astra"]`,
        );
        expect(option).toBeTruthy();
      });
      expect(screen.queryByTestId("codextender-model-catalog-status")).toBeNull();
      expect(screen.queryByTestId("codex-model-catalog-status")).toBeNull();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("falls back to the static sol/astra suggestions (not an empty list) when the proxy is unreachable", async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetch({
      "/api/settings": settingsResponse({ codexIntegrationMode: "codextender" }),
      "/api/codextender-models": () =>
        new Response(JSON.stringify({ status: "unavailable", models: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });
    try {
      renderModal({ action: { ...ITERATE_ACTION } });
      openMoreOptions();
      fireEvent.click(screen.getByTestId("runtime-codex"));
      const field = await screen.findByTestId(
        "model-tier-override-codex-implementation-model",
      );
      await waitFor(() => {
        const datalistId = field.getAttribute("list");
        const solOption = document.querySelector(
          `#${CSS.escape(datalistId as string)} option[value="sol"]`,
        );
        const astraOption = document.querySelector(
          `#${CSS.escape(datalistId as string)} option[value="astra"]`,
        );
        expect(solOption).toBeTruthy();
        expect(astraOption).toBeTruthy();
      });
      expect(
        await screen.findByTestId("codextender-model-catalog-status"),
      ).toHaveTextContent("Codextender proxy isn't reachable");
      // Free text is still accepted regardless of the fallback suggestions.
      fireEvent.change(field, { target: { value: "my-custom-slug" } });
      expect(field).toHaveValue("my-custom-slug");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("disables the review-model fields under Codextender and explains why, instead of silently dropping them", async () => {
    // iterate-2026-09-24-codextender-review-model-disable — post-merge gap:
    // `buildCodextenderCommands` (launcher-codextender.ts) never reads a
    // plan-review/review model override, so whatever an operator typed here
    // was silently dropped at launch. The fields are disabled (not hidden)
    // rather than removed.
    const originalFetch = global.fetch;
    global.fetch = mockFetch({
      "/api/settings": settingsResponse({ codexIntegrationMode: "codextender" }),
      "/api/codextender-models": () =>
        new Response(
          JSON.stringify({ status: "ok", models: [{ slug: "astra", display_name: "astra" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    });
    try {
      renderModal({ action: { ...ITERATE_ACTION } });
      openMoreOptions();
      fireEvent.click(screen.getByTestId("runtime-codex"));
      const planReviewField = await screen.findByTestId(
        "model-tier-override-codex-plan-review-model",
      );
      const reviewField = screen.getByTestId("model-tier-override-codex-review-model");
      await waitFor(() => expect(planReviewField).toBeDisabled());
      expect(reviewField).toBeDisabled();
      // The implementation-model field is unaffected — it IS wired through
      // to Codextender (`buildCodextenderCommands`'s `model` arg).
      expect(
        screen.getByTestId("model-tier-override-codex-implementation-model"),
      ).toBeEnabled();
      expect(
        await screen.findByTestId("codextender-review-inherit-note"),
      ).toHaveTextContent("Reviews automatically follow the main model under Codextender.");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("leaves the review-model fields enabled, with no inherit note, in Codex Light mode", async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetch({
      "/api/settings": settingsResponse({ codexIntegrationMode: "light" }),
      "/api/codex-models": () =>
        new Response(JSON.stringify({ status: "ok", models: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });
    try {
      renderModal({ action: { ...ITERATE_ACTION } });
      openMoreOptions();
      fireEvent.click(screen.getByTestId("runtime-codex"));
      const planReviewField = await screen.findByTestId(
        "model-tier-override-codex-plan-review-model",
      );
      const reviewField = screen.getByTestId("model-tier-override-codex-review-model");
      expect(planReviewField).toBeEnabled();
      expect(reviewField).toBeEnabled();
      expect(screen.queryByTestId("codextender-review-inherit-note")).toBeNull();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("Codex Light mode (default) never calls /api/codextender-models", async () => {
    const codextenderCalls: string[] = [];
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/codextender-models")) codextenderCalls.push(url);
      if (url.includes("/api/codex-models")) {
        return new Response(JSON.stringify({ status: "ok", models: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      renderModal({ action: { ...ITERATE_ACTION } });
      openMoreOptions();
      fireEvent.click(screen.getByTestId("runtime-codex"));
      const field = await screen.findByTestId(
        "model-tier-override-codex-implementation-model",
      );
      await waitFor(() => {
        const datalistId = field.getAttribute("list");
        expect(datalistId).toBeTruthy();
      });
      expect(codextenderCalls).toHaveLength(0);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
