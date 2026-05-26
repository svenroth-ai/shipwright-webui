/*
 * usePasteImage — unit tests (Campaign C / C5).
 *
 * Covers:
 *   - Image-wins precedence; multiple image items: first wins (openai #13).
 *   - Text-only routes through term.paste.
 *   - Scope gate: outside-container paste ignored.
 *   - Server gitignoreSuggestion + 5xx error callbacks.
 *   - Listener does NOT re-register on callback identity change (openai #8).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import type { Terminal } from "@xterm/xterm";

import { usePasteImage } from "./usePasteImage";
import { FakeDataTransfer, fakeClipboardEvent } from "./__fixtures__/fake-clipboard";

function harness(props: {
  taskId?: string;
  onGitignoreSuggestion?: () => void;
  onPasteImageError?: (s: string) => void;
}): {
  container: HTMLDivElement;
  pasteSpy: ReturnType<typeof vi.fn>;
  rerender: (next: typeof props) => void;
  unmount: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const pasteSpy = vi.fn();

  const { rerender, unmount } = renderHook(
    (p: typeof props) => {
      const containerRef = useRef<HTMLDivElement | null>(container);
      const termRef = useRef<Terminal | null>({
        paste: pasteSpy,
      } as unknown as Terminal);
      const disposedRef = useRef<boolean>(false);
      usePasteImage({
        taskId: p.taskId ?? "t1",
        containerRef,
        termRef,
        disposedRef,
        onGitignoreSuggestion: p.onGitignoreSuggestion,
        onPasteImageError: p.onPasteImageError,
      });
    },
    { initialProps: props },
  );

  return {
    container,
    pasteSpy,
    rerender: (next) => rerender(next),
    unmount: () => {
      unmount();
      container.remove();
    },
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: vi.fn(async () => ({
      ok: true,
      json: async () => ({ gitignoreSuggestion: false }),
    })),
  });
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("usePasteImage", () => {
  it("image-wins: image clipboard item triggers fetch to /paste-image", async () => {
    const h = harness({});
    try {
      const dt = new FakeDataTransfer();
      dt.items.add(
        new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "x.png", {
          type: "image/png",
        }),
      );
      const ev = fakeClipboardEvent(dt);
      await act(async () => {
        h.container.dispatchEvent(ev);
      });
      expect(ev.defaultPrevented).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/terminal/t1/paste-image",
        expect.objectContaining({ method: "POST" }),
      );
    } finally {
      h.unmount();
    }
  });

  it("text-only: no fetch, routes through term.paste()", async () => {
    const h = harness({});
    try {
      const dt = new FakeDataTransfer();
      dt.items.add("hello\nworld", "text/plain");
      const ev = fakeClipboardEvent(dt);
      await act(async () => {
        h.container.dispatchEvent(ev);
      });
      expect(ev.defaultPrevented).toBe(true);
      expect(h.pasteSpy).toHaveBeenCalledWith("hello\nworld");
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      h.unmount();
    }
  });

  it("image-wins: mixed text+image still fetches and drops text", async () => {
    const h = harness({});
    try {
      const dt = new FakeDataTransfer();
      dt.items.add("ignored-by-image-wins", "text/plain");
      dt.items.add(new File([new Uint8Array([1])], "y.png", { type: "image/png" }));
      await act(async () => {
        h.container.dispatchEvent(fakeClipboardEvent(dt));
      });
      expect(globalThis.fetch).toHaveBeenCalled();
      expect(h.pasteSpy).not.toHaveBeenCalled();
    } finally {
      h.unmount();
    }
  });

  it("multiple image items: FIRST in iteration order wins (openai #13)", async () => {
    const h = harness({});
    try {
      const dt = new FakeDataTransfer();
      dt.items.add(new File([new Uint8Array([1])], "first.png", { type: "image/png" }));
      dt.items.add(new File([new Uint8Array([2])], "second.gif", { type: "image/gif" }));
      await act(async () => {
        h.container.dispatchEvent(fakeClipboardEvent(dt));
      });
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    } finally {
      h.unmount();
    }
  });

  it("outside-container paste is ignored (scope gate)", async () => {
    const h = harness({});
    try {
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
      expect(h.pasteSpy).not.toHaveBeenCalled();
      outside.remove();
    } finally {
      h.unmount();
    }
  });

  it("empty clipboardData: no-op (no preventDefault, no fetch)", async () => {
    const h = harness({});
    try {
      await act(async () => {
        h.container.dispatchEvent(fakeClipboardEvent(new FakeDataTransfer()));
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      h.unmount();
    }
  });

  it("server gitignoreSuggestion:true → onGitignoreSuggestion fires", async () => {
    const gitignore = vi.fn();
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: vi.fn(async () => ({
        ok: true,
        json: async () => ({ gitignoreSuggestion: true, path: "x" }),
      })),
    });
    const h = harness({ onGitignoreSuggestion: gitignore });
    try {
      const dt = new FakeDataTransfer();
      dt.items.add(new File([new Uint8Array([1])], "x.png", { type: "image/png" }));
      await act(async () => {
        h.container.dispatchEvent(fakeClipboardEvent(dt));
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(gitignore).toHaveBeenCalledTimes(1);
    } finally {
      h.unmount();
    }
  });

  it("server 5xx → onPasteImageError called with detail", async () => {
    const err = vi.fn();
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: "boom" }),
      })),
    });
    const h = harness({ onPasteImageError: err });
    try {
      const dt = new FakeDataTransfer();
      dt.items.add(new File([new Uint8Array([1])], "x.png", { type: "image/png" }));
      await act(async () => {
        h.container.dispatchEvent(fakeClipboardEvent(dt));
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(err).toHaveBeenCalledWith("boom");
    } finally {
      h.unmount();
    }
  });

  it("callback identity change does NOT re-register the listener (openai #8 MED)", async () => {
    // Two pastes across a re-render with NEW callback identities. If the
    // listener re-registered, each paste would fire the handler multiple
    // times; fetch must end at exactly 2 calls (1 per paste).
    const h = harness({});
    try {
      const dt1 = new FakeDataTransfer();
      dt1.items.add(new File([new Uint8Array([1])], "a.png", { type: "image/png" }));
      await act(async () => {
        h.container.dispatchEvent(fakeClipboardEvent(dt1));
      });
      h.rerender({
        onGitignoreSuggestion: () => {},
        onPasteImageError: () => {},
      });
      const dt2 = new FakeDataTransfer();
      dt2.items.add(new File([new Uint8Array([2])], "b.png", { type: "image/png" }));
      await act(async () => {
        h.container.dispatchEvent(fakeClipboardEvent(dt2));
      });
      expect(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBe(2);
    } finally {
      h.unmount();
    }
  });
});
