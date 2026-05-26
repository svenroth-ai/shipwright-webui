/*
 * AnsiText — Campaign-C C3 BubbleTranscript split (2026-05-26).
 *
 * Public surface contract:
 *   - Strips ANSI escape sequences via `strip-ansi`.
 *   - `isError={true}` flips visual styling (testable via `data-is-error`).
 *   - `convertEol:false` semantics preserved — raw `\n` in input is preserved
 *     as text content (no CR→LF rewriting per memory
 *     `project_bug_b_remount_smear_writerace`).
 *
 * The wrapper delegates to the legacy strip-ansi ToolOutputBlock; this file
 * locks the rename `text` → `text` (same prop), `isError` passthrough, and
 * the bit-perfect ANSI-stripping behaviour.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { AnsiText } from "./AnsiText";

describe("AnsiText", () => {
  it("strips ANSI colour escape sequences from the text content", () => {
    const raw = "[31mERROR[0m: oh no";
    const { container } = render(<AnsiText text={raw} />);
    const pre = container.querySelector("[data-testid='tool-output-block']");
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain("ERROR: oh no");
    // The literal ESC byte must be gone; the visual sequence must NOT survive.
    expect(pre!.textContent).not.toContain("[31m");
    expect(pre!.textContent).not.toContain("[31m");
  });

  it("flips data-is-error attribute when isError is true", () => {
    const { container } = render(<AnsiText text="bad" isError />);
    const pre = container.querySelector("[data-testid='tool-output-block']");
    expect(pre).not.toBeNull();
    expect(pre!.getAttribute("data-is-error")).toBe("true");
  });

  it("does NOT flip data-is-error when isError omitted (default false)", () => {
    const { container } = render(<AnsiText text="ok" />);
    const pre = container.querySelector("[data-testid='tool-output-block']");
    expect(pre!.getAttribute("data-is-error")).toBe("false");
  });

  it("preserves raw \\n line breaks in the rendered text (convertEol:false semantics)", () => {
    // The bubble's ANSI primitive uses a <pre> that renders newlines as
    // newlines without rewriting. We assert the literal `\n` survives into
    // the rendered textContent — no CR injection, no <br> conversion.
    const raw = "line-a\nline-b";
    const { container } = render(<AnsiText text={raw} />);
    const pre = container.querySelector("[data-testid='tool-output-block']");
    expect(pre!.textContent).toBe("line-a\nline-b");
  });

  it("strips C0 control characters that survive strip-ansi (BEL, FF)", () => {
    const raw = "warning bell and  form feed";
    const { container } = render(<AnsiText text={raw} />);
    const pre = container.querySelector("[data-testid='tool-output-block']");
    expect(pre!.textContent).toBe("warning bell and  form feed");
  });
});
