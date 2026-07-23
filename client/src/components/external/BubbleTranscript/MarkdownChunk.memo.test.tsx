/*
 * MarkdownChunk memoization (iterate-2026-07-23-transcript-incremental-render,
 * AC6). react-markdown + rehype-highlight is the most expensive per-bubble
 * render. With the incremental parse keeping an unchanged bubble's text
 * referentially stable, `memo` lets that bubble skip the markdown re-render a
 * streaming poll would otherwise force. MarkdownText is mocked with a render
 * counter (isolated to this file) to observe the skip directly.
 */

import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { useState } from "react";

let renderCount = 0;
vi.mock("../MarkdownText", () => ({
  MarkdownText: ({ text }: { text: string }) => {
    renderCount += 1;
    return <div data-testid="md">{text}</div>;
  },
}));

import { MarkdownChunk } from "./MarkdownChunk";

describe("MarkdownChunk memoization (AC6)", () => {
  it("skips re-render when content is unchanged across a parent re-render", () => {
    let bump: () => void = () => {};
    function Parent() {
      const [, setN] = useState(0);
      bump = () => setN((n) => n + 1);
      return <MarkdownChunk content="stable text" />;
    }
    renderCount = 0;
    render(<Parent />);
    expect(renderCount).toBe(1);
    act(() => bump()); // parent re-renders; content prop is identical
    expect(renderCount).toBe(1); // memo skipped the child
  });

  it("re-renders when content changes", () => {
    let setContent: (s: string) => void = () => {};
    function Parent() {
      const [c, setC] = useState("a");
      setContent = setC;
      return <MarkdownChunk content={c} />;
    }
    renderCount = 0;
    render(<Parent />);
    expect(renderCount).toBe(1);
    act(() => setContent("b"));
    expect(renderCount).toBe(2);
  });
});
