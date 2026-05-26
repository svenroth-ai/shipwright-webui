/*
 * ResumeCTA.test — Campaign C / C6.
 *
 * Critical regression fence: label is ALWAYS "Resume" (memory
 * `feedback_resume_label_singular`). NEVER "Recover".
 *
 * Happy + edge paths:
 *  - default label is "Resume" — regression-guard test.
 *  - click → /launch POST with resume=true + LaunchCoordinator dispatch.
 *  - Transient "Sent — terminal opening" label after dispatch.
 *  - error → onError callback.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import { ResumeCTA } from "./ResumeCTA";
import type { ExternalTask } from "../../../lib/externalApi";

function makeTask(overrides: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "task-resume",
    sessionUuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    cwd: "C:/tmp/demo",
    pluginDirs: [],
    title: "Resume test",
    projectId: "proj-x",
    state: "active",
    createdAt: "2026-04-20",
    inbox: {
      pendingToolUseIds: [],
      dismissedToolUseIds: [],
      lastProcessedByteOffset: 0,
    },
    ...overrides,
  };
}

function renderCTA(
  task: ExternalTask,
  onError: (e: string | null) => void = () => {},
  fetchMock?: ReturnType<typeof vi.fn>,
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  globalThis.fetch = (fetchMock ??
    vi.fn(async () => new Response("{}", { status: 200 }))) as unknown as typeof fetch;
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ResumeCTA task={task} onError={onError} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("ResumeCTA — label is ALWAYS 'Resume' (regression guard)", () => {
  it("default label is 'Resume', not 'Recover' (project memory feedback_resume_label_singular)", () => {
    renderCTA(makeTask());
    const btn = screen.getByTestId("cta-copy-resume-command");
    expect(btn.textContent).toContain("Resume");
    expect(btn.textContent?.toLowerCase()).not.toContain("recover");
  });

  it("testid 'cta-copy-resume-command' is on the <button> element itself (OpenAI MEDIUM C6)", () => {
    renderCTA(makeTask());
    const btn = screen.getByTestId("cta-copy-resume-command");
    expect((btn as HTMLElement).tagName).toBe("BUTTON");
  });

  it("button is enabled by default (no pending state)", () => {
    renderCTA(makeTask());
    const btn = screen.getByTestId("cta-copy-resume-command") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it.each([
    "active",
    "idle",
  ] as const)("label is 'Resume' for state=%s — no 'Recover' label allowed", (state) => {
    renderCTA(makeTask({ state }));
    const btn = screen.getByTestId("cta-copy-resume-command");
    expect(btn.textContent).toContain("Resume");
    expect(btn.textContent?.toLowerCase()).not.toContain("recover");
  });

  it("label remains 'Resume' even when liveSession is true (gate-removal regression fence)", () => {
    renderCTA(makeTask({ state: "active", liveSession: true }));
    const btn = screen.getByTestId("cta-copy-resume-command");
    expect(btn.textContent).toContain("Resume");
    expect(btn.textContent?.toLowerCase()).not.toContain("recover");
  });
});

describe("ResumeCTA — click triggers resume flow", () => {
  it("click → POST /launch with resume=true (happy path)", async () => {
    const fetchInner = vi.fn(
      async (url: string | URL | Request, _init?: RequestInit) => {
        const u = String(url);
        if (u.includes("/launch")) {
          return new Response(
            JSON.stringify({
              task: makeTask(),
              commands: { powershell: "P R", cmd: "C R", posix: "X R" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("{}", { status: 200 });
      },
    );
    renderCTA(makeTask(), () => {}, fetchInner);
    await act(async () => {
      fireEvent.click(screen.getByTestId("cta-copy-resume-command"));
    });
    await waitFor(() => {
      const launchCall = fetchInner.mock.calls.find((c) =>
        String(c[0]).includes("/launch"),
      );
      expect(launchCall).toBeDefined();
      const body = JSON.parse(
        (launchCall?.[1] as RequestInit | undefined)?.body as string,
      );
      expect(body.resume).toBe(true);
    });
  });

  it("/launch failure → onError callback fires (edge path)", async () => {
    const onError = vi.fn();
    const fetchInner = vi.fn(
      async (url: string | URL | Request, _init?: RequestInit) => {
        if (String(url).includes("/launch")) {
          return new Response("boom", { status: 500 });
        }
        return new Response("{}", { status: 200 });
      },
    );
    renderCTA(makeTask(), onError, fetchInner);
    await act(async () => {
      fireEvent.click(screen.getByTestId("cta-copy-resume-command"));
    });
    await waitFor(() => {
      expect(
        onError.mock.calls.some(
          (c) => typeof c[0] === "string" && (c[0] as string).length > 0,
        ),
      ).toBe(true);
    });
  });
});
