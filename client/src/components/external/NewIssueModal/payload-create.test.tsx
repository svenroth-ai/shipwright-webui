/*
 * Bit-perfect createTask POST body shape per mode.
 *
 * Cleanup-invariant boundary for C4. Assertions use `in`/`hasOwnProperty`
 * for omission semantics (Step 3.5 review OpenAI #9 — "verify omission,
 * not just deep-equal").
 *
 * Modes covered: new-task / new-pipeline / new-iterate / new-plain / generic.
 * Step 3.7 review OpenAI #4 required per-mode coverage including omission.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, act, cleanup, waitFor } from "@testing-library/react";

import {
  GENERIC_ACTION,
  ITERATE_ACTION,
  PIPELINE_ACTION,
  PLAIN_ACTION,
  SAMPLE_ACTIONS,
  TASK_ACTION,
  makeFetchMock,
  renderModal,
} from "./__testFixtures";
import type { ResolvedProjectActions } from "../../../lib/externalApi";

beforeEach(() => {
  if (typeof window !== "undefined" && window.sessionStorage)
    window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("createTask POST body — bit-perfect (Step 3.5 OpenAI #9)", () => {
  it("Save-to-Backlog body has exact keys for new-task mode", async () => {
    const cap: { body?: string } = {};
    globalThis.fetch = makeFetchMock({ captureCreate: cap }) as unknown as typeof fetch;
    const onOpenChange = vi.fn();
    renderModal({ onOpenChange, onToast: () => {} });
    await act(async () => {
      fireEvent.change(screen.getByTestId("new-issue-title-input"), {
        target: { value: "Hello" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("new-issue-save-btn"));
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const parsed = JSON.parse(cap.body!);
    expect(parsed.title).toBe("Hello");
    expect(parsed.cwd).toBe("/tmp/demo");
    expect(parsed.pluginDirs).toEqual([]);
    expect(parsed.projectId).toBe("proj-1");
    expect(parsed.actionId).toBe("new-task");
    expect(parsed.phase).toBe("build");
    expect("description" in parsed).toBe(false);
    expect("domain" in parsed).toBe(false);
    expect("priority" in parsed).toBe(false);
    expect("tags" in parsed).toBe(false);
    expect("complexityHint" in parsed).toBe(false);
    expect("blockedBy" in parsed).toBe(false);
  });

  it("Pipeline Save omits the `phase` key entirely", async () => {
    const cap: { body?: string } = {};
    globalThis.fetch = makeFetchMock({ captureCreate: cap }) as unknown as typeof fetch;
    renderModal({ action: PIPELINE_ACTION, onToast: () => {} });
    await act(async () => {
      fireEvent.change(screen.getByTestId("new-issue-title-input"), {
        target: { value: "Pipeline run" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("new-issue-save-btn"));
    });
    await waitFor(() => expect(cap.body).toBeTruthy());
    const parsed = JSON.parse(cap.body!);
    expect("phase" in parsed).toBe(false);
    expect(parsed.actionId).toBe("new-pipeline");
  });

  it("Iterate Save threads description into create body", async () => {
    const cap: { body?: string } = {};
    globalThis.fetch = makeFetchMock({ captureCreate: cap }) as unknown as typeof fetch;
    renderModal({ action: ITERATE_ACTION, onToast: () => {} });
    await act(async () => {
      fireEvent.change(screen.getByTestId("new-issue-title-input"), {
        target: { value: "Iterate step" },
      });
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId("new-issue-description-input"), {
        target: { value: "the brief" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("new-issue-save-btn"));
    });
    await waitFor(() => expect(cap.body).toBeTruthy());
    const parsed = JSON.parse(cap.body!);
    expect(parsed.description).toBe("the brief");
    expect(parsed.actionId).toBe("new-iterate");
    expect("phase" in parsed).toBe(false);
  });

  it("Plain Save body has actionId=new-plain, no phase, no leadwright keys", async () => {
    const cap: { body?: string } = {};
    globalThis.fetch = makeFetchMock({ captureCreate: cap }) as unknown as typeof fetch;
    renderModal({ action: PLAIN_ACTION, onToast: () => {} });
    await act(async () => {
      fireEvent.change(screen.getByTestId("new-issue-title-input"), {
        target: { value: "Plain run" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("new-issue-save-btn"));
    });
    await waitFor(() => expect(cap.body).toBeTruthy());
    const parsed = JSON.parse(cap.body!);
    expect(parsed.actionId).toBe("new-plain");
    expect(parsed.title).toBe("Plain run");
    expect("phase" in parsed).toBe(false);
    expect("description" in parsed).toBe(false);
    expect("autonomy" in parsed).toBe(false);
    expect("domain" in parsed).toBe(false);
    expect("priority" in parsed).toBe(false);
    expect("tags" in parsed).toBe(false);
  });

  it("Generic Save body posts the real action.id + no phase", async () => {
    const cap: { body?: string } = {};
    globalThis.fetch = makeFetchMock({ captureCreate: cap }) as unknown as typeof fetch;
    renderModal({
      action: GENERIC_ACTION,
      projectActions: {
        ...SAMPLE_ACTIONS,
        actions: [TASK_ACTION, GENERIC_ACTION],
      },
      onToast: () => {},
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId("new-issue-title-input"), {
        target: { value: "Custom save" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("new-issue-save-btn"));
    });
    await waitFor(() => expect(cap.body).toBeTruthy());
    const parsed = JSON.parse(cap.body!);
    expect(parsed.actionId).toBe("new-content-orchestrator");
    expect("phase" in parsed).toBe(false);
  });

  it("Save with leadwright fields posts normalised tags + blockedBy arrays", async () => {
    const TASK_WITH_LEAD = {
      ...TASK_ACTION,
      modal_fields: [
        "title",
        "phase",
        "description",
        "domain",
        "priority",
        "complexityHint",
        "tags",
        "blockedBy",
      ],
    };
    const ACTIONS_WITH_LEAD: ResolvedProjectActions = {
      ...SAMPLE_ACTIONS,
      actions: [TASK_WITH_LEAD, PIPELINE_ACTION],
    };
    const cap: { body?: string } = {};
    globalThis.fetch = makeFetchMock({ captureCreate: cap }) as unknown as typeof fetch;
    renderModal({
      action: TASK_WITH_LEAD,
      projectActions: ACTIONS_WITH_LEAD,
      onToast: () => {},
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId("new-issue-title-input"), {
        target: { value: "lead task" },
      });
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId("new-issue-tags-input"), {
        target: { value: "auth, billing ,  ,empty-trims" },
      });
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId("new-issue-blocked-by-input"), {
        target: { value: "task-x, task-y" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("new-issue-save-btn"));
    });
    await waitFor(() => expect(cap.body).toBeTruthy());
    const parsed = JSON.parse(cap.body!);
    expect(parsed.tags).toEqual(["auth", "billing", "empty-trims"]);
    expect(parsed.blockedBy).toEqual(["task-x", "task-y"]);
    expect("domain" in parsed).toBe(false);
    expect("priority" in parsed).toBe(false);
    expect("complexityHint" in parsed).toBe(false);
  });
});
