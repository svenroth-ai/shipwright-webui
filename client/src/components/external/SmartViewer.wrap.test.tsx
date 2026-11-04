/*
 * SmartViewer wrap toggle (V7) — split out of SmartViewer.test.tsx to keep
 * both files under the size ceiling.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { SmartViewer } from "./SmartViewer";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("CodeRenderer wrap toggle (V7)", () => {
  beforeEach(() => {
    window.localStorage.removeItem("shipwright:viewer-wrap-lines");
  });

  // @covers FR-01.02
  it("wraps by default and the toggle flips + persists aria-pressed", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("const x = 1;", { status: 200, headers: { "Content-Type": "text/plain" } }),
    ) as unknown as typeof fetch;
    render(<SmartViewer projectId="proj-a" path="src/demo.ts" />);
    const btn = await screen.findByRole("button", { name: "Wrap lines" });
    const node = screen.getByTestId("smart-viewer-code");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(node.getAttribute("data-wrap")).toBe("true");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(node.getAttribute("data-wrap")).toBe("false");
    expect(window.localStorage.getItem("shipwright:viewer-wrap-lines")).toBe("false");
  });

  // @covers FR-01.02
  it("starts unwrapped when the stored preference is false", async () => {
    window.localStorage.setItem("shipwright:viewer-wrap-lines", "false");
    globalThis.fetch = vi.fn(
      async () => new Response("const x = 1;", { status: 200, headers: { "Content-Type": "text/plain" } }),
    ) as unknown as typeof fetch;
    render(<SmartViewer projectId="proj-a" path="src/demo.ts" />);
    const btn = await screen.findByRole("button", { name: "Wrap lines" });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  // @covers FR-01.02
  it("text path: shared Wrap lines toggle, one stored preference with the code view", async () => {
    window.localStorage.removeItem("shipwright:viewer-wrap-lines");
    globalThis.fetch = vi.fn(
      async () => new Response("a" + String.fromCharCode(10) + "b", { status: 200, headers: { "Content-Type": "text/plain" } }),
    ) as unknown as typeof fetch;
    render(<SmartViewer projectId="proj-a" path="notes.txt" />);
    const btn = await screen.findByRole("button", { name: "Wrap lines" });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("smart-viewer-text").getAttribute("data-wrap")).toBe("true");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("smart-viewer-text").getAttribute("data-wrap")).toBe("false");
    expect(window.localStorage.getItem("shipwright:viewer-wrap-lines")).toBe("false");
  });

  // @covers FR-01.02
  it("class fence: text view wraps with 13px/1.6, hanging indent, number cell separate", () => {
    const css = readFileSync(resolve(__dirname, "../../styles/smart-viewer-code.css"), "utf8");
    expect(css).toMatch(/\.smart-viewer-text\s*\{[^}]*font-size:\s*13px;[^}]*line-height:\s*1\.6/);
    expect(css).toMatch(/\.smart-viewer-text\[data-wrap="true"\]\s*\{[^}]*white-space:\s*pre-wrap/);
    expect(css).toMatch(/\.sv-text-body\s*\{[^}]*padding-left:\s*2ch;[^}]*text-indent:\s*-2ch/);
  });

  // @covers FR-01.02
  it("class fence: hanging indent for wrapped continuation rows", () => {
    const css = readFileSync(resolve(__dirname, "../../styles/smart-viewer-code.css"), "utf8");
    expect(css).toMatch(/text-indent:\s*-2ch each-line/);
    expect(css).toMatch(/\[data-wrap="true"\] pre code\s*\{[^}]*padding-left:\s*calc\(1em \+ 2ch\)/);
  });

  // @covers FR-01.02
  it("class fence: wrap rules + 13px/1.6 live on .smart-viewer-code", () => {
    const css = readFileSync(resolve(__dirname, "../../styles/smart-viewer-code.css"), "utf8");
    expect(css).toMatch(/\[data-wrap="true"\] pre[^{]*\{[^}]*white-space:\s*pre-wrap/);
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\[data-wrap\] pre code\s*\{[^}]*font-size:\s*13px;[^}]*line-height:\s*1\.6/);
  });
});
