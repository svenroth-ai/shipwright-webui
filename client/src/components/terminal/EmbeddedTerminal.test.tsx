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
const writeSpy = vi.fn<(d: string) => void>();
const focusSpy = vi.fn();
const disposeSpy = vi.fn();
const clearSpy = vi.fn();
const scrollToBottomSpy = vi.fn();
const onDataHandlers: Array<(d: string) => void> = [];
const fitSpy = vi.fn();

// Iterate C (ADR-087): the v0.8.7 marker-count footer was retired; the
// mock xterm buffer fields below are kept minimal — they only need to
// satisfy the few tests that still touch `term.buffer` (none currently
// — left here as a defensive no-op so future tests don't need to
// re-mock from scratch).
const mockBufferActive = {
  get length() {
    return 0;
  },
  getLine(_i: number) {
    return undefined;
  },
  // Iterate K v4 (ADR-099) — alt-screen-skip check reads this.
  // Default to "normal" so the workaround runs in tests.
  type: "normal" as const,
};

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    cols: 120,
    rows: 30,
    write: writeSpy,
    focus: focusSpy,
    dispose: disposeSpy,
    clear: clearSpy,
    scrollToBottom: scrollToBottomSpy,
    loadAddon: vi.fn(),
    open: vi.fn(),
    onData(cb: (d: string) => void) {
      onDataHandlers.push(cb);
      return { dispose: vi.fn() };
    },
    // Iterate K follow-up (ADR-099) — texture-atlas-clear workaround
    // wires `term.onScroll` to call WebglAddon.clearTextureAtlas. Mock
    // returns a disposable; tests don't assert against scroll behavior.
    onScroll: vi.fn(() => ({ dispose: vi.fn() })),
    // refresh(start, end) — Iterate K v2 calls this after each atlas
    // clear so row-renderer repaints from the fresh atlas (mimicking
    // VS Code's forceRefresh()). Mock is a no-op spy.
    refresh: vi.fn(),
    // onWriteParsed — Iterate K v3 conditional uses this as activity
    // signal to gate the periodic atlas clear (skip when terminal is
    // idle). Mock returns a disposable; tests don't assert on activity
    // counting.
    onWriteParsed: vi.fn(() => ({ dispose: vi.fn() })),
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
  // Iterate K follow-up (ADR-099) — `clearTextureAtlas` is the
  // documented workaround for xterm.js #5847 atlas-merge bug.
  WebglAddon: vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
    dispose: vi.fn(),
    clearTextureAtlas: vi.fn(),
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
import { EmbeddedTerminal, type EmbeddedTerminalHandle } from "./EmbeddedTerminal";

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
    scrollToBottomSpy.mockClear();
    fitSpy.mockClear();
    onDataHandlers.length = 0;

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
  it("ADR-087: writes the replay_snapshot data via term.reset + term.write + scrollToBottom", async () => {
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
    expect(scrollToBottomSpy).toHaveBeenCalled();
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
});
