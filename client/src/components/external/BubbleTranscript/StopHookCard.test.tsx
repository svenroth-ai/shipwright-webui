/*
 * StopHookCard renderer specs — iterate-2026-05-27-transcript-renderer-scroll AC3.
 *
 * Collapsed-by-default; the gate name shows in the header always, the
 * body only after expand. Mirrors the SkillCard interaction contract.
 */

import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";

import { StopHookCard } from "./StopHookCard";

const BODY = [
  "Stop hook feedback:",
  "================================================================",
  "  SHIPWRIGHT BLOAT GATE — Stop blocked",
  "================================================================",
  "",
  "    NO COMPLETION WHILE FILES ARE GROWING UNCHECKED",
].join("\n");

describe("StopHookCard", () => {
  it("renders collapsed by default — gate name visible, body hidden", () => {
    const { container } = render(<StopHookCard gateName="SHIPWRIGHT BLOAT GATE" body={BODY} />);
    expect(container.querySelector("[data-testid='stop-hook-card']")).not.toBeNull();
    expect(container.querySelector("[data-testid='stop-hook-card-gate']")!.textContent).toBe(
      "SHIPWRIGHT BLOAT GATE",
    );
    expect(container.querySelector("[data-testid='stop-hook-card-body']")).toBeNull();
    const header = container.querySelector("[data-testid='stop-hook-card-header']");
    expect(header!.getAttribute("aria-expanded")).toBe("false");
  });

  it("expands on header click to reveal the raw body", () => {
    const { container } = render(<StopHookCard gateName="SHIPWRIGHT BLOAT GATE" body={BODY} />);
    const header = container.querySelector("[data-testid='stop-hook-card-header']")!;
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("true");
    const body = container.querySelector("[data-testid='stop-hook-card-body']");
    expect(body).not.toBeNull();
    expect(body!.textContent).toContain("NO COMPLETION WHILE FILES ARE GROWING UNCHECKED");
  });

  it("collapses again on a second click", () => {
    const { container } = render(<StopHookCard gateName="SHIPWRIGHT BLOAT GATE" body={BODY} />);
    const header = container.querySelector("[data-testid='stop-hook-card-header']")!;
    fireEvent.click(header);
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("[data-testid='stop-hook-card-body']")).toBeNull();
  });

  it("preserves the body in a <pre> so ASCII banner alignment survives", () => {
    const { container } = render(<StopHookCard gateName="X" body={BODY} />);
    fireEvent.click(container.querySelector("[data-testid='stop-hook-card-header']")!);
    const pre = container.querySelector("[data-testid='stop-hook-card-body'] pre");
    expect(pre).not.toBeNull();
    // Box-drawing `=` line must be present verbatim (not Markdown-mangled).
    expect(pre!.textContent).toContain("================================================================");
  });
});
