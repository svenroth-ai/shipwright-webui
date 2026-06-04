/*
 * MarkdownEditorToolbar.test.tsx — formatting toolbar behavior
 * (iterate-2026-06-04-md-editor-toolbar, FR-01.34 UX completion).
 *
 * Uses a real TipTap editor (the spike proved TipTap mounts in jsdom — see
 * markdownTiptap.test.ts) mounted through `useEditor` exactly as the modal does,
 * so the toolbar's active-state reactivity is exercised against a live editor,
 * not a hand-rolled mock.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach } from "vitest";
import { useEditor, EditorContent } from "@tiptap/react";

import { buildEditorExtensions } from "../../../lib/markdownTiptap";
import { MarkdownEditorToolbar } from "./MarkdownEditorToolbar";

afterEach(() => cleanup());

function Harness({ content = "" }: { content?: string }) {
  const editor = useEditor({
    extensions: buildEditorExtensions(),
    content,
    immediatelyRender: true,
  });
  return (
    <div>
      <MarkdownEditorToolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

describe("MarkdownEditorToolbar", () => {
  it("renders the core formatting buttons", async () => {
    render(<Harness content="hello world" />);
    expect(await screen.findByTestId("md-editor-toolbar")).toBeTruthy();
    for (const id of [
      "md-tb-bold",
      "md-tb-italic",
      "md-tb-code",
      "md-tb-h1",
      "md-tb-h2",
      "md-tb-h3",
      "md-tb-bullet-list",
      "md-tb-ordered-list",
      "md-tb-blockquote",
      "md-tb-code-block",
      "md-tb-link",
      "md-tb-undo",
      "md-tb-redo",
    ]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
  });

  it("toggles bold and reflects the active state via aria-pressed", async () => {
    const user = userEvent.setup();
    render(<Harness content="hello world" />);
    const bold = await screen.findByTestId("md-tb-bold");
    expect(bold.getAttribute("aria-pressed")).toBe("false");
    await user.click(bold);
    await waitFor(() => expect(bold.getAttribute("aria-pressed")).toBe("true"));
    await user.click(bold);
    await waitFor(() => expect(bold.getAttribute("aria-pressed")).toBe("false"));
  });

  it("toggles a heading level and reflects the active state", async () => {
    const user = userEvent.setup();
    render(<Harness content="hello" />);
    const h1 = await screen.findByTestId("md-tb-h1");
    expect(h1.getAttribute("aria-pressed")).toBe("false");
    await user.click(h1);
    await waitFor(() => expect(h1.getAttribute("aria-pressed")).toBe("true"));
  });

  it("disables undo when the history is empty", async () => {
    render(<Harness content="" />);
    expect(await screen.findByTestId("md-tb-undo")).toBeDisabled();
  });

  it("opens a URL prompt when the link button is clicked (cancel is a safe no-op)", async () => {
    // The link button is the one bespoke command (prompt → setLink); the
    // setLink↔markdown serialization itself is covered by markdownTiptap.test.ts.
    const user = userEvent.setup();
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue(null);
    render(<Harness content="hello world" />);
    await user.click(await screen.findByTestId("md-tb-link"));
    expect(promptSpy).toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it("renders nothing when the editor is null (loading guard)", () => {
    render(<MarkdownEditorToolbar editor={null} />);
    expect(screen.queryByTestId("md-editor-toolbar")).toBeNull();
  });
});
