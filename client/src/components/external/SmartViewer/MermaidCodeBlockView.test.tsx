/*
 * MermaidCodeBlockView.test — the editor's code block renders a live diagram
 * under ```mermaid blocks only, and the Markdown stays byte-identical
 * (iterate-2026-11-12-smartviewer-editor-md-roundtrip, FR-01.35).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Editor, EditorContent } from "@tiptap/react";

const renderSpy = vi.fn(async (id: string, text: string) => ({ svg: `<svg data-id="${id}" data-len="${text.length}"></svg>` }));
vi.mock("mermaid", () => ({ default: { initialize: vi.fn(), render: renderSpy } }));

import { buildEditorExtensions, serializeEditorMarkdown } from "../../../lib/markdownTiptap";
import { MermaidCodeBlockView } from "./MermaidCodeBlockView";

const NL = String.fromCharCode(10);

function mount(md: string) {
  const editor = new Editor({ extensions: buildEditorExtensions({ codeBlockView: MermaidCodeBlockView }), content: md });
  render(<EditorContent editor={editor} />);
  return editor;
}

describe("MermaidCodeBlockView", () => {
  // @covers FR-01.35
  it("renders the diagram below a mermaid block and keeps the Markdown unchanged", async () => {
    const md = ["```mermaid", "graph TD", "  A-->B", "```"].join(NL);
    const editor = mount(md);
    await waitFor(() => expect(screen.getByTestId("md-mermaid-preview").querySelector("svg")).toBeTruthy(), { timeout: 3000 });
    expect(serializeEditorMarkdown(editor as never).trimEnd()).toBe(md);
    // the code itself is still editable text in the document
    expect(editor.state.doc.firstChild?.textContent).toContain("A-->B");
    editor.destroy();
  });

  // @covers FR-01.35
  it("renders NO diagram for an ordinary code block", async () => {
    const editor = mount(["```ts", "const x = 1;", "```"].join(NL));
    await new Promise((r) => setTimeout(r, 600)); // past the debounce
    expect(screen.queryByTestId("md-mermaid-preview")).toBeNull();
    editor.destroy();
  });
});
