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

  it("Runtime=Codex shows the reviewer-identity block, read-only, sourced from project config", async () => {
    const { qc } = renderModal({
      action: { ...ITERATE_ACTION, parameters: CLAUDE_TIER_PARAMS },
    });
    qc.setQueryData(["model-tier-config", "proj-1"], {
      tiers: {
        plan_review: { tier: "inherit", source: "unset" },
        review: { tier: "inherit", source: "unset" },
        finalization: { tier: "inherit", source: "unset" },
        execution: { tier: "inherit", source: "unset" },
      },
      codex: { codex_review: "gpt-5.6-sol", codex_plan_review: "gpt-5.6-terra" },
    });
    openMoreOptions();
    fireEvent.click(screen.getByTestId("runtime-codex"));
    await screen.findByTestId("model-tier-override-codex-implementation-model");
    expect(screen.getByTestId("codex-reviewer-identity-plan-review")).toHaveTextContent(
      "gpt-5.6-terra",
    );
    expect(screen.getByTestId("codex-reviewer-identity-review")).toHaveTextContent(
      "gpt-5.6-sol",
    );
    // Read-only — no input/select inside the block.
    expect(
      screen.getByTestId("codex-reviewer-identity").querySelector("input, select"),
    ).toBeNull();
  });

  it("reviewer-identity block falls back to an honest 'not configured' status when the project has no codex_review/codex_plan_review keys", async () => {
    const { qc } = renderModal({
      action: { ...ITERATE_ACTION, parameters: CLAUDE_TIER_PARAMS },
    });
    qc.setQueryData(["model-tier-config", "proj-1"], {
      tiers: {
        plan_review: { tier: "inherit", source: "unset" },
        review: { tier: "inherit", source: "unset" },
        finalization: { tier: "inherit", source: "unset" },
        execution: { tier: "inherit", source: "unset" },
      },
    });
    openMoreOptions();
    fireEvent.click(screen.getByTestId("runtime-codex"));
    await screen.findByTestId("model-tier-override-codex-implementation-model");
    expect(screen.getByTestId("codex-reviewer-identity-plan-review")).toHaveTextContent(
      "Codex default (not configured)",
    );
    expect(screen.getByTestId("codex-reviewer-identity-review")).toHaveTextContent(
      "Codex default (not configured)",
    );
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
