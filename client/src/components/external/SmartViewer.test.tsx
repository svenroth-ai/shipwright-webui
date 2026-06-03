/*
 * SmartViewer.test — iterate 3 section 04b, spec § 5.5.
 *
 *  - Extension dispatch table (resolveKind).
 *  - 1 MB client cap renders the "File too large" chip without calling
 *    into MarkdownText / rehype-highlight.
 *  - FileTooLargeError (both server-origin and client-origin) is
 *    handled by the "too large" branch.
 *  - Image renderer uses the file URL (no fetch).
 *  - Empty-state renders when path is null.
 *
 * Mermaid dispose / re-render and lazy-import behaviour are unit-tested
 * in MermaidRenderer.test.tsx — this file stays focused on dispatch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

import {
  SmartViewer,
  resolveKind,
  CLIENT_FILE_TEXT_MAX_BYTES,
} from "./SmartViewer";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("resolveKind — extension dispatch matrix", () => {
  it.each([
    ["README.md", "markdown", "md"],
    ["docs/foo.markdown", "markdown", "markdown"],
    ["chart.mmd", "mermaid", "mmd"],
    ["chart.mermaid", "mermaid", "mermaid"],
    ["logo.png", "image", "png"],
    ["logo.jpg", "image", "jpg"],
    ["logo.jpeg", "image", "jpeg"],
    ["logo.gif", "image", "gif"],
    ["logo.svg", "image", "svg"],
    ["logo.webp", "image", "webp"],
    ["clip.mp4", "video", "mp4"],
    ["clip.m4v", "video", "m4v"],
    ["clip.webm", "video", "webm"],
    ["clip.ogv", "video", "ogv"],
    ["clip.ogg", "video", "ogg"],
    ["clip.mov", "video", "mov"],
    ["src/index.ts", "code", "ts"],
    ["src/App.tsx", "code", "tsx"],
    ["config.json", "code", "json"],
    ["config.yaml", "code", "yaml"],
    ["app.py", "code", "py"],
    ["server.go", "code", "go"],
    ["notes.txt", "text", "txt"],
    ["server.log", "text", "log"],
    ["data.csv", "text", "csv"],
    ["mystery.unknown-ext", "unknown", "unknown-ext"],
    ["noext", "unknown", ""],
  ])("resolveKind(%s) → {kind: %s, ext: %s}", (path, kind, ext) => {
    expect(resolveKind(path)).toEqual({ kind, ext });
  });
});

describe("SmartViewer — empty + unsupported states", () => {
  it("null path → empty state", () => {
    render(<SmartViewer projectId="proj-a" path={null} />);
    expect(screen.getByTestId("smart-viewer-empty")).toBeTruthy();
  });

  it("unknown extension → 'Unsupported file type' chip", () => {
    render(<SmartViewer projectId="proj-a" path="mystery.xyz" />);
    expect(screen.getByTestId("smart-viewer-unknown")).toBeTruthy();
  });

  it("video extension → <video> renderer (AC6, no fetch)", () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    render(<SmartViewer projectId="proj-a" path="demo/clip.mp4" />);
    const container = screen.getByTestId("smart-viewer-video");
    const video = container.querySelector("video");
    expect(video).toBeTruthy();
    expect(video?.getAttribute("src")).toContain(
      "/api/external/projects/proj-a/media?path=demo%2Fclip.mp4",
    );
    // <video> streams directly via src — the component issues no fetch.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SmartViewer — 1 MB client cap", () => {
  it("server-side 413 (file_too_large) → 'File too large' chip, no renderer call", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: "file_too_large", maxBytes: 5242880, size: 6_000_000 }),
          { status: 413, headers: { "Content-Type": "application/json" } },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<SmartViewer projectId="proj-a" path="big.md" />);
    await waitFor(() => {
      expect(screen.getByTestId("smart-viewer-too-large")).toBeTruthy();
    });
    // No markdown body was rendered.
    expect(screen.queryByTestId("smart-viewer-markdown")).toBeNull();
  });

  it("client-side 1 MB cap (server returns big text) → chip, no markdown call", async () => {
    // Over the 1 MB client cap, under the 5 MB server cap — server emits
    // the full body, client refuses to hand it to react-markdown.
    const big = "a".repeat(CLIENT_FILE_TEXT_MAX_BYTES + 10);
    const fetchMock = vi.fn(
      async () =>
        new Response(big, {
          status: 200,
          headers: { "Content-Type": "text/markdown; charset=utf-8" },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<SmartViewer projectId="proj-a" path="also-big.md" />);
    await waitFor(() => {
      expect(screen.getByTestId("smart-viewer-too-large")).toBeTruthy();
    });
    expect(screen.queryByTestId("smart-viewer-markdown")).toBeNull();
  });
});

describe("SmartViewer — markdown + text + code happy paths", () => {
  function mockFetchOk(bodyText: string, contentType = "text/plain; charset=utf-8") {
    return vi.fn(
      async () =>
        new Response(bodyText, {
          status: 200,
          headers: { "Content-Type": contentType },
        }),
    );
  }

  it("markdown path dispatches to MarkdownRenderer", async () => {
    globalThis.fetch = mockFetchOk("# hi", "text/markdown; charset=utf-8") as unknown as typeof fetch;
    render(<SmartViewer projectId="proj-a" path="README.md" />);
    await waitFor(() => {
      expect(screen.getByTestId("smart-viewer-markdown")).toBeTruthy();
    });
  });

  it("code path dispatches to CodeRenderer with correct extension", async () => {
    globalThis.fetch = mockFetchOk("const x = 1;") as unknown as typeof fetch;
    render(<SmartViewer projectId="proj-a" path="src/demo.ts" />);
    await waitFor(() => {
      expect(screen.getByTestId("smart-viewer-code")).toBeTruthy();
    });
    const node = screen.getByTestId("smart-viewer-code");
    expect(node.getAttribute("data-extension")).toBe("ts");
    expect(node.getAttribute("data-language")).toBe("typescript");
  });

  it("text path dispatches to TextRenderer", async () => {
    globalThis.fetch = mockFetchOk("line 1\nline 2\n") as unknown as typeof fetch;
    render(<SmartViewer projectId="proj-a" path="notes.txt" />);
    await waitFor(() => {
      expect(screen.getByTestId("smart-viewer-text")).toBeTruthy();
    });
  });
});

describe("SmartViewer — pop-out modal (popOut prop)", () => {
  function mockMarkdown(body = "# hello world") {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/markdown; charset=utf-8" },
        }),
    ) as unknown as typeof fetch;
  }

  it("popOut={false} suppresses the pop-out button (modal-nested instance)", async () => {
    mockMarkdown();
    render(<SmartViewer projectId="proj-a" path="README.md" popOut={false} />);
    await waitFor(() => {
      expect(screen.getByTestId("smart-viewer-markdown")).toBeTruthy();
    });
    expect(screen.queryByTestId("smart-viewer-popout")).toBeNull();
  });

  it("clicking pop-out opens the centered in-app modal and never calls window.open", async () => {
    mockMarkdown();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<SmartViewer projectId="proj-a" path="README.md" />);

    await waitFor(() => {
      expect(screen.getByTestId("smart-viewer-popout")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("smart-viewer-popout"));

    await waitFor(() => {
      expect(screen.getByTestId("smart-viewer-modal")).toBeTruthy();
    });
    expect(openSpy).not.toHaveBeenCalled();
    // The SmartViewer nested inside the modal renders no further pop-out
    // button → exactly one pop-out control remains in the DOM (the pane's).
    expect(screen.getAllByTestId("smart-viewer-popout")).toHaveLength(1);
    openSpy.mockRestore();
  });
});

describe("SmartViewer — image dispatch", () => {
  it("image path renders an <img> with the file-URL and no fetch()", () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    render(<SmartViewer projectId="proj-a" path="logo.png" />);
    const host = screen.getByTestId("smart-viewer-image");
    expect(host).toBeTruthy();
    const img = host.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.getAttribute("src")).toContain(
      "/api/external/projects/proj-a/file?path=logo.png",
    );
    // The renderer itself does not make a fetch() call — it delegates to
    // the browser's image loader.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
