/*
 * Bit-perfect launchExternalTask POST body shape per mode + sessionStorage
 * handoff. Step 3.7 review OpenAI #4 — exhaustive per-mode coverage.
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

describe("launchExternalTask POST body — bit-perfect", () => {
  it("new-task Launch body has actionId+phase+phaseLabel+autonomy when phase supports it", async () => {
    const cap: { body?: string } = {};
    const PHASES_WITH_AUTONOMY: ResolvedProjectActions = {
      ...SAMPLE_ACTIONS,
      phases: [
        { id: "build", label: "Build", supports_autonomy: true },
        { id: "design", label: "Design" },
      ],
    };
    globalThis.fetch = makeFetchMock({ captureLaunch: cap }) as unknown as typeof fetch;
    renderModal({
      action: TASK_ACTION,
      projectActions: PHASES_WITH_AUTONOMY,
      onToast: () => {},
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId("new-issue-title-input"), {
        target: { value: "Launch me" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("new-issue-launch-btn"));
    });
    await waitFor(() => expect(cap.body).toBeTruthy());
    const parsed = JSON.parse(cap.body!);
    expect(parsed.actionId).toBe("new-task");
    expect(parsed.phase).toBe("build");
    expect(parsed.phaseLabel).toBe("Build");
    expect(parsed.autonomy).toBe("guided");
    expect("parameters" in parsed).toBe(false);
    expect("description" in parsed).toBe(false);
  });

  it("Pipeline Launch body has autonomy but no phase/phaseLabel", async () => {
    const cap: { body?: string } = {};
    globalThis.fetch = makeFetchMock({ captureLaunch: cap }) as unknown as typeof fetch;
    renderModal({ action: PIPELINE_ACTION, onToast: () => {} });
    await act(async () => {
      fireEvent.change(screen.getByTestId("new-issue-title-input"), {
        target: { value: "Launch pipeline" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("new-issue-launch-btn"));
    });
    await waitFor(() => expect(cap.body).toBeTruthy());
    const parsed = JSON.parse(cap.body!);
    expect(parsed.actionId).toBe("new-pipeline");
    expect(parsed.autonomy).toBe("guided");
    expect("phase" in parsed).toBe(false);
    expect("phaseLabel" in parsed).toBe(false);
  });

  it("Iterate Launch body threads description (memory project_launch_description_needs_actionid)", async () => {
    const cap: { body?: string } = {};
    globalThis.fetch = makeFetchMock({ captureLaunch: cap }) as unknown as typeof fetch;
    renderModal({ action: ITERATE_ACTION, onToast: () => {} });
    await act(async () => {
      fireEvent.change(screen.getByTestId("new-issue-title-input"), {
        target: { value: "Iterate step" },
      });
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId("new-issue-description-input"), {
        target: { value: "iterate brief" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("new-issue-launch-btn"));
    });
    await waitFor(() => expect(cap.body).toBeTruthy());
    const parsed = JSON.parse(cap.body!);
    expect(parsed.actionId).toBe("new-iterate");
    expect(parsed.description).toBe("iterate brief");
    expect(parsed.autonomy).toBe("guided");
    expect("phase" in parsed).toBe(false);
  });

  it("Plain Launch body has actionId=new-plain only (no autonomy/phase/parameters)", async () => {
    const cap: { body?: string } = {};
    globalThis.fetch = makeFetchMock({ captureLaunch: cap }) as unknown as typeof fetch;
    renderModal({ action: PLAIN_ACTION, onToast: () => {} });
    await act(async () => {
      fireEvent.change(screen.getByTestId("new-issue-title-input"), {
        target: { value: "Plain launch" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("new-issue-launch-btn"));
    });
    await waitFor(() => expect(cap.body).toBeTruthy());
    const parsed = JSON.parse(cap.body!);
    expect(parsed.actionId).toBe("new-plain");
    expect("phase" in parsed).toBe(false);
    expect("phaseLabel" in parsed).toBe(false);
    expect("autonomy" in parsed).toBe(false);
    expect("parameters" in parsed).toBe(false);
  });

  it("Generic Launch body posts the real action.id (not a mode string)", async () => {
    const cap: { body?: string } = {};
    globalThis.fetch = makeFetchMock({ captureLaunch: cap }) as unknown as typeof fetch;
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
        target: { value: "Custom run" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("new-issue-launch-btn"));
    });
    await waitFor(() => expect(cap.body).toBeTruthy());
    const parsed = JSON.parse(cap.body!);
    expect(parsed.actionId).toBe("new-content-orchestrator");
    expect("phase" in parsed).toBe(false);
    expect("autonomy" in parsed).toBe(false);
  });
});

describe("sessionStorage handoff (ADR-068-A1)", () => {
  it("Launch stores commands+resume+ts under webui:pending-auto-launch:<taskId>", async () => {
    globalThis.fetch = makeFetchMock({ taskId: "tid-99" }) as unknown as typeof fetch;
    renderModal({ onToast: () => {} });
    await act(async () => {
      fireEvent.change(screen.getByTestId("new-issue-title-input"), {
        target: { value: "x" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("new-issue-launch-btn"));
    });
    await waitFor(() => {
      const raw = window.sessionStorage.getItem(
        "webui:pending-auto-launch:tid-99",
      );
      expect(raw).toBeTruthy();
      const decoded = JSON.parse(raw!);
      expect(decoded.resume).toBe(false);
      expect(typeof decoded.ts).toBe("number");
      expect(decoded.commands.powershell).toBe("ps-cmd");
      expect(decoded.commands.cmd).toBe("cmd-cmd");
      expect(decoded.commands.posix).toBe("posix-cmd");
    });
  });
});
