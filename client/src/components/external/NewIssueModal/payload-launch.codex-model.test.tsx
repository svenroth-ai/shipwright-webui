/*
 * payload-launch.codex-model.test.tsx —
 * iterate-2026-09-17-codex-model-tier-parameterization.
 *
 * Split out of payload-launch.test.tsx (which crossed the 300-LOC
 * guideline) rather than grown in place. Proves the exact chain the
 * external plan review flagged as the critical, easy-to-silently-break
 * integration point: runtime toggle → selected value → launch request body.
 * ModelTierOverrideFields renders only in NewIterateModal (new-iterate
 * mode), collapsed inside "More options" — hence ITERATE_ACTION +
 * openMoreOptions() here, unlike payload-launch.test.tsx's default
 * TASK_ACTION fixture.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, act, cleanup, waitFor } from "@testing-library/react";

import {
  ITERATE_ACTION,
  makeFetchMock,
  openMoreOptions,
  renderModal,
} from "./__testFixtures";

beforeEach(() => {
  if (typeof window !== "undefined" && window.sessionStorage)
    window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("launchExternalTask POST body — codexImplementationModel (removed field, iterate-2026-09-26)", () => {
  it("never renders an Implementation-model field for a Codex-runtime launch", async () => {
    globalThis.fetch = makeFetchMock({}) as unknown as typeof fetch;
    renderModal({ action: ITERATE_ACTION, onToast: () => {} });
    openMoreOptions();
    await act(async () => {
      fireEvent.click(screen.getByTestId("runtime-codex"));
    });
    await screen.findByTestId("model-tier-override-codex-plan-review-model");
    expect(
      screen.queryByTestId("model-tier-override-codex-implementation-model"),
    ).toBeNull();
  });

  it("never sends codexImplementationModel in the launch body for a Codex-runtime launch", async () => {
    const cap: { body?: string } = {};
    globalThis.fetch = makeFetchMock({ captureLaunch: cap }) as unknown as typeof fetch;
    renderModal({ action: ITERATE_ACTION, onToast: () => {} });
    await act(async () => {
      fireEvent.change(screen.getByTestId("new-issue-title-input"), {
        target: { value: "Launch me" },
      });
    });
    openMoreOptions();
    await act(async () => {
      fireEvent.click(screen.getByTestId("runtime-codex"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("new-issue-launch-btn"));
    });
    await waitFor(() => expect(cap.body).toBeTruthy());
    const parsed = JSON.parse(cap.body!);
    expect("codexImplementationModel" in parsed).toBe(false);
  });
});

describe("launchExternalTask POST body — codexPlanReviewModel / codexReviewModel", () => {
  it("threads selected Plan review / Review overrides through to the launch body", async () => {
    const cap: { body?: string } = {};
    globalThis.fetch = makeFetchMock({ captureLaunch: cap }) as unknown as typeof fetch;
    renderModal({ action: ITERATE_ACTION, onToast: () => {} });
    await act(async () => {
      fireEvent.change(screen.getByTestId("new-issue-title-input"), {
        target: { value: "Launch me" },
      });
    });
    openMoreOptions();
    await act(async () => {
      fireEvent.click(screen.getByTestId("runtime-codex"));
    });
    const planReviewField = await screen.findByTestId(
      "model-tier-override-codex-plan-review-model",
    );
    const reviewField = screen.getByTestId("model-tier-override-codex-review-model");
    await act(async () => {
      fireEvent.change(planReviewField, { target: { value: "gpt-5.6-terra" } });
      fireEvent.change(reviewField, { target: { value: "gpt-5.6-sol" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("new-issue-launch-btn"));
    });
    await waitFor(() => expect(cap.body).toBeTruthy());
    const parsed = JSON.parse(cap.body!);
    expect(parsed.codexPlanReviewModel).toBe("gpt-5.6-terra");
    expect(parsed.codexReviewModel).toBe("gpt-5.6-sol");
  });

  it("omits codexPlanReviewModel/codexReviewModel from the launch body when unset", async () => {
    const cap: { body?: string } = {};
    globalThis.fetch = makeFetchMock({ captureLaunch: cap }) as unknown as typeof fetch;
    renderModal({ action: ITERATE_ACTION, onToast: () => {} });
    await act(async () => {
      fireEvent.change(screen.getByTestId("new-issue-title-input"), {
        target: { value: "Launch me" },
      });
    });
    openMoreOptions();
    await act(async () => {
      fireEvent.click(screen.getByTestId("runtime-codex"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("new-issue-launch-btn"));
    });
    await waitFor(() => expect(cap.body).toBeTruthy());
    const parsed = JSON.parse(cap.body!);
    expect("codexPlanReviewModel" in parsed).toBe(false);
    expect("codexReviewModel" in parsed).toBe(false);
  });

  it("does not send review-model overrides for a Claude-runtime launch even if the keys exist in paramValues", async () => {
    const cap: { body?: string } = {};
    globalThis.fetch = makeFetchMock({ captureLaunch: cap }) as unknown as typeof fetch;
    renderModal({ action: ITERATE_ACTION, onToast: () => {} });
    await act(async () => {
      fireEvent.change(screen.getByTestId("new-issue-title-input"), {
        target: { value: "Launch me" },
      });
    });
    openMoreOptions();
    await act(async () => {
      fireEvent.click(screen.getByTestId("runtime-codex"));
    });
    const planReviewField = await screen.findByTestId(
      "model-tier-override-codex-plan-review-model",
    );
    await act(async () => {
      fireEvent.change(planReviewField, { target: { value: "gpt-5.6-terra" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("runtime-claude"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("new-issue-launch-btn"));
    });
    await waitFor(() => expect(cap.body).toBeTruthy());
    const parsed = JSON.parse(cap.body!);
    expect("codexPlanReviewModel" in parsed).toBe(false);
    expect("codexReviewModel" in parsed).toBe(false);
  });
});
