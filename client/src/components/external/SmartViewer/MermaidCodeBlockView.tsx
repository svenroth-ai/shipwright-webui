/*
 * MermaidCodeBlockView — node view for the editor's code block
 * (iterate-2026-11-12-smartviewer-editor-md-roundtrip, FR-01.35).
 *
 * The code stays a normal, editable ProseMirror code block, so the Markdown
 * (fence + source) round-trips untouched. For a ```mermaid block a live diagram
 * is rendered BELOW the code via the same MermaidRenderer the read-only viewer
 * uses (securityLevel "strict"); it is non-editable chrome, debounced so a half
 * typed diagram does not flash an error on every keystroke, and an invalid
 * diagram shows MermaidRenderer's own error box without touching the document.
 */

import { useEffect, useState } from "react";
import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from "@tiptap/react";

import { MermaidRenderer } from "./MermaidRenderer";

const DEBOUNCE_MS = 400;

/** Owns the debounce, so ordinary code blocks pay for neither timer nor state. */
function MermaidPreview({ source }: { source: string }) {
  const [shown, setShown] = useState(source);
  useEffect(() => {
    const t = setTimeout(() => setShown(source), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [source]);
  if (shown.trim() === "") return null;
  return (
    <div contentEditable={false} className="md-mermaid-preview" data-testid="md-mermaid-preview">
      <MermaidRenderer text={shown} />
    </div>
  );
}

export function MermaidCodeBlockView({ node }: NodeViewProps) {
  const language = (node.attrs.language as string | null) ?? "";
  return (
    <NodeViewWrapper className="md-codeblock" data-language={language || undefined}>
      <pre spellCheck={false}>
        <NodeViewContent<"code"> as="code" className={language ? `language-${language}` : undefined} />
      </pre>
      {language === "mermaid" && <MermaidPreview source={node.textContent} />}
    </NodeViewWrapper>
  );
}
