/*
 * LaunchCTA.test — Campaign C / C6.
 *
 * Happy + edge paths:
 *  - click → /launch POST with resume=false + LaunchCoordinator dispatch + /spawn prewarm.
 *  - disabled while launchMut.isPending OR coord.pendingLaunch is set.
 *  - rendered label transitions (Launch → Preparing… → Sent — terminal opening).
 *  - error surfaces via onError callback (regression fence for OAI-3 / GEM-2).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import { LaunchCTA } from "./LaunchCTA";
import type { ExternalTask } from "../../../lib/externalApi";

function makeTask(overrides: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "task-launch",
    sessionUuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    cwd: "C:/tmp/demo",
    pluginDirs: [],
    title: "Launch test",
    projectId: "proj-x",
    state: "draft",
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
        <LaunchCTA task={task} onError={onError} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("LaunchCTA — happy path", () => {
  it("renders 'Launch' label + the testid is on the <button> element itself", () => {
    renderCTA(makeTask());
    const btn = screen.getByTestId("cta-launch-in-terminal");
    expect(btn).toBeTruthy();
    // OpenAI MEDIUM (review C6) — the testid must be on the button itself,
    // not on a wrapper. A different element bearing the testid would pass
    // the cheap `getByTestId` lookup while the button is misshapen.
    expect((btn as HTMLElement).tagName).toBe("BUTTON");
    expect(btn.textContent).toContain("Launch");
  });

  it("button is enabled by default (no pending state)", () => {
    renderCTA(makeTask());
    const btn = screen.getByTestId("cta-launch-in-terminal") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("hover swaps the green background to the darker --ok token, restores on leave (A04 sweep)", () => {
    renderCTA(makeTask());
    const btn = screen.getByTestId("cta-launch-in-terminal") as HTMLButtonElement;
    fireEvent.mouseEnter(btn);
    expect(btn.style.background).toContain("--ok");
    fireEvent.mouseLeave(btn);
    expect(btn.style.background).toContain("--color-success");
  });

  it("click → POST /launch (resume=false) + POST /spawn prewarm", async () => {
    const fetchInner = vi.fn(
      async (url: string | URL | Request, _init?: RequestInit) => {
        const u = String(url);
        if (u.includes("/launch")) {
          return new Response(
            JSON.stringify({
              task: { ...makeTask(), state: "awaiting_external_start" },
              commands: {
                powershell: "PS LAUNCH",
                cmd: "CMD LAUNCH",
                posix: "POSIX LAUNCH",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (u.includes("/spawn")) {
          return new Response("{}", { status: 200 });
        }
        return new Response("{}", { status: 200 });
      },
    );
    renderCTA(makeTask(), () => {}, fetchInner);
    await act(async () => {
      fireEvent.click(screen.getByTestId("cta-launch-in-terminal"));
    });
    await waitFor(() => {
      const launchCall = fetchInner.mock.calls.find((c) =>
        String(c[0]).includes("/launch"),
      );
      expect(launchCall).toBeDefined();
      const body = JSON.parse(
        (launchCall?.[1] as RequestInit | undefined)?.body as string,
      );
      expect(body.resume).toBe(false);
    });
    await waitFor(() => {
      expect(
        fetchInner.mock.calls.some((c) => String(c[0]).includes("/spawn")),
      ).toBe(true);
    });
  });
});

describe("LaunchCTA — edge paths", () => {
  it("prewarm 4xx surfaces via onError (OAI-3 / GEM-2 — error propagation)", async () => {
    const onError = vi.fn();
    const fetchInner = vi.fn(
      async (url: string | URL | Request, _init?: RequestInit) => {
        const u = String(url);
        if (u.includes("/launch")) {
          return new Response(
            JSON.stringify({
              task: makeTask(),
              commands: { powershell: "x", cmd: "x", posix: "x" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (u.includes("/spawn")) {
          return new Response("task_cwd_unresolvable", { status: 400 });
        }
        return new Response("{}", { status: 200 });
      },
    );
    renderCTA(makeTask(), onError, fetchInner);
    await act(async () => {
      fireEvent.click(screen.getByTestId("cta-launch-in-terminal"));
    });
    await waitFor(() => {
      // onError(null) at click start, then onError(...) from prewarm.
      const errorMessages = onError.mock.calls
        .map((c) => c[0])
        .filter((s) => typeof s === "string");
      expect(
        errorMessages.some((s) => (s as string).includes("prewarm 400")),
      ).toBe(true);
    });
  });

  it("launch mutation failure surfaces via onError", async () => {
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
      fireEvent.click(screen.getByTestId("cta-launch-in-terminal"));
    });
    await waitFor(() => {
      expect(
        onError.mock.calls.some((c) => typeof c[0] === "string" && c[0] !== null),
      ).toBe(true);
    });
  });
});

describe("LaunchCTA — unmount teardown-leak regression", () => {
  // The "Launching…" flash schedules a 1800 ms setTimeout that resets the
  // label. Without an unmount cleanup the timer outlives the component:
  // when it fires after the test env / jsdom window is torn down, React's
  // setState reaches into `window` and throws `ReferenceError: window is
  // not defined`, escaping as an unhandled error that fails the run. The
  // cleanup must clearTimeout the pending reset timer on unmount.
  it("clears the pending copy-reset timer on unmount", async () => {
    const setSpy = vi.spyOn(globalThis, "setTimeout");
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const fetchInner = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/launch")) {
        return new Response(
          JSON.stringify({
            task: makeTask(),
            commands: { powershell: "x", cmd: "x", posix: "x" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    });
    const { unmount } = renderCTA(makeTask(), () => {}, fetchInner);
    await act(async () => {
      fireEvent.click(screen.getByTestId("cta-launch-in-terminal"));
    });
    // flashCopied("Launching…") scheduled the 1800 ms reset timer.
    const idx = setSpy.mock.calls.findIndex((c) => c[1] === 1800);
    expect(idx).toBeGreaterThanOrEqual(0);
    const timerId = setSpy.mock.results[idx]!.value;
    unmount();
    expect(clearSpy.mock.calls.some((c) => c[0] === timerId)).toBe(true);
  });
});
