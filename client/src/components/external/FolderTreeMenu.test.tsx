import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

import { FolderTree } from "./FolderTree";
import { absoluteTreePath } from "./folderTreePaths";

function mockFetch() {
  return vi.fn(async () =>
    new Response(JSON.stringify({ entries: [{ name: "package.json", kind: "file", ignored: false }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

const ROOT = "C:" + String.fromCharCode(92) + "proj";
let written: string[];
beforeEach(() => {
  localStorage.clear();
  written = [];
  vi.stubGlobal("fetch", mockFetch());
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async (t: string) => void written.push(t)) },
  });
});

describe("folderTreePaths", () => {
  // @covers FR-01.66
  it("joins absolute paths with the root's separator", () => {
    const b = String.fromCharCode(92);
    expect(absoluteTreePath(`C:${b}proj${b}`, "client/package.json")).toBe(`C:${b}proj${b}client${b}package.json`);
    expect(absoluteTreePath("/home/p", "a/b.ts")).toBe("/home/p/a/b.ts");
  });
});

describe("FolderTree context menu", () => {
  // @covers FR-01.66
  it("right-click offers three items and copies absolute + relative paths", async () => {
    const onSelect = vi.fn();
    render(<FolderTree flat projectId="p" selectedPath={null} onSelect={onSelect} projectRoot={ROOT} />);
    const row = await screen.findByTestId("folder-tree-row-package.json");
    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    const menu = await screen.findByTestId("folder-tree-menu");
    expect(menu.textContent).toContain("Open in Viewer");
    expect(menu.textContent).not.toMatch(/Ctrl|⌘|Cmd/);
    fireEvent.click(await screen.findByText("Copy Path"));
    await waitFor(() => expect(written).toEqual([ROOT + String.fromCharCode(92) + "package.json"]));
    expect(await screen.findByText("Path copied")).toBeTruthy();
    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    fireEvent.click(await screen.findByText("Copy Relative Path"));
    await waitFor(() => expect(written[1]).toBe("package.json"));
  });

  // @covers FR-01.66
  it("the ... button opens a bottom sheet whose Open in Viewer selects the file", async () => {
    const onSelect = vi.fn();
    render(<FolderTree projectId="p" selectedPath={null} onSelect={onSelect} />);
    fireEvent.click(await screen.findByTestId("folder-tree-more-package.json"));
    expect(await screen.findByTestId("folder-tree-sheet")).toBeTruthy();
    fireEvent.click(screen.getByText("Open in Viewer"));
    expect(onSelect).toHaveBeenCalledWith("package.json");
  });

  // @covers FR-01.66
  it("clicking a file selects it directly without a menu", async () => {
    const onSelect = vi.fn();
    render(<FolderTree flat projectId="p" selectedPath={null} onSelect={onSelect} />);
    fireEvent.click(await screen.findByTestId("folder-tree-row-package.json"));
    expect(onSelect).toHaveBeenCalledWith("package.json");
    expect(screen.queryByTestId("folder-tree-menu")).toBeNull();
  });
});

describe("FolderTree context menu edge cases", () => {
  // @covers FR-01.66
  it("disables Copy Path without a project root", async () => {
    render(<FolderTree projectId="p" selectedPath={null} onSelect={vi.fn()} />);
    fireEvent.contextMenu(await screen.findByTestId("folder-tree-row-package.json"), { clientX: 1, clientY: 1 });
    const item = await screen.findByText("Copy Path");
    expect(item.getAttribute("data-disabled")).not.toBeNull();
  });

  // @covers FR-01.66
  it("shows Copy failed when the clipboard rejects", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    document.execCommand = vi.fn(() => false);
    render(<FolderTree projectId="p" selectedPath={null} onSelect={vi.fn()} />);
    fireEvent.contextMenu(await screen.findByTestId("folder-tree-row-package.json"), { clientX: 1, clientY: 1 });
    fireEvent.click(await screen.findByText("Copy Relative Path"));
    await waitFor(() => expect(screen.getByTestId("folder-tree-toast").textContent).toBe("Copy failed"));
  });
});
