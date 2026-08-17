/*
 * EmbeddedTerminal — Reopen re-arms the one-shot auto-inject guard
 * (iterate-2026-08-16-task-lifecycle-ux-fixes).
 *
 * A `done` task's pty almost always has real prior Claude output written to
 * it, so `ptyReused:true` correctly arms the one-shot auto-inject guard
 * (`useAutoLaunch.ts`). But EmbeddedTerminal stays mounted across a Reopen
 * (the ⋯-menu action flips `state: done -> draft`) — without `taskState`
 * reaching the hook, the guard never learns the task is live again and
 * every post-reopen Resume silently parks behind manual "Send to terminal".
 *
 * New file rather than an addition to EmbeddedTerminal.test.tsx: that one
 * is bloat-baselined, so growing it would trip the anti-ratchet hook (same
 * reasoning as EmbeddedTerminal.atlas-heal.test.tsx). The xterm/WebSocket
 * doubles below are a minimal subset of the main suite's, sufficient to
 * mount the real component and drive its WS ready/data handshake.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";

// --- xterm mocks -------------------------------------------------------
let mockTermElement: HTMLDivElement | null = null;

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(function () {
    const el = document.createElement("div");
    el.tabIndex = -1;
    document.body.appendChild(el);
    mockTermElement = el;
    return {
      cols: 120,
      rows: 30,
      element: el,
      write: vi.fn(),
      focus: vi.fn(),
      dispose: vi.fn(),
      clear: vi.fn(),
      reset: vi.fn(),
      refresh: vi.fn(),
      scrollToBottom: vi.fn(),
      loadAddon: vi.fn(),
      open: vi.fn(),
      onScroll: vi.fn(() => ({ dispose: vi.fn() })),
      onWriteParsed: vi.fn(() => ({ dispose: vi.fn() })),
      onResize: vi.fn(() => ({ dispose: vi.fn() })),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
      attachCustomKeyEventHandler: vi.fn(),
      parser: { registerOscHandler: vi.fn(() => ({ dispose: vi.fn() })) },
      hasSelection: () => false,
      getSelection: () => "",
      clearSelection: vi.fn(),
      paste: vi.fn(),
      buffer: { active: { cursorY: 0, viewportY: 0, length: 0 } },
      _core: { _renderService: { dimensions: { css: { cell: { width: 7, height: 14 } } } } },
    };
  }),
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(function () {
    return { fit: vi.fn(), activate: vi.fn(), dispose: vi.fn() };
  }),
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn().mockImplementation(function () {
    return { activate: vi.fn(), dispose: vi.fn() };
  }),
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: vi.fn().mockImplementation(function () {
    return { activate: vi.fn(), dispose: vi.fn() };
  }),
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

// --- FakeWebSocket (mirrors EmbeddedTerminal.test.tsx's shape) ---------
class FakeWebSocket {
  static OPEN = 1 as const;
  static CLOSED = 3 as const;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  url: string;
  sent: string[] = [];
  private listeners: Record<string, Array<(e: unknown) => void>> = {};
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.__open());
  }
  addEventListener(t: string, cb: (e: unknown) => void) {
    (this.listeners[t] ??= []).push(cb);
  }
  removeEventListener(t: string, cb: (e: unknown) => void) {
    const arr = this.listeners[t];
    if (!arr) return;
    const i = arr.indexOf(cb);
    if (i !== -1) arr.splice(i, 1);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.__fire("close", { code: 1000 });
  }
  __open() {
    this.readyState = FakeWebSocket.OPEN;
    this.__fire("open", {});
  }
  __message(d: string) {
    this.__fire("message", { data: d });
  }
  private __fire(t: string, e: unknown) {
    for (const cb of this.listeners[t] ?? []) cb(e);
  }
  static reset() {
    FakeWebSocket.instances = [];
  }
}

import { EmbeddedTerminal } from "./EmbeddedTerminal";
import {
  LaunchCoordinatorProvider,
  useLaunchCoordinator,
} from "../../contexts/LaunchCoordinatorContext";

describe("<EmbeddedTerminal> — Reopen re-arm", () => {
  let realWS: typeof WebSocket;
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: new URL("http://localhost/x"),
    });
    realWS = globalThis.WebSocket;
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      writable: true,
      value: FakeWebSocket,
    });
    FakeWebSocket.reset();
    mockTermElement = null;
    if (!(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver) {
      class RO {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
      (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
    }
  });
  afterEach(() => {
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      writable: true,
      value: realWS,
    });
    mockTermElement?.remove();
    vi.clearAllMocks();
  });

  function AutoLaunchHarness({
    taskId,
    taskState,
  }: {
    taskId: string;
    taskState?: string;
  }) {
    const coord = useLaunchCoordinator();
    return (
      <>
        <button
          type="button"
          data-testid="harness-dispatch"
          onClick={() =>
            coord.dispatchAutoLaunch(
              {
                powershell: "& claude --resume 'u'",
                cmd: 'claude --resume "u"',
                posix: "claude --resume 'u'",
              },
              true,
            )
          }
        />
        <EmbeddedTerminal taskId={taskId} active taskState={taskState} />
      </>
    );
  }

  /** Count WS frames that carry the launch command into the pty. */
  function countLaunchSends(ws: FakeWebSocket): number {
    return ws.sent.filter(
      (s) => s.includes('"type":"data"') && s.includes("claude --resume"),
    ).length;
  }

  /**
   * fix-resume-guard-survives-reload (2026-05-17) — the server attach
   * reused a pty that pre-existed this mount, reporting `ptyReused: true`.
   */
  async function readyWriterReused(ws: FakeWebSocket) {
    await act(async () => {
      ws.__message(
        JSON.stringify({
          type: "ready",
          role: "writer",
          shellKind: "pwsh",
          cwd: "C:\\x",
          ptyReused: true,
        }),
      );
    });
    await act(async () => {
      ws.__message(JSON.stringify({ type: "data", payload: "$ " }));
    });
  }

  function clickDispatch(container: HTMLElement) {
    return act(async () =>
      (
        container.querySelector(
          '[data-testid="harness-dispatch"]',
        ) as HTMLButtonElement
      ).click(),
    );
  }

  it("a task.state transition from done to non-done (Re-open) re-arms the guard — the next launch auto-injects instead of parking", async () => {
    const { container, rerender } = render(
      <LaunchCoordinatorProvider>
        <AutoLaunchHarness taskId="t1" taskState="done" />
      </LaunchCoordinatorProvider>,
    );
    await act(async () => {});
    const ws = FakeWebSocket.instances[0];
    // The task was done — a real Claude session ran in this pty before
    // it closed, so the server correctly reports ptyReused:true on
    // attach, latching the guard armed.
    await readyWriterReused(ws);

    // Reopen: task.state flips done -> draft. EmbeddedTerminal does not
    // remount (same taskId) — only the prop changes.
    rerender(
      <LaunchCoordinatorProvider>
        <AutoLaunchHarness taskId="t1" taskState="draft" />
      </LaunchCoordinatorProvider>,
    );
    await act(async () => {});

    // Without the fix this launch would park behind manual-send forever,
    // since nothing else ever re-arms a ptyReused-latched guard.
    await clickDispatch(container);
    await waitFor(
      () => {
        expect(countLaunchSends(ws)).toBe(1);
      },
      { timeout: 3000 },
    );
    expect(
      container.querySelector(
        '[data-testid="embedded-terminal-manual-send"]',
      ),
    ).toBeNull();
  });

  it("control: WITHOUT a done -> non-done transition, a reused pty stays parked (proves the re-arm above is the taskState effect, not test noise)", async () => {
    const { container } = render(
      <LaunchCoordinatorProvider>
        <AutoLaunchHarness taskId="t1" taskState="done" />
      </LaunchCoordinatorProvider>,
    );
    await act(async () => {});
    const ws = FakeWebSocket.instances[0];
    await readyWriterReused(ws);
    await clickDispatch(container);
    await waitFor(
      () => {
        expect(
          container.querySelector(
            '[data-testid="embedded-terminal-manual-send"]',
          ),
        ).not.toBeNull();
      },
      { timeout: 3000 },
    );
    expect(countLaunchSends(ws)).toBe(0);
  });
});
