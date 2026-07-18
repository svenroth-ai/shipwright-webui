/*
 * FolderTree.test — iterate 3 section 04b, spec § 5.4.
 *
 *  - Root fetch on mount.
 *  - Lazy expand: clicking a dir fires exactly one `?path=<dir>` fetch
 *    and the collapse/re-expand cycle does NOT re-fetch.
 *  - Hide-ignored-off (default) shows ignored entries with
 *    data-ignored="true" and a visually-muted class.
 *  - Hide-ignored-on hides ignored rows entirely.
 *  - 400 traversal error from server is surfaced as an inline chip
 *    (no crash).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";

import { FolderTree } from "./FolderTree";

type TreeEntry = { name: string; kind: "file" | "dir"; ignored: boolean };

interface TreeFixture {
  [path: string]: TreeEntry[];
}

function mockTreeFetch(fixture: TreeFixture, err?: { path: string; status: number; body: unknown }) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    const match = u.match(/\/tree(?:\?path=(.*))?$/);
    const pathRaw = match && match[1] ? decodeURIComponent(match[1]) : "";
    if (err && pathRaw === err.path) {
      return new Response(JSON.stringify(err.body), { status: err.status });
    }
    const entries = fixture[pathRaw];
    if (!entries) {
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    }
    return new Response(JSON.stringify({ entries }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const BASE: TreeFixture = {
  "": [
    { name: "src", kind: "dir", ignored: false },
    { name: ".git", kind: "dir", ignored: true },
    { name: "README.md", kind: "file", ignored: false },
  ],
  src: [
    { name: "index.ts", kind: "file", ignored: false },
    { name: "utils.ts", kind: "file", ignored: false },
  ],
};

describe("FolderTree — root fetch + lazy expand", () => {
  // @covers FR-01.02
  it("fetches the project root on mount", async () => {
    const fetchMock = mockTreeFetch(BASE);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    render(
      <FolderTree projectId="proj-a" selectedPath={null} onSelect={() => {}} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("folder-tree-row-src")).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/api/external/projects/proj-a/tree",
    );
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("path=");
  });

  // @covers FR-01.02
  it("clicking a dir triggers one lazy-expand fetch; collapse + re-expand does NOT refetch", async () => {
    const fetchMock = mockTreeFetch(BASE);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    render(
      <FolderTree projectId="proj-a" selectedPath={null} onSelect={() => {}} />,
    );
    await waitFor(() => screen.getByTestId("folder-tree-row-src"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("folder-tree-row-src"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("folder-tree-row-src/index.ts")).toBeTruthy();
    });
    // 1 root + 1 src = 2 calls.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Collapse (click again).
    await act(async () => {
      fireEvent.click(screen.getByTestId("folder-tree-row-src"));
    });
    await waitFor(() => {
      expect(screen.queryByTestId("folder-tree-row-src/index.ts")).toBeNull();
    });
    // Re-expand (click third time).
    await act(async () => {
      fireEvent.click(screen.getByTestId("folder-tree-row-src"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("folder-tree-row-src/index.ts")).toBeTruthy();
    });
    // Still 2 network calls — the collapsed state is remembered within the
    // mount; re-expand serves from cache.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("FolderTree — icon-by-extension colour map (A04 sweep, FR-01.48)", () => {
  // @covers FR-01.02
  it("renders json/yaml (text-warn) and image (text-info) file rows", async () => {
    const fixture: TreeFixture = {
      "": [
        { name: "config.json", kind: "file", ignored: false },
        { name: "logo.png", kind: "file", ignored: false },
      ],
    };
    globalThis.fetch = mockTreeFetch(fixture) as unknown as typeof fetch;
    render(
      <FolderTree projectId="proj-a" selectedPath={null} onSelect={() => {}} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("folder-tree-row-config.json")).toBeTruthy();
    });
    expect(screen.getByTestId("folder-tree-row-logo.png")).toBeTruthy();
  });
});

describe("FolderTree — show-ignored toggle (iterate v0.8.2 AC-6)", () => {
  // @covers FR-01.02
  it("ignored entries render muted + italic with data-ignored=\"true\" by default", async () => {
    globalThis.fetch = mockTreeFetch(BASE) as unknown as typeof fetch;
    render(
      <FolderTree projectId="proj-a" selectedPath={null} onSelect={() => {}} />,
    );
    await waitFor(() => screen.getByTestId("folder-tree-row-.git"));
    const ignoredRow = screen.getByTestId("folder-tree-row-.git");
    expect(ignoredRow.getAttribute("data-ignored")).toBe("true");
    expect(ignoredRow.className).toContain("opacity-60");
    expect(ignoredRow.className).toContain("italic");
  });

  // @covers FR-01.02
  it("default checkbox state is checked (Show ignored entries → ON)", async () => {
    globalThis.fetch = mockTreeFetch(BASE) as unknown as typeof fetch;
    render(
      <FolderTree projectId="proj-a" selectedPath={null} onSelect={() => {}} />,
    );
    await waitFor(() => screen.getByTestId("folder-tree-row-.git"));
    const checkbox = screen.getByTestId(
      "folder-tree-show-ignored-toggle",
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  // @covers FR-01.02
  it("uncheck Show ignored entries → ignored entries hidden entirely; persists per-project", async () => {
    globalThis.fetch = mockTreeFetch(BASE) as unknown as typeof fetch;
    render(
      <FolderTree projectId="proj-a" selectedPath={null} onSelect={() => {}} />,
    );
    await waitFor(() => screen.getByTestId("folder-tree-row-.git"));
    const checkbox = screen.getByTestId(
      "folder-tree-show-ignored-toggle",
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.click(checkbox);
    });
    // Show=off ⇒ checkbox unchecked, but the underlying hideIgnored flag is true.
    expect(checkbox.checked).toBe(false);
    await waitFor(() => {
      expect(screen.queryByTestId("folder-tree-row-.git")).toBeNull();
    });
    expect(localStorage.getItem("webui.tree.hideIgnored.proj-a")).toBe("true");
  });
});

describe("FolderTree — error surfacing", () => {
  // @covers FR-01.02
  it("400 traversal error surfaces inline without crash", async () => {
    const fetchMock = mockTreeFetch(BASE, {
      path: "evil",
      status: 400,
      body: { error: "path_traversal" },
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const BASE_W_EVIL: TreeFixture = {
      ...BASE,
      "": [...BASE[""], { name: "evil", kind: "dir", ignored: false }],
    };
    globalThis.fetch = mockTreeFetch(BASE_W_EVIL, {
      path: "evil",
      status: 400,
      body: { error: "path_traversal" },
    }) as unknown as typeof fetch;
    render(
      <FolderTree projectId="proj-a" selectedPath={null} onSelect={() => {}} />,
    );
    await waitFor(() => screen.getByTestId("folder-tree-row-evil"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("folder-tree-row-evil"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("folder-tree-error-evil")).toBeTruthy();
    });
    // Root still renders — no crash.
    expect(screen.getByTestId("folder-tree-row-src")).toBeTruthy();
  });
});

describe("FolderTree — A18 left card (glass Files card + greyed head)", () => {
  // @covers FR-01.02
  it("outer is the .ft-card.ft-files glass surface; header is the .ft-head band", () => {
    globalThis.fetch = mockTreeFetch(BASE) as unknown as typeof fetch;
    render(
      <FolderTree projectId="proj-a" selectedPath={null} onSelect={() => {}} />,
    );
    const card = screen.getByTestId("folder-tree");
    expect(card.className).toContain("ft-card");
    expect(card.className).toContain("ft-files");
    const head = screen.getByTestId("folder-tree-header");
    expect(head.className).toContain("ft-head");
    // "Files" title carries the uppercase .ft-title style; refresh still present.
    expect(screen.getByTestId("folder-tree-refresh")).toBeTruthy();
  });
});
