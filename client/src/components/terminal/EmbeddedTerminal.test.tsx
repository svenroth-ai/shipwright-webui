/*
 * EmbeddedTerminal — wiring tests with xterm.js mocked. jsdom can't run
 * the real Terminal (no canvas, no actual DOM measurement) so we replace
 * the @xterm/* imports with lightweight spy doubles and assert on
 * outcomes: paste-handler decision tree, ResizeObserver throttling,
 * ready-handshake propagation, gitignore-toast surfacing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { createRef } from "react";

// --- xterm mocks -----------------------------------------------------------
const writeSpy = vi.fn<(d: string, cb?: () => void) => void>();
const focusSpy = vi.fn();
const disposeSpy = vi.fn();
const clearSpy = vi.fn();
const resetSpy = vi.fn();
const scrollToBottomSpy = vi.fn();
const onDataHandlers: Array<(d: string) => void> = [];
const fitSpy = vi.fn();

// ADR-108 (iterate-20260516-terminal-smear-interleave) — deterministic
// control over xterm's async write parse. `term.write(data, cb)` DEFERS
// `cb` into `writeCompletions` (mirrors xterm's "callback fires after
// parse") instead of invoking it inline, so a test can observe the
// replay-snapshot in-flight window during which the drain gate queues
// live `data`. `writeShouldThrow` drives the synchronous-throw robustness
// path (AC-3).
const writeCompletions: Array<() => void> = [];
let writeShouldThrow = false;
function flushWriteCompletions(): void {
  const pending = writeCompletions.splice(0, writeCompletions.length);
  for (const cb of pending) cb();
}

// The mock xterm buffer is a defensive no-op — the component no longer
// reads `term.buffer` after the ADR-099 atlas machinery was removed
// (ADR-108). Kept minimal so future tests don't re-mock from scratch.
const mockBufferActive = {
  get length() {
    return 0;
  },
  getLine(_i: number) {
    return undefined;
  },
  type: "normal" as const,
};

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    cols: 120,
    rows: 30,
    // ADR-104 — `write(data, cb?)` records via writeSpy, optionally throws
    // (AC-3 robustness path), and DEFERS the completion callback into
    // `writeCompletions` so a test can observe the in-flight window.
    // writeSpy is called with EXACTLY the args the component passed
    // (no trailing `undefined`) so single-arg call assertions still hold.
    write(d: string, cb?: () => void) {
      if (cb === undefined) writeSpy(d);
      else writeSpy(d, cb);
      if (writeShouldThrow) throw new Error("simulated xterm write failure");
      if (typeof cb === "function") writeCompletions.push(cb);
    },
    focus: focusSpy,
    dispose: disposeSpy,
    clear: clearSpy,
    // ADR-104 — `onReplaySnapshot` calls term.reset() before the snapshot
    // write; the prod code wraps it in try/catch (xterm mid-dispose) but
    // the mock provides it as a real spy for fidelity.
    reset: resetSpy,
    scrollToBottom: scrollToBottomSpy,
    loadAddon: vi.fn(),
    open: vi.fn(),
    onData(cb: (d: string) => void) {
      onDataHandlers.push(cb);
      return { dispose: vi.fn() };
    },
    buffer: { active: mockBufferActive },
  })),
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(() => ({ fit: fitSpy, activate: vi.fn(), dispose: vi.fn() })),
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn().mockImplementation(() => ({ activate: vi.fn(), dispose: vi.fn() })),
}));
// Iterate F (ADR-093) — addon-webgl loaded with try/catch fallback. The mock
// returns a constructor that doesn't throw, so the try-branch lands; jsdom
// has no real WebGL context but EmbeddedTerminal never asserts against it.
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
    dispose: vi.fn(),
  })),
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

// --- FakeWebSocket (mirrors the hook test's shape) ------------------------
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

// --- DataTransfer shim ----------------------------------------------------
// jsdom does not implement DataTransfer / DataTransferItemList. We only
// need the slice the paste-handler uses (items[i].kind/type/getAsFile()
// and dt.getData("text/plain")).
interface FakeItem {
  kind: "string" | "file";
  type: string;
  getAsFile(): File | null;
  __string?: string;
}
class FakeDataTransfer {
  items: { length: number; add(...args: unknown[]): void; [i: number]: FakeItem } = (() => {
    const arr: FakeItem[] = [];
    const list = arr as unknown as {
      length: number;
      add: (...args: unknown[]) => void;
      [i: number]: FakeItem;
    };
    (list as unknown as { add: (...a: unknown[]) => void }).add = (...args: unknown[]) => {
      if (args.length === 2 && typeof args[0] === "string") {
        arr.push({
          kind: "string",
          type: args[1] as string,
          __string: args[0],
          getAsFile: () => null,
        });
      } else if (args.length === 1 && args[0] instanceof File) {
        const f = args[0] as File;
        arr.push({
          kind: "file",
          type: f.type,
          getAsFile: () => f,
        });
      }
    };
    return list;
  })();
  getData(type: string): string {
    for (let i = 0; i < (this.items as unknown as { length: number }).length; i++) {
      const it = (this.items as unknown as Record<number, FakeItem>)[i];
      if (it.kind === "string" && it.type === type) return it.__string ?? "";
    }
    return "";
  }
}

function fakeClipboardEvent(dt: FakeDataTransfer): Event {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: dt });
  return ev;
}

// --- Tests -----------------------------------------------------------------
import {
  EmbeddedTerminal,
  type EmbeddedTerminalHandle,
  REPLAY_DRAIN_TIMEOUT_MS,
  REPLAY_DRAIN_MAX_BYTES,
} from "./EmbeddedTerminal";
import {
  LaunchCoordinatorProvider,
  useLaunchCoordinator,
} from "../../contexts/LaunchCoordinatorContext";

describe("<EmbeddedTerminal>", () => {
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
    writeSpy.mockClear();
    focusSpy.mockClear();
    disposeSpy.mockClear();
    clearSpy.mockClear();
    resetSpy.mockClear();
    scrollToBottomSpy.mockClear();
    fitSpy.mockClear();
    onDataHandlers.length = 0;
    writeCompletions.length = 0;
    writeShouldThrow = false;

    // ResizeObserver stub for jsdom.
    if (!(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver) {
      class RO {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
      (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
    }

    // fetch mock for paste-image.
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: vi.fn(async () => ({
        ok: true,
        json: async () => ({ gitignoreSuggestion: false, path: "C:\\\\x\\\\img.png" }),
      })),
    });
  });
  afterEach(() => {
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      writable: true,
      value: realWS,
    });
    vi.clearAllMocks();
  });

  it("renders the canvas testid + reflects ws/role data attributes", async () => {
    const { container } = render(<EmbeddedTerminal taskId="t1" active />);
    await act(async () => {});
    const canvas = container.querySelector('[data-testid="embedded-terminal-canvas"]');
    expect(canvas).not.toBeNull();
    const wrap = container.querySelector('[data-testid="embedded-terminal"]');
    expect(wrap?.getAttribute("data-ws-open")).toBe("true");
  });

  it("forwards xterm onData → socket {type:'data'}", async () => {
    render(<EmbeddedTerminal taskId="t1" active />);
    await act(async () => {});
    expect(onDataHandlers.length).toBeGreaterThan(0);
    const ws = FakeWebSocket.instances[0];
    expect(ws).toBeDefined();
    await act(async () => {
      onDataHandlers[0]("ls\n");
    });
    expect(ws.sent.some((s) => s.includes('"type":"data"') && s.includes('"ls\\n"'))).toBe(true);
  });

  it("forwards inbound 'data' envelopes to xterm.write()", async () => {
    render(<EmbeddedTerminal taskId="t1" active />);
    await act(async () => {});
    const ws = FakeWebSocket.instances[0];
    await act(async () => {
      ws.__message(JSON.stringify({ type: "data", payload: "$ " }));
    });
    expect(writeSpy).toHaveBeenCalledWith("$ ");
  });

  it("ready-handshake: ref.ready flips to true after the server 'ready' envelope", async () => {
    const ref = createRef<EmbeddedTerminalHandle>();
    render(<EmbeddedTerminal taskId="t1" active ref={ref} />);
    await act(async () => {});
    expect(ref.current?.ready).toBe(false);
    const ws = FakeWebSocket.instances[0];
    await act(async () => {
      ws.__message(
        JSON.stringify({ type: "ready", role: "writer", shellKind: "pwsh", cwd: "C:\\x" }),
      );
    });
    await waitFor(() => expect(ref.current?.ready).toBe(true));
  });

  it("ref.focus() calls xterm.focus()", async () => {
    const ref = createRef<EmbeddedTerminalHandle>();
    render(<EmbeddedTerminal taskId="t1" active ref={ref} />);
    await act(async () => {});
    ref.current?.focus();
    expect(focusSpy).toHaveBeenCalled();
  });

  it("paste-handler — text-only clipboard: preventDefault + socket.send({type:'data'}), no fetch", async () => {
    const { container } = render(<EmbeddedTerminal taskId="t1" active />);
    await act(async () => {});
    const target = container.querySelector('[data-testid="embedded-terminal-canvas"]') as HTMLDivElement;
    const ws = FakeWebSocket.instances[0];

    const dt = new FakeDataTransfer();
    dt.items.add("hello\nworld", "text/plain");
    const ev = fakeClipboardEvent(dt);

    await act(async () => {
      target.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(ws.sent.some((s) => s.includes('"hello\\nworld"'))).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("paste-handler — image-wins: image item triggers fetch /paste-image; text in same payload is dropped", async () => {
    const { container } = render(<EmbeddedTerminal taskId="t1" active />);
    await act(async () => {});
    const target = container.querySelector('[data-testid="embedded-terminal-canvas"]') as HTMLDivElement;
    const ws = FakeWebSocket.instances[0];

    // Build a DataTransfer with BOTH text and image.
    const dt = new FakeDataTransfer();
    dt.items.add("ignored-by-image-wins", "text/plain");
    const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    // jsdom's DataTransferItemList.add(blob, type) accepts a File-like.
    const file = new File([blob], "screenshot.png", { type: "image/png" });
    dt.items.add(file);

    const ev = fakeClipboardEvent(dt);

    await act(async () => {
      target.dispatchEvent(ev);
    });

    expect(ev.defaultPrevented).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/terminal/t1/paste-image",
      expect.objectContaining({ method: "POST" }),
    );
    // text-data NOT sent — image-wins precedence drops text in same payload.
    expect(ws.sent.some((s) => s.includes("ignored-by-image-wins"))).toBe(false);
  });

  it("paste-handler — Ctrl+V parity: paste dispatched on a deeper descendant inside container is still captured (AC-3)", async () => {
    // Iterate v0.8.2 AC-3: xterm's internal textarea sits inside the
    // outer container; a Ctrl+V paste event whose target is that
    // textarea (or any other descendant) must still hit our handler.
    // The handler is registered on `document` with capture phase so it
    // fires before xterm's own paste-handling on the textarea can
    // pre-empt us.
    const { container } = render(<EmbeddedTerminal taskId="t1" active />);
    await act(async () => {});
    const wrap = container.querySelector('[data-testid="embedded-terminal-canvas"]') as HTMLDivElement;
    // Inject a synthetic descendant — stand-in for xterm's textarea.
    const fakeTextarea = document.createElement("textarea");
    wrap.appendChild(fakeTextarea);
    fakeTextarea.focus();

    const dt = new FakeDataTransfer();
    const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
      type: "image/png",
    });
    const file = new File([blob], "ctrlv-paste.png", { type: "image/png" });
    dt.items.add(file);
    const ev = fakeClipboardEvent(dt);

    await act(async () => {
      fakeTextarea.dispatchEvent(ev);
    });

    expect(ev.defaultPrevented).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/terminal/t1/paste-image",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("paste-handler — paste OUTSIDE the container is ignored (handler stays scoped after move to document)", async () => {
    // Iterate v0.8.2 AC-3 boundary check: moving the listener to
    // `document` must NOT make it react to pastes in unrelated parts
    // of the page. Scope is enforced via `container.contains(target)`.
    render(<EmbeddedTerminal taskId="t1" active />);
    await act(async () => {});
    const outside = document.createElement("textarea");
    document.body.appendChild(outside);

    const dt = new FakeDataTransfer();
    dt.items.add("hello", "text/plain");
    const ev = fakeClipboardEvent(dt);

    await act(async () => {
      outside.dispatchEvent(ev);
    });

    expect(ev.defaultPrevented).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    document.body.removeChild(outside);
  });

  it("paste-handler — no clipboard items at all: handler is a no-op (no preventDefault, no fetch)", async () => {
    const { container } = render(<EmbeddedTerminal taskId="t1" active />);
    await act(async () => {});
    const target = container.querySelector('[data-testid="embedded-terminal-canvas"]') as HTMLDivElement;

    const dt = new FakeDataTransfer();
    const ev = fakeClipboardEvent(dt);

    await act(async () => {
      target.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("read-only banner is suppressed for 1500 ms after ready (ADR-084 AC-1 banner-grace), then armed if role stays reader, then cleared on writer-promoted (StrictMode race fence)", async () => {
    // v0.9.2 (ADR-084) — the banner now waits 1500 ms after a fresh `ready`
    // envelope to avoid flashing during the StrictMode-mount-1-takes-writer
    // / mount-2-briefly-reader window before writer-promoted arrives. The
    // server-side promotion contract is locked by
    // `server/src/terminal/pty-manager.test.ts` writer-promoted suite.
    vi.useFakeTimers();
    try {
      const { container } = render(<EmbeddedTerminal taskId="t1" active />);
      await act(async () => {});
      const ws = FakeWebSocket.instances[0];
      // No ready yet → no banner.
      expect(container.querySelector('[data-testid="embedded-terminal-readonly"]')).toBeNull();
      await act(async () => {
        ws.__message(
          JSON.stringify({ type: "ready", role: "reader", shellKind: "pwsh", cwd: "C:\\x" }),
        );
      });
      // Within the grace window — banner is STILL hidden even though
      // role=reader. This is the v0.9.2 fix.
      await act(async () => {
        vi.advanceTimersByTime(1400);
      });
      expect(container.querySelector('[data-testid="embedded-terminal-readonly"]')).toBeNull();
      // Past the grace window — role is genuinely stable at reader, banner
      // is now armed and visible.
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      expect(container.querySelector('[data-testid="embedded-terminal-readonly"]')).not.toBeNull();
      // Promotion clears the banner.
      await act(async () => {
        ws.__message(JSON.stringify({ type: "writer-promoted" }));
      });
      expect(container.querySelector('[data-testid="embedded-terminal-readonly"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("read-only banner is cleared by writer-promoted DURING the grace window (no transient flash) — ADR-084 AC-1", async () => {
    // The realistic StrictMode case: mount-1 takes writer, mount-2 opens
    // with role=reader, then mount-1 close fires within a few hundred ms
    // → writer-promoted reaches mount-2 INSIDE the 1500 ms grace. Banner
    // must never have rendered.
    vi.useFakeTimers();
    try {
      const { container } = render(<EmbeddedTerminal taskId="t1" active />);
      await act(async () => {});
      const ws = FakeWebSocket.instances[0];
      await act(async () => {
        ws.__message(
          JSON.stringify({ type: "ready", role: "reader", shellKind: "pwsh", cwd: "C:\\x" }),
        );
      });
      // Mid-grace — banner hidden.
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(container.querySelector('[data-testid="embedded-terminal-readonly"]')).toBeNull();
      // writer-promoted lands → role flips to writer → banner stays hidden
      // for the rest of the grace AND after it (would-be-arm-timer is
      // cleared by the effect's dep-change cleanup).
      await act(async () => {
        ws.__message(JSON.stringify({ type: "writer-promoted" }));
      });
      expect(container.querySelector('[data-testid="embedded-terminal-readonly"]')).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(container.querySelector('[data-testid="embedded-terminal-readonly"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // Iterate v0.8.3 AC-1 wiring tests for `attachCustomKeyEventHandler`
  // were removed in v0.8.5 AC-2 alongside the Ctrl+V interceptor itself.
  // The DOM `paste` listener (right-click → Paste menu, programmatic
  // paste, Edge/Chrome legacy paths) is still covered by the
  // "paste-handler — …" cases above.

  // Iterate C (ADR-087) — the legacy chunked-replay envelopes
  // (replay_start / replay_chunk / replay_separator / replay_end) are
  // retired. The server emits a single `replay_snapshot` envelope when
  // a cell-state snapshot exists; the client writes once via
  // term.reset() + term.write(data) + term.scrollToBottom().
  it("ADR-087/ADR-104: writes replay_snapshot via term.reset + term.write(data,callback); scrollToBottom runs in the write-completion callback", async () => {
    render(<EmbeddedTerminal taskId="t1" active />);
    await act(async () => {});
    const ws = FakeWebSocket.instances[0];
    await act(async () => {
      ws.__message(
        JSON.stringify({
          type: "replay_snapshot",
          data: "SNAPSHOT-PAYLOAD",
          cols: 80,
          rows: 24,
          terminalVersion: "6.0.0",
        }),
      );
    });
    const writes = writeSpy.mock.calls.map((c) => c[0]);
    expect(writes).toContain("SNAPSHOT-PAYLOAD");
    // ADR-104 — the snapshot write passes a completion callback.
    expect(writeSpy).toHaveBeenCalledWith(
      "SNAPSHOT-PAYLOAD",
      expect.any(Function),
    );
    // ADR-104 (AC-1) — scrollToBottom moved OUT of the ADR-099-v10
    // setTimeout(0) that raced the in-flight parse; it now runs only
    // inside the term.write completion callback.
    expect(scrollToBottomSpy).not.toHaveBeenCalled();
    await act(async () => {
      flushWriteCompletions();
    });
    expect(scrollToBottomSpy).toHaveBeenCalled();
  });

  // ADR-108 (iterate-20260516-terminal-smear-interleave) — replay drain
  // gate. Bug B: while a `replay_snapshot` term.write parses ASYNCHRONOUSLY,
  // live `data` envelopes wrote straight to xterm and interleaved with the
  // in-flight snapshot parse, corrupting the buffer (left-column glyph-
  // fragment smear). The gate QUEUES live `data` while a snapshot write is
  // in flight and drains it — as one concatenated write — once the
  // snapshot's completion callback (or the watchdog) settles the gate.
  describe("replay drain gate (ADR-108)", () => {
    const dispatchSnapshot = async (ws: FakeWebSocket, data: string) => {
      await act(async () => {
        ws.__message(
          JSON.stringify({
            type: "replay_snapshot",
            data,
            cols: 80,
            rows: 24,
            terminalVersion: "6.0.0",
          }),
        );
      });
    };
    const dispatchData = async (ws: FakeWebSocket, payload: string) => {
      await act(async () => {
        ws.__message(JSON.stringify({ type: "data", payload }));
      });
    };
    const wrote = (d: string) => writeSpy.mock.calls.some((c) => c[0] === d);

    it("AC-1: live `data` arriving while a snapshot write is in flight is queued, not written", async () => {
      render(<EmbeddedTerminal taskId="t1" active />);
      await act(async () => {});
      const ws = FakeWebSocket.instances[0];
      await dispatchSnapshot(ws, "SNAP");
      // Snapshot write recorded; its completion callback is deferred →
      // the gate is open.
      expect(writeSpy).toHaveBeenCalledWith("SNAP", expect.any(Function));
      await dispatchData(ws, "LIVE-1");
      // The live chunk is queued — NOT written straight to xterm.
      expect(wrote("LIVE-1")).toBe(false);
    });

    it("AC-2: queued chunks drain in arrival order as a single concatenated write after the snapshot completes", async () => {
      render(<EmbeddedTerminal taskId="t1" active />);
      await act(async () => {});
      const ws = FakeWebSocket.instances[0];
      await dispatchSnapshot(ws, "SNAP");
      await dispatchData(ws, "AAA");
      await dispatchData(ws, "BBB");
      expect(wrote("AAA")).toBe(false);
      expect(wrote("BBB")).toBe(false);
      await act(async () => {
        flushWriteCompletions();
      });
      // One concatenated write, in arrival order, AFTER the snapshot.
      expect(wrote("AAABBB")).toBe(true);
      const snapIdx = writeSpy.mock.calls.findIndex((c) => c[0] === "SNAP");
      const drainIdx = writeSpy.mock.calls.findIndex((c) => c[0] === "AAABBB");
      expect(snapIdx).toBeGreaterThanOrEqual(0);
      expect(drainIdx).toBeGreaterThan(snapIdx);
    });

    it("AC-4: with no replay in flight, `data` envelopes write straight through", async () => {
      render(<EmbeddedTerminal taskId="t1" active />);
      await act(async () => {});
      const ws = FakeWebSocket.instances[0];
      await dispatchData(ws, "STRAIGHT");
      expect(writeSpy).toHaveBeenCalledWith("STRAIGHT");
    });

    it("AC-3: a synchronous term.write throw releases the gate — subsequent `data` writes straight through", async () => {
      render(<EmbeddedTerminal taskId="t1" active />);
      await act(async () => {});
      const ws = FakeWebSocket.instances[0];
      writeShouldThrow = true;
      await dispatchSnapshot(ws, "WILL-THROW");
      writeShouldThrow = false;
      // The catch released the gate — a later live chunk writes straight
      // through instead of being queued forever.
      await dispatchData(ws, "AFTER-THROW");
      expect(writeSpy).toHaveBeenCalledWith("AFTER-THROW");
    });

    it("AC-3: queued chunks are dropped on unmount; the deferred completion callback is a safe no-op", async () => {
      const { unmount } = render(<EmbeddedTerminal taskId="t1" active />);
      await act(async () => {});
      const ws = FakeWebSocket.instances[0];
      await dispatchSnapshot(ws, "SNAP");
      await dispatchData(ws, "QUEUED-THEN-DISPOSED");
      await act(async () => {
        unmount();
      });
      // The completion callback fires after the component is gone — it
      // must not throw and must not write the orphaned chunk.
      expect(() => flushWriteCompletions()).not.toThrow();
      expect(wrote("QUEUED-THEN-DISPOSED")).toBe(false);
    });

    it("AC-3: the watchdog drains the queue as a single concatenated write when the completion callback never fires", async () => {
      vi.useFakeTimers();
      try {
        render(<EmbeddedTerminal taskId="t1" active />);
        await act(async () => {});
        const ws = FakeWebSocket.instances[0];
        await dispatchSnapshot(ws, "SNAP");
        await dispatchData(ws, "WATCH-A");
        await dispatchData(ws, "WATCH-B");
        expect(wrote("WATCH-A")).toBe(false);
        expect(wrote("WATCH-B")).toBe(false);
        // Completion callback is never flushed — only the watchdog can
        // release the gate.
        await act(async () => {
          vi.advanceTimersByTime(REPLAY_DRAIN_TIMEOUT_MS);
        });
        // Drained as ONE concatenated write, in arrival order, after the
        // snapshot — the watchdog path must not write chunk-by-chunk.
        expect(wrote("WATCH-AWATCH-B")).toBe(true);
        const snapIdx = writeSpy.mock.calls.findIndex((c) => c[0] === "SNAP");
        const drainIdx = writeSpy.mock.calls.findIndex(
          (c) => c[0] === "WATCH-AWATCH-B",
        );
        expect(drainIdx).toBeGreaterThan(snapIdx);
        // Gate released — a later chunk writes straight through.
        await dispatchData(ws, "POST-WATCHDOG");
        expect(writeSpy).toHaveBeenCalledWith("POST-WATCHDOG");
      } finally {
        vi.useRealTimers();
      }
    });

    it("AC-5: once the watchdog has settled the gate, a late completion callback is a no-op (no double drain)", async () => {
      vi.useFakeTimers();
      try {
        render(<EmbeddedTerminal taskId="t1" active />);
        await act(async () => {});
        const ws = FakeWebSocket.instances[0];
        await dispatchSnapshot(ws, "SNAP");
        await dispatchData(ws, "ONCE");
        await act(async () => {
          vi.advanceTimersByTime(REPLAY_DRAIN_TIMEOUT_MS);
        });
        expect(
          writeSpy.mock.calls.filter((c) => c[0] === "ONCE").length,
        ).toBe(1);
        // The real completion callback fires LATE — its generation is
        // stale, so it must not drain "ONCE" a second time.
        await act(async () => {
          flushWriteCompletions();
        });
        expect(
          writeSpy.mock.calls.filter((c) => c[0] === "ONCE").length,
        ).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("AC-5: a new replay_snapshot supersedes live data queued for the prior snapshot window", async () => {
      render(<EmbeddedTerminal taskId="t1" active />);
      await act(async () => {});
      const ws = FakeWebSocket.instances[0];
      await dispatchSnapshot(ws, "SNAP-1");
      await dispatchData(ws, "STALE");
      // Second snapshot arrives while SNAP-1's completion is still
      // deferred — it re-arms the gate and supersedes "STALE".
      await dispatchSnapshot(ws, "SNAP-2");
      await dispatchData(ws, "FRESH");
      await act(async () => {
        flushWriteCompletions();
      });
      // SNAP-1's stale callback is a no-op; SNAP-2's callback drains only
      // the post-SNAP-2 chunk. "STALE" is dropped, never written.
      expect(wrote("STALE")).toBe(false);
      expect(wrote("FRESH")).toBe(true);
    });

    it("AC-3: queue byte-cap drops the OLDEST chunks; newest live data survives", async () => {
      render(<EmbeddedTerminal taskId="t1" active />);
      await act(async () => {});
      const ws = FakeWebSocket.instances[0];
      await dispatchSnapshot(ws, "SNAP");
      // Two fillers, each just over half the cap → together they exceed
      // it, forcing the ring-buffer trim.
      const fillerSize = Math.ceil(REPLAY_DRAIN_MAX_BYTES / 2) + 1024;
      const big1 = "B1" + "x".repeat(fillerSize);
      const big2 = "B2" + "y".repeat(fillerSize);
      await dispatchData(ws, "OLDEST-MARKER");
      await dispatchData(ws, big1);
      await dispatchData(ws, big2); // total > cap → oldest dropped
      await dispatchData(ws, "NEWEST-MARKER");
      // Gate stayed CLOSED throughout the overflow trim — the ONLY write
      // so far is the snapshot itself; no chunk was force-drained.
      expect(writeSpy.mock.calls.every((c) => c[0] === "SNAP")).toBe(true);
      expect(wrote("OLDEST-MARKER")).toBe(false);
      await act(async () => {
        flushWriteCompletions();
      });
      const drainCall = writeSpy.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("NEWEST-MARKER"),
      );
      expect(drainCall).toBeDefined();
      const drained = drainCall![0];
      // Oldest chunks (the marker + big1) were trimmed; big2 + the newest
      // marker survive, in order.
      expect(drained.includes("OLDEST-MARKER")).toBe(false);
      expect(drained.includes("B1")).toBe(false);
      expect(drained.startsWith("B2")).toBe(true);
      expect(drained.endsWith("NEWEST-MARKER")).toBe(true);
    });
  });

  it("ADR-087: stale legacy chunked-replay envelopes are silently ignored", async () => {
    // Mid-deploy server/client skew: if a stale server emits
    // replay_chunk envelopes, the client MUST NOT crash and MUST NOT
    // write the payloads (they're raw byte streams the snapshot path
    // has retired in favor of cell-state replay).
    render(<EmbeddedTerminal taskId="t1" active />);
    await act(async () => {});
    const ws = FakeWebSocket.instances[0];
    const writesBefore = writeSpy.mock.calls.length;
    await act(async () => {
      ws.__message(JSON.stringify({ type: "replay_start", totalBytes: 100 }));
      ws.__message(JSON.stringify({ type: "replay_chunk", payload: "old" }));
      ws.__message(JSON.stringify({ type: "replay_end" }));
    });
    // No new write call from the retired envelopes.
    expect(writeSpy.mock.calls.length).toBe(writesBefore);
  });

  it("surfaces gitignoreSuggestion=true via onGitignoreSuggestion callback", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ gitignoreSuggestion: true, path: "/x/.claude-pastes/img.png" }),
    }));
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: fetchMock,
    });

    let toastFires = 0;
    const { container } = render(
      <EmbeddedTerminal taskId="t1" active onGitignoreSuggestion={() => (toastFires += 1)} />,
    );
    await act(async () => {});
    const target = container.querySelector('[data-testid="embedded-terminal-canvas"]') as HTMLDivElement;

    const dt = new FakeDataTransfer();
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "x.png", {
      type: "image/png",
    });
    dt.items.add(file);

    const ev = fakeClipboardEvent(dt);
    await act(async () => {
      target.dispatchEvent(ev);
      // Allow microtasks to flush so the fetch().then() callback runs.
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(toastFires).toBe(1);
  });

  // Iterate C (ADR-087) — the v0.8.7 stopped-sessions footer + Clear
  // history button were tied to the chunked-replay marker accumulator;
  // both were retired alongside the legacy replay envelopes. The
  // `/clear-scrollback` server endpoint still exists (surfaced via the
  // kebab "..." overflow menu in TaskCard / TaskDetailHeader).

  // ADR-104 (iterate-20260515-terminal-smear-reset) — reset banner.
  // When the WS `ready` envelope reports `terminalReset: true` (a fresh
  // pty was spawned after a prior Claude session was lost — server
  // restart / crash), the terminal surfaces a warning banner instead of
  // leaving the user staring at a silent PowerShell prompt.
  it("ADR-104 (AC-6): renders the reset banner when ready envelope has terminalReset:true", async () => {
    const { container } = render(<EmbeddedTerminal taskId="t1" active />);
    await act(async () => {});
    const ws = FakeWebSocket.instances[0];
    expect(
      container.querySelector('[data-testid="embedded-terminal-reset"]'),
    ).toBeNull();
    await act(async () => {
      ws.__message(
        JSON.stringify({
          type: "ready",
          role: "writer",
          shellKind: "pwsh",
          cwd: "C:\\x",
          terminalReset: true,
        }),
      );
    });
    expect(
      container.querySelector('[data-testid="embedded-terminal-reset"]'),
    ).not.toBeNull();
  });

  it("ADR-104 (AC-6): no reset banner when terminalReset is absent (normal attach)", async () => {
    const { container } = render(<EmbeddedTerminal taskId="t1" active />);
    await act(async () => {});
    const ws = FakeWebSocket.instances[0];
    await act(async () => {
      ws.__message(
        JSON.stringify({ type: "ready", role: "writer", shellKind: "pwsh", cwd: "C:\\x" }),
      );
    });
    expect(
      container.querySelector('[data-testid="embedded-terminal-reset"]'),
    ).toBeNull();
  });

  it("ADR-104 (AC-6): the reset banner can be dismissed", async () => {
    const { container } = render(<EmbeddedTerminal taskId="t1" active />);
    await act(async () => {});
    const ws = FakeWebSocket.instances[0];
    await act(async () => {
      ws.__message(
        JSON.stringify({
          type: "ready",
          role: "writer",
          shellKind: "pwsh",
          cwd: "C:\\x",
          terminalReset: true,
        }),
      );
    });
    const dismiss = container.querySelector(
      '[data-testid="embedded-terminal-reset-dismiss"]',
    ) as HTMLButtonElement | null;
    expect(dismiss).not.toBeNull();
    await act(async () => {
      dismiss!.click();
    });
    expect(
      container.querySelector('[data-testid="embedded-terminal-reset"]'),
    ).toBeNull();
  });

  // ── resume-cta-rework (2026-05-16) — AC-2 one-shot auto-inject guard ──
  //
  // The first launch into a fresh pty auto-injects after the
  // prompt-readiness handshake (happy path, unchanged). A SECOND
  // launch into the same still-live pty must NOT auto-send — it parks
  // behind an explicit "Send to terminal" confirm, so a stray command
  // can never land inside a running Claude session. The guard re-arms
  // on a fresh pty (taskId change / remount / WS terminalReset).
  describe("AC-2 — one-shot auto-inject guard", () => {
    function AutoLaunchHarness({ taskId }: { taskId: string }) {
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
          <EmbeddedTerminal taskId={taskId} active />
        </>
      );
    }

    /** Count WS frames that carry the launch command into the pty. */
    function countLaunchSends(ws: FakeWebSocket): number {
      return ws.sent.filter(
        (s) => s.includes('"type":"data"') && s.includes("claude --resume"),
      ).length;
    }

    async function readyWriter(ws: FakeWebSocket) {
      await act(async () => {
        ws.__message(
          JSON.stringify({
            type: "ready",
            role: "writer",
            shellKind: "pwsh",
            cwd: "C:\\x",
          }),
        );
      });
      // A data byte so the prompt-readiness handshake clears on the
      // 250 ms quiesce path instead of the 1500 ms cold-pty grace.
      await act(async () => {
        ws.__message(JSON.stringify({ type: "data", payload: "$ " }));
      });
    }

    it("first launch into a fresh pty auto-injects the command", async () => {
      const { container } = render(
        <LaunchCoordinatorProvider>
          <AutoLaunchHarness taskId="t1" />
        </LaunchCoordinatorProvider>,
      );
      await act(async () => {});
      const ws = FakeWebSocket.instances[0];
      await readyWriter(ws);
      await act(async () => {
        (
          container.querySelector(
            '[data-testid="harness-dispatch"]',
          ) as HTMLButtonElement
        ).click();
      });
      await waitFor(
        () => {
          expect(countLaunchSends(ws)).toBe(1);
        },
        { timeout: 3000 },
      );
    });

    it("a SECOND launch into the same live pty parks behind 'Send to terminal' — no auto-send", async () => {
      const { container } = render(
        <LaunchCoordinatorProvider>
          <AutoLaunchHarness taskId="t1" />
        </LaunchCoordinatorProvider>,
      );
      await act(async () => {});
      const ws = FakeWebSocket.instances[0];
      await readyWriter(ws);
      const dispatch = container.querySelector(
        '[data-testid="harness-dispatch"]',
      ) as HTMLButtonElement;

      await act(async () => dispatch.click());
      await waitFor(
        () => {
          expect(countLaunchSends(ws)).toBe(1);
        },
        { timeout: 3000 },
      );

      // Launch #2 — the one-shot guard fires.
      await act(async () => dispatch.click());
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
      // Crucially: NO second command was injected into the pty.
      expect(countLaunchSends(ws)).toBe(1);
    });

    it("'Send to terminal' on the parked banner injects the command + clears the banner", async () => {
      const { container } = render(
        <LaunchCoordinatorProvider>
          <AutoLaunchHarness taskId="t1" />
        </LaunchCoordinatorProvider>,
      );
      await act(async () => {});
      const ws = FakeWebSocket.instances[0];
      await readyWriter(ws);
      const dispatch = container.querySelector(
        '[data-testid="harness-dispatch"]',
      ) as HTMLButtonElement;

      await act(async () => dispatch.click());
      await waitFor(
        () => {
          expect(countLaunchSends(ws)).toBe(1);
        },
        { timeout: 3000 },
      );
      await act(async () => dispatch.click());
      await waitFor(
        () => {
          expect(
            container.querySelector(
              '[data-testid="embedded-terminal-manual-send-button"]',
            ),
          ).not.toBeNull();
        },
        { timeout: 3000 },
      );

      await act(async () => {
        (
          container.querySelector(
            '[data-testid="embedded-terminal-manual-send-button"]',
          ) as HTMLButtonElement
        ).click();
      });
      // The explicit confirm sends the command...
      expect(countLaunchSends(ws)).toBe(2);
      // ...and the banner clears.
      expect(
        container.querySelector(
          '[data-testid="embedded-terminal-manual-send"]',
        ),
      ).toBeNull();
    });

    it("a fresh pty (new taskId) re-arms the guard — the next launch auto-injects again", async () => {
      const { container, rerender } = render(
        <LaunchCoordinatorProvider>
          <AutoLaunchHarness taskId="t1" />
        </LaunchCoordinatorProvider>,
      );
      await act(async () => {});
      const ws1 = FakeWebSocket.instances[0];
      await readyWriter(ws1);
      await act(async () =>
        (
          container.querySelector(
            '[data-testid="harness-dispatch"]',
          ) as HTMLButtonElement
        ).click(),
      );
      await waitFor(
        () => {
          expect(countLaunchSends(ws1)).toBe(1);
        },
        { timeout: 3000 },
      );

      // Navigate to a different task — fresh pty; the guard must re-arm.
      rerender(
        <LaunchCoordinatorProvider>
          <AutoLaunchHarness taskId="t2" />
        </LaunchCoordinatorProvider>,
      );
      await act(async () => {});
      const ws2 = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
      expect(ws2).not.toBe(ws1);
      await readyWriter(ws2);
      await act(async () =>
        (
          container.querySelector(
            '[data-testid="harness-dispatch"]',
          ) as HTMLButtonElement
        ).click(),
      );
      // Auto-inject again (NOT parked) — the t2 pty is fresh.
      await waitFor(
        () => {
          expect(countLaunchSends(ws2)).toBe(1);
        },
        { timeout: 3000 },
      );
      expect(
        container.querySelector(
          '[data-testid="embedded-terminal-manual-send"]',
        ),
      ).toBeNull();
    });

    it("a WS terminalReset re-arms the guard — the next launch auto-injects again", async () => {
      const { container } = render(
        <LaunchCoordinatorProvider>
          <AutoLaunchHarness taskId="t1" />
        </LaunchCoordinatorProvider>,
      );
      await act(async () => {});
      const ws = FakeWebSocket.instances[0];
      await readyWriter(ws);
      const dispatch = container.querySelector(
        '[data-testid="harness-dispatch"]',
      ) as HTMLButtonElement;

      // Launch #1 — auto-injects, sets the one-shot flag.
      await act(async () => dispatch.click());
      await waitFor(
        () => {
          expect(countLaunchSends(ws)).toBe(1);
        },
        { timeout: 3000 },
      );

      // A fresh pty replaced the lost session — the server re-attaches
      // with terminalReset:true. The one-shot guard must re-arm.
      await act(async () => {
        ws.__message(
          JSON.stringify({
            type: "ready",
            role: "writer",
            shellKind: "pwsh",
            cwd: "C:\\x",
            terminalReset: true,
          }),
        );
      });
      await act(async () => {
        ws.__message(JSON.stringify({ type: "data", payload: "$ " }));
      });

      // Launch #2 — must AUTO-INJECT again (count → 2), NOT park,
      // because terminalReset re-armed the guard.
      await act(async () => dispatch.click());
      await waitFor(
        () => {
          expect(countLaunchSends(ws)).toBe(2);
        },
        { timeout: 3000 },
      );
      expect(
        container.querySelector(
          '[data-testid="embedded-terminal-manual-send"]',
        ),
      ).toBeNull();
    });
  });
});
