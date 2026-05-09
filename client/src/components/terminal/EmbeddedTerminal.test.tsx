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

// iterate-2026-05-08 v0.8.7 AC-4 — mock xterm's `buffer.active` so tests
// can verify that the marker-count footer reads from the buffer (not from
// chunk substring counting). Tests push string lines into mockBufferLines
// before triggering replay_end.
const mockBufferLines: string[] = [];
const mockBufferActive = {
  get length() {
    return mockBufferLines.length;
  },
  getLine(i: number) {
    if (i < 0 || i >= mockBufferLines.length) return undefined;
    const text = mockBufferLines[i];
    return {
      translateToString: (_trim?: boolean) => text,
    };
  },
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
    buffer: { active: mockBufferActive },
  })),
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(() => ({ fit: fitSpy, activate: vi.fn(), dispose: vi.fn() })),
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn().mockImplementation(() => ({ activate: vi.fn(), dispose: vi.fn() })),
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
    mockBufferLines.length = 0;

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

  it("renders the read-only banner when ready arrives with role=reader, and clears it on writer-promoted (StrictMode race fence)", async () => {
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
    expect(container.querySelector('[data-testid="embedded-terminal-readonly"]')).not.toBeNull();
    // Promotion clears the banner.
    await act(async () => {
      ws.__message(JSON.stringify({ type: "writer-promoted" }));
    });
    expect(container.querySelector('[data-testid="embedded-terminal-readonly"]')).toBeNull();
  });

  // Iterate v0.8.3 AC-1 wiring tests for `attachCustomKeyEventHandler`
  // were removed in v0.8.5 AC-2 alongside the Ctrl+V interceptor itself.
  // The DOM `paste` listener (right-click → Paste menu, programmatic
  // paste, Edge/Chrome legacy paths) is still covered by the
  // "paste-handler — …" cases above.

  // Iterate v0.8.5 AC-3 — defensive replay-clear regression.
  // EmbeddedTerminal subscribes to `replay_start` and calls term.clear()
  // before scrollback chunks land. For a freshly-mounted xterm this is
  // a visual no-op (already empty); for any future WS-reconnect path
  // that hits the same EmbeddedTerminal instance it guarantees that
  // a second replay does NOT stack on top of the first.
  it("calls term.clear() when the replay_start envelope arrives", async () => {
    render(<EmbeddedTerminal taskId="t1" active />);
    await act(async () => {});
    const ws = FakeWebSocket.instances[0];
    expect(ws).toBeDefined();
    // Initially clear() should NOT have been called (no replay yet).
    expect(clearSpy).not.toHaveBeenCalled();
    await act(async () => {
      ws.__message(JSON.stringify({ type: "replay_start", totalBytes: 1024 }));
    });
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it("calls term.clear() AGAIN if a second replay_start arrives (e.g. WS reconnect mid-session)", async () => {
    render(<EmbeddedTerminal taskId="t1" active />);
    await act(async () => {});
    const ws = FakeWebSocket.instances[0];
    await act(async () => {
      ws.__message(JSON.stringify({ type: "replay_start", totalBytes: 100 }));
      ws.__message(JSON.stringify({ type: "replay_chunk", payload: "first" }));
      ws.__message(JSON.stringify({ type: "replay_end" }));
      ws.__message(JSON.stringify({ type: "replay_start", totalBytes: 200 }));
    });
    expect(clearSpy).toHaveBeenCalledTimes(2);
  });

  // Iterate v0.8.6 follow-up — after replay completes, EmbeddedTerminal
  // scrolls xterm to the bottom of the buffer so the live shell prompt
  // is visible immediately. Without this, the viewport stays at the
  // buffer top (showing replayed content) and the user has to scroll
  // down manually past the "scrollback restored from disk; live shell
  // below" separator to interact.
  it("calls term.scrollToBottom() after replay_end so the live shell is in view", async () => {
    render(<EmbeddedTerminal taskId="t1" active />);
    await act(async () => {});
    const ws = FakeWebSocket.instances[0];
    expect(scrollToBottomSpy).not.toHaveBeenCalled();
    await act(async () => {
      ws.__message(JSON.stringify({ type: "replay_start", totalBytes: 100 }));
      ws.__message(JSON.stringify({ type: "replay_chunk", payload: "history" }));
      ws.__message(JSON.stringify({ type: "replay_end" }));
    });
    expect(scrollToBottomSpy).toHaveBeenCalledTimes(1);
  });

  // iterate-2026-05-09 v0.8.9 — replay-pushdown so live shell renders at
  // the top of the visible viewport.
  //
  // Bug fixed: after replay_end the historical scrollback (incl. separator
  // banner) sat in xterm's ACTIVE AREA. Cursor parked at row N+1 (end of
  // replay). Live shell content (PowerShell + Claude TUI) wrote from
  // cursor → rendered BELOW replay → viewport showed replay at top, live
  // shell at the bottom. Compounded by TERM=dumb (set in
  // server/src/terminal/routes.ts createNodePtySpawnFn for the chalk
  // brand-color hack) which suppresses ConPTY's own \x1b[2J\x1b[H startup
  // emit, so nothing else clears the active area for the live shell.
  //
  // Fix: after replay_end push `term.rows` worth of \r\n into xterm so
  // the entire replayed content scrolls out of the active area into the
  // scrollback above, then write \x1b[H to home the cursor on the now-
  // empty active area. Live shell then renders from row 0 of the
  // viewport. Replay history stays accessible by scrolling up.
  it("after replay_end pushes replay into scrollback and homes the cursor (so live shell renders at viewport top)", async () => {
    render(<EmbeddedTerminal taskId="t1" active />);
    await act(async () => {});
    const ws = FakeWebSocket.instances[0];
    await act(async () => {
      ws.__message(JSON.stringify({ type: "replay_start", totalBytes: 100 }));
      ws.__message(JSON.stringify({ type: "replay_chunk", payload: "history" }));
      ws.__message(JSON.stringify({ type: "replay_end" }));
    });
    const calls = writeSpy.mock.calls.map((c) => c[0]);
    // Mock Terminal exposes rows=30 (see vi.mock above).
    expect(calls).toContain("\r\n".repeat(30));
    expect(calls).toContain("\x1b[H");
    // Order matters: pushdown first (advances cursor past active-area
    // bottom — scrolls replay into scrollback), THEN cursor-home so the
    // live shell starts at row 0 of the now-empty active area.
    const pushIdx = calls.lastIndexOf("\r\n".repeat(30));
    const homeIdx = calls.lastIndexOf("\x1b[H");
    expect(pushIdx).toBeGreaterThanOrEqual(0);
    expect(homeIdx).toBeGreaterThan(pushIdx);
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

  // -------------------------------------------------------------------
  // iterate-2026-05-08 v0.8.7 AC-4 — historical-shell-sessions footer.
  //
  // After replay_end fires AND the xterm buffer contains ≥2 of the
  // `──── shell stopped at` markers, render a dim footer with the
  // count + a "Clear history" button. Per external plan review: count
  // is read from `term.buffer.active` AFTER replay_end (xterm reassembled
  // chunk-split markers), NOT from per-chunk substring counting.
  // -------------------------------------------------------------------
  describe("AC-4 — stopped-sessions footer", () => {
    function fireReplayCycle(ws: FakeWebSocket): Promise<void> {
      return act(async () => {
        ws.__message(JSON.stringify({ type: "replay_start" }));
        ws.__message(JSON.stringify({ type: "replay_end" }));
      });
    }

    it("renders footer with N=3 when buffer contains 3 marker lines", async () => {
      // Pre-seed the mock buffer with 3 lines containing the marker substring.
      mockBufferLines.push(
        "ls",
        "\x1b[2m──── shell stopped at 12:34:56 ────\x1b[m",
        "PowerShell 7.6.1",
        "\x1b[2m──── shell stopped at 13:00:01 ────\x1b[m",
        "PS C:\\>",
        "\x1b[2m──── shell stopped at 13:30:42 ────\x1b[m",
        "PS C:\\>",
      );

      const { container } = render(<EmbeddedTerminal taskId="t1" active />);
      await act(async () => {});
      const ws = FakeWebSocket.instances[0];
      await fireReplayCycle(ws);

      const footer = container.querySelector(
        '[data-testid="embedded-terminal-stopped-sessions-footer"]',
      );
      expect(footer).not.toBeNull();
      expect(footer?.textContent).toContain("3");
      expect(footer?.textContent?.toLowerCase()).toContain("beendete shell-sessions");
      const btn = container.querySelector(
        '[data-testid="embedded-terminal-clear-history-button"]',
      );
      expect(btn).not.toBeNull();
    });

    it("hides footer when buffer has 0 markers", async () => {
      // No markers in buffer.
      mockBufferLines.push("ls", "echo hi", "PS C:\\>");

      const { container } = render(<EmbeddedTerminal taskId="t1" active />);
      await act(async () => {});
      const ws = FakeWebSocket.instances[0];
      await fireReplayCycle(ws);

      const footer = container.querySelector(
        '[data-testid="embedded-terminal-stopped-sessions-footer"]',
      );
      expect(footer).toBeNull();
    });

    it("hides footer when buffer has only 1 marker (no banner-spam for fresh tasks)", async () => {
      mockBufferLines.push(
        "ls",
        "\x1b[2m──── shell stopped at 12:34:56 ────\x1b[m",
        "PS C:\\>",
      );

      const { container } = render(<EmbeddedTerminal taskId="t1" active />);
      await act(async () => {});
      const ws = FakeWebSocket.instances[0];
      await fireReplayCycle(ws);

      const footer = container.querySelector(
        '[data-testid="embedded-terminal-stopped-sessions-footer"]',
      );
      expect(footer).toBeNull();
    });

    it("Clear history button calls /clear-scrollback after confirm; footer hides on success", async () => {
      mockBufferLines.push(
        "\x1b[2m──── shell stopped at 12:00:00 ────\x1b[m",
        "\x1b[2m──── shell stopped at 13:00:00 ────\x1b[m",
        "PS C:\\>",
      );

      // Mock window.confirm to return true.
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
      fetchSpy.mockClear();

      const { container } = render(<EmbeddedTerminal taskId="t1" active />);
      await act(async () => {});
      const ws = FakeWebSocket.instances[0];
      await fireReplayCycle(ws);

      const footer = container.querySelector(
        '[data-testid="embedded-terminal-stopped-sessions-footer"]',
      );
      expect(footer).not.toBeNull();

      const btn = container.querySelector(
        '[data-testid="embedded-terminal-clear-history-button"]',
      ) as HTMLButtonElement;
      await act(async () => {
        btn.click();
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(confirmSpy).toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/terminal/t1/clear-scrollback",
        expect.objectContaining({ method: "POST" }),
      );

      // Footer hides because count resets to 0 on success.
      const footerAfter = container.querySelector(
        '[data-testid="embedded-terminal-stopped-sessions-footer"]',
      );
      expect(footerAfter).toBeNull();

      confirmSpy.mockRestore();
    });

    it("counts markers via REPLAY ACCUMULATOR (chunks split mid-marker), not just buffer scan", async () => {
      // Per external code review (openai 2026-05-08 medium #4): the
      // production path no longer scans `term.buffer.active` after
      // replay_end — it accumulates `replay_chunk` payloads into a
      // string buffer between replay_start/replay_end and counts the
      // SHELL_STOPPED_SUBSTRING substring there. This test exercises
      // that production path explicitly: marker arrives split across
      // 3 chunks (a worst-case smaller-than-marker-length frame
      // pattern). A pure buffer-scan implementation would miss the
      // split marker; the accumulator catches it because the chunks
      // concatenate before counting.
      mockBufferLines.length = 0; // empty buffer — accumulator must do the work

      const { container } = render(<EmbeddedTerminal taskId="t1" active />);
      await act(async () => {});
      const ws = FakeWebSocket.instances[0];

      // Open the replay window.
      await act(async () => {
        ws.__message(JSON.stringify({ type: "replay_start" }));
      });

      // Three marker strings split across many small chunks.
      const fullMarker = "\x1b[2m──── shell stopped at 12:34:56 ────\x1b[m\r\n";
      const fixture = `prefix-content\r\n${fullMarker}middle-content\r\n${fullMarker}more-content\r\n${fullMarker}suffix`;
      // Send char-by-char to mimic worst-case chunk fragmentation.
      for (let i = 0; i < fixture.length; i++) {
        await act(async () => {
          ws.__message(JSON.stringify({ type: "replay_chunk", payload: fixture[i] }));
        });
      }

      await act(async () => {
        ws.__message(JSON.stringify({ type: "replay_end" }));
      });

      // Footer renders with N=3 (counted via accumulator — buffer was
      // not populated by the mock, so buffer-scan would return 0).
      const footer = container.querySelector(
        '[data-testid="embedded-terminal-stopped-sessions-footer"]',
      );
      expect(footer).not.toBeNull();
      expect(footer?.textContent).toContain("3");
      expect(footer?.textContent?.toLowerCase()).toContain("beendete shell-sessions");
    });

    it("Clear history button is a no-op when user declines confirm", async () => {
      mockBufferLines.push(
        "\x1b[2m──── shell stopped at 12:00:00 ────\x1b[m",
        "\x1b[2m──── shell stopped at 13:00:00 ────\x1b[m",
      );
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
      const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
      fetchSpy.mockClear();

      const { container } = render(<EmbeddedTerminal taskId="t1" active />);
      await act(async () => {});
      const ws = FakeWebSocket.instances[0];
      await fireReplayCycle(ws);

      const btn = container.querySelector(
        '[data-testid="embedded-terminal-clear-history-button"]',
      ) as HTMLButtonElement;
      await act(async () => {
        btn.click();
      });

      expect(confirmSpy).toHaveBeenCalled();
      // No fetch call to clear-scrollback because user declined.
      const clearCall = fetchSpy.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("/clear-scrollback"),
      );
      expect(clearCall).toBeUndefined();

      // Footer remains visible.
      const footer = container.querySelector(
        '[data-testid="embedded-terminal-stopped-sessions-footer"]',
      );
      expect(footer).not.toBeNull();

      confirmSpy.mockRestore();
    });
  });
});
