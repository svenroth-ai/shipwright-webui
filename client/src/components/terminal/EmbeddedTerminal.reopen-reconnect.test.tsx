/*
 * EmbeddedTerminal — Reopen reconnects a finished replay-only WS attach
 * (iterate-2026-08-27-terminal-replay-reset-reopen-reconnect).
 *
 * Root cause (see useTerminalSocket.ts `sessionEnded` option doc): a
 * `done`/`launch_failed` attach is one-shot by server contract — `ready`
 * (replayOnly:true) + `replay_snapshot`, then the server closes the WS
 * with code 1000. The close handler latches `sessionReplayOnlyRef` and
 * never reconnects (by design — replaying the same snapshot forever would
 * flicker). EmbeddedTerminal stays mounted across a Reopen (menu action,
 * or a board drag out of Done all funnel through the same `/reopen`
 * endpoint and flip `task.state` via React Query), so without a signal
 * threaded into `useTerminalSocket`'s effect deps, that latch never
 * un-sticks and the terminal is frozen until a full page reload.
 *
 * CRITICAL, per explicit instruction: this test drives a REAL close event
 * through the FakeWebSocket (`ws.close()` -> fires a real "close" listener
 * with code 1000), unlike `EmbeddedTerminal.reopen-rearm.test.tsx`'s WS
 * double, which is never closed and therefore cannot exercise this code
 * path at all — unit-passing there gave false confidence that the
 * iterate-2026-08-16 re-arm fix was sufficient, when in production the
 * socket layer beneath it never got a chance to reconnect.
 *
 * New file (not an addition to EmbeddedTerminal.test.tsx / the existing
 * reopen-rearm file): both are bloat-baselined; see the header of
 * EmbeddedTerminal.reopen-rearm.test.tsx for the same rationale.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

// --- xterm mocks (identical subset to EmbeddedTerminal.reopen-rearm.test.tsx) ---
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

// --- FakeWebSocket — a REAL close lifecycle, unlike the reopen-rearm double ---
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
  /** Server-initiated clean close (mirrors the replay-only branch: code 1000). */
  close(code = 1000) {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.__fire("close", { code });
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
import { LaunchCoordinatorProvider } from "../../contexts/LaunchCoordinatorContext";

describe("<EmbeddedTerminal> — Reopen reconnects a finished replay-only attach", () => {
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

  /** Deliver the server's one-shot replay-only sequence, then its real close(1000). */
  async function deliverReplayOnlyThenClose(ws: FakeWebSocket) {
    await act(async () => {
      ws.__message(
        JSON.stringify({
          type: "ready",
          role: "reader",
          shellKind: null,
          cwd: "C:\\x",
          replayOnly: true,
          terminalReset: false,
          ptyReused: false,
        }),
      );
    });
    await act(async () => {
      ws.close(1000);
    });
  }

  it("stays closed (no reconnect loop) while the task remains done — the one-shot contract", async () => {
    render(
      <LaunchCoordinatorProvider>
        <EmbeddedTerminal taskId="t1" active taskState="done" />
      </LaunchCoordinatorProvider>,
    );
    await act(async () => {});
    expect(FakeWebSocket.instances).toHaveLength(1);
    await deliverReplayOnlyThenClose(FakeWebSocket.instances[0]);

    // Give any (incorrect) reconnect timer a chance to fire.
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("opens a fresh connection once Reopen flips taskState away from done — without remounting the terminal", async () => {
    const { rerender } = render(
      <LaunchCoordinatorProvider>
        <EmbeddedTerminal taskId="t1" active taskState="done" />
      </LaunchCoordinatorProvider>,
    );
    await act(async () => {});
    const firstWs = FakeWebSocket.instances[0];
    await deliverReplayOnlyThenClose(firstWs);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(screen.getByTestId("embedded-terminal-replay-only")).toBeInTheDocument();

    const termBeforeReopen = mockTermElement;

    // Reopen: task.state flips done -> draft (menu / board-drag / task-detail
    // all converge on the same `/reopen` endpoint and the same React Query
    // update — EmbeddedTerminal never remounts across it, same taskId).
    rerender(
      <LaunchCoordinatorProvider>
        <EmbeddedTerminal taskId="t1" active taskState="draft" />
      </LaunchCoordinatorProvider>,
    );
    await act(async () => {});

    await waitFor(() => {
      expect(FakeWebSocket.instances).toHaveLength(2);
    });
    // The xterm instance itself must survive the reconnect — a `key`-remount
    // would also have produced a second WS, but at the cost of the mounted
    // terminal (and its scrollback), which this fix must not do.
    expect(mockTermElement).toBe(termBeforeReopen);
    // Code-review finding — cleared immediately, not left showing until the
    // new socket's `ready` arrives (see the HIGH #1 race test below for the
    // same assertion on the other reconnect call site).
    expect(screen.queryByTestId("embedded-terminal-replay-only")).not.toBeInTheDocument();

    // The reopened task now gets a live attach — prove the new socket is
    // actually usable (not just present).
    const secondWs = FakeWebSocket.instances[1];
    await act(async () => {
      secondWs.__message(
        JSON.stringify({
          type: "ready",
          role: "writer",
          shellKind: "pwsh",
          cwd: "C:\\x",
          replayOnly: false,
          terminalReset: false,
          ptyReused: true,
        }),
      );
    });
    await act(async () => {
      secondWs.__message(JSON.stringify({ type: "data", payload: "$ " }));
    });
    // A live, writer-role attach accepts outbound writes again.
    secondWs.send(JSON.stringify({ type: "data", payload: "echo hi\r" }));
    expect(secondWs.sent.some((s) => s.includes("echo hi"))).toBe(true);
  });

  it("reconnects once the in-flight replay-only close lands, even when Reopen raced ahead of the server's `ready` (external review, openai medium #1)", async () => {
    const { rerender } = render(
      <LaunchCoordinatorProvider>
        <EmbeddedTerminal taskId="t1" active taskState="done" />
      </LaunchCoordinatorProvider>,
    );
    await act(async () => {});
    const firstWs = FakeWebSocket.instances[0];

    // Reopen lands BEFORE the server's replay-only `ready` has even
    // arrived — `sessionReplayOnlyRef` isn't latched yet, so the
    // edge-detection effect correctly no-ops here. This is the ordering
    // that effect alone cannot cover: the true->false transition it needs
    // to see happens BEFORE the attach is known to be replay-only at all.
    rerender(
      <LaunchCoordinatorProvider>
        <EmbeddedTerminal taskId="t1" active taskState="draft" />
      </LaunchCoordinatorProvider>,
    );
    await act(async () => {});
    expect(FakeWebSocket.instances).toHaveLength(1);

    // The server's replay-only `ready` + close now finally land (it had no
    // way to know the task was reopened mid-flight). `ready` unconditionally
    // latches `sessionReplayOnlyRef` per the existing one-shot contract.
    await act(async () => {
      firstWs.__message(
        JSON.stringify({
          type: "ready",
          role: "reader",
          shellKind: null,
          cwd: "C:\\x",
          replayOnly: true,
          terminalReset: false,
          ptyReused: false,
        }),
      );
    });
    await act(async () => {
      firstWs.close(1000);
    });

    // The close handler reads the CURRENT (already-reopened) session state,
    // not a stale snapshot from when this attach started — and reconnects.
    await waitFor(() => {
      expect(FakeWebSocket.instances).toHaveLength(2);
    });
  });

  it("reconnects immediately when Reopen races BETWEEN ready and its close, and ignores the stale close when it later lands (external review, openai HIGH #1)", async () => {
    const { rerender } = render(
      <LaunchCoordinatorProvider>
        <EmbeddedTerminal taskId="t1" active taskState="done" />
      </LaunchCoordinatorProvider>,
    );
    await act(async () => {});
    const firstWs = FakeWebSocket.instances[0];

    // The server's replay-only `ready` lands and latches
    // `sessionReplayOnlyRef` — but its follow-up close has NOT arrived
    // yet. This is the exact window the close-handler race-check (test
    // above) cannot cover, because nothing has closed for it to react to.
    await act(async () => {
      firstWs.__message(
        JSON.stringify({
          type: "ready",
          role: "reader",
          shellKind: null,
          cwd: "C:\\x",
          replayOnly: true,
          terminalReset: false,
          ptyReused: false,
        }),
      );
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
    // The one-shot `ready` latched `replayOnly` — the "Session ended…"
    // banner is showing, same as any other finished attach.
    expect(screen.getByTestId("embedded-terminal-replay-only")).toBeInTheDocument();

    // Reopen now — BEFORE the close lands. The edge-detection effect sees
    // the true->false transition immediately (sessionReplayOnlyRef is
    // already latched) and reconnects right away, without waiting.
    rerender(
      <LaunchCoordinatorProvider>
        <EmbeddedTerminal taskId="t1" active taskState="draft" />
      </LaunchCoordinatorProvider>,
    );
    await act(async () => {});
    expect(FakeWebSocket.instances).toHaveLength(2);
    // Code-review finding — the banner must clear IMMEDIATELY on reconnect,
    // not linger until the new socket's own `ready` arrives and overwrites
    // it; otherwise Reopen visibly recreates the exact frozen-looking
    // symptom this iterate exists to fix.
    expect(screen.queryByTestId("embedded-terminal-replay-only")).not.toBeInTheDocument();
    const secondWs = FakeWebSocket.instances[1];

    // The stale first socket's close now finally lands. Pre-fix, its
    // handler would null out `socketRef` (clobbering the live second
    // socket) and fall through to a spurious THIRD reconnect. The
    // socket-identity guard must recognize it as superseded and no-op.
    await act(async () => {
      firstWs.close(1000);
    });
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(FakeWebSocket.instances).toHaveLength(2);

    // The second socket must still be the live, usable one — not
    // orphaned by the stale close's `socketRef.current = null`.
    await act(async () => {
      secondWs.__message(
        JSON.stringify({
          type: "ready",
          role: "writer",
          shellKind: "pwsh",
          cwd: "C:\\x",
          replayOnly: false,
          terminalReset: false,
          ptyReused: true,
        }),
      );
    });
    secondWs.send(JSON.stringify({ type: "data", payload: "echo hi\r" }));
    expect(secondWs.sent.some((s) => s.includes("echo hi"))).toBe(true);
  });

  it("control: WITHOUT a Reopen (taskState stays done), the closed attach never reconnects even after a re-render", async () => {
    const { rerender } = render(
      <LaunchCoordinatorProvider>
        <EmbeddedTerminal taskId="t1" active taskState="done" />
      </LaunchCoordinatorProvider>,
    );
    await act(async () => {});
    await deliverReplayOnlyThenClose(FakeWebSocket.instances[0]);
    expect(FakeWebSocket.instances).toHaveLength(1);

    // An unrelated re-render (e.g. `active` prop churn) must not itself
    // resurrect a finished attach.
    rerender(
      <LaunchCoordinatorProvider>
        <EmbeddedTerminal taskId="t1" active taskState="done" />
      </LaunchCoordinatorProvider>,
    );
    await act(async () => {});
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
