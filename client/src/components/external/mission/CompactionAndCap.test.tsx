import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { CompactionRow } from "./CompactionRow";
import { CappedBody } from "./CappedBody";
import { HandbackCard } from "../HandbackCard";

// @covers FR-01.66
describe("CompactionRow", () => {
  const card = { kind: "system" as const, text: "Context compacted", commands: [], compactSummary: "## Goals\n\n- ship **it**" };

  it("is collapsed by default; Show summary reveals markdown, Hide summary closes it again", () => {
    render(<CompactionRow card={card} />);
    expect(screen.getByText("Context compacted")).toBeTruthy();
    expect(screen.queryByTestId("compaction-summary")).toBeNull();
    const toggle = screen.getByTestId("compaction-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toBe("Show summary");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toBe("Hide summary");
    expect(screen.getByTestId("compaction-summary").querySelector("h2")?.textContent).toBe("Goals");
    expect(screen.getByTestId("compaction-summary").querySelector("strong")?.textContent).toBe("it");
    fireEvent.click(toggle);
    expect(screen.queryByTestId("compaction-summary")).toBeNull();
  });

  it("without a summary there is no toggle", () => {
    render(<CompactionRow card={{ ...card, compactSummary: undefined }} />);
    expect(screen.queryByTestId("compaction-toggle")).toBeNull();
  });
});

// @covers FR-01.66
describe("CappedBody", () => {
  const ro = globalThis.ResizeObserver;
  const proto = HTMLElement.prototype;
  const offset = Object.getOwnPropertyDescriptor(proto, "offsetHeight");
  const client = Object.getOwnPropertyDescriptor(proto, "clientHeight");
  beforeEach(() => {
    globalThis.ResizeObserver = undefined as never;
  });
  afterEach(() => {
    globalThis.ResizeObserver = ro;
    if (offset) Object.defineProperty(proto, "offsetHeight", offset); else Reflect.deleteProperty(proto, "offsetHeight");
    if (client) Object.defineProperty(proto, "clientHeight", client); else Reflect.deleteProperty(proto, "clientHeight");
    vi.restoreAllMocks();
  });
  const heights = (inner: number, clip: number) => {
    Object.defineProperty(proto, "offsetHeight", { configurable: true, get() { return (this as HTMLElement).className === "mc-cap-inner" ? inner : 0; } });
    Object.defineProperty(proto, "clientHeight", { configurable: true, get() { return (this as HTMLElement).className.startsWith("mc-cap") ? clip : 0; } });
  };

  it("short content: no toggle, no fade", () => {
    heights(100, 304);
    render(<CappedBody>short</CappedBody>);
    expect(screen.queryByTestId("capped-body-toggle")).toBeNull();
    expect(document.querySelector(".mc-cap")?.getAttribute("data-fade")).toBeNull();
  });

  it("long content: capped + fade + Show more (aria-expanded) / Show less", () => {
    heights(900, 304);
    render(<CappedBody>long</CappedBody>);
    const cap = document.querySelector(".mc-cap")!;
    expect(cap.getAttribute("data-cap")).toBe("on");
    expect(cap.getAttribute("data-fade")).toBe("on");
    const toggle = screen.getByTestId("capped-body-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe(cap.id);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toBe("Show less");
    expect(cap.getAttribute("data-cap")).toBeNull();
    expect(cap.getAttribute("data-fade")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.textContent).toBe("Show more");
    expect(cap.getAttribute("data-cap")).toBe("on");
  });

  it("focusing inside the clipped region opens it (no invisible scrolling for keyboard users)", () => {
    heights(900, 304);
    render(<CappedBody><a href="#x">link</a></CappedBody>);
    const toggle = screen.getByTestId("capped-body-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.focus(screen.getByText("link"));
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("HandbackCard caps only when asked to", () => {
    heights(900, 304);
    const { rerender } = render(<HandbackCard origin="subagent" sender="abcdef123456" text="body" />);
    expect(screen.queryByTestId("capped-body-toggle")).toBeNull();
    rerender(<HandbackCard origin="subagent" sender="abcdef123456" text="body" capped />);
    expect(screen.getByTestId("capped-body-toggle")).toBeTruthy();
  });
});
