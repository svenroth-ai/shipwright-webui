/*
 * TextRenderer — whitespace-preserving viewer for plain text / log / csv /
 * txt files (iterate 3 section 04). Line numbers sit in a grid gutter, one
 * cell per logical line, so with wrapping on the number shows on the FIRST
 * visual row only and continuation rows hang under the text (V7). Wrap is
 * the shared "Wrap lines" preference (WrapToggle.tsx); layout in
 * styles/smart-viewer-code.css.
 */

import { WrapToggleBar, useWrapLines } from "./WrapToggle";

interface Props {
  text: string;
  "data-testid"?: string;
}

export function TextRenderer({ text, ...rest }: Props) {
  const testId = rest["data-testid"] ?? "smart-viewer-text";
  const { wrap, toggleWrap } = useWrapLines();
  return (
    <div className="smart-viewer-text-host h-full overflow-auto" data-wrap={wrap ? "true" : "false"} data-testid="smart-viewer-text-host">
      <WrapToggleBar wrap={wrap} onToggle={toggleWrap} />
      <pre
        className="smart-viewer-text p-4"
        style={{
          fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)",
          background: "var(--color-surface, #ffffff)",
          color: "var(--color-text, #1a1a1a)",
        }}
        data-wrap={wrap ? "true" : "false"}
        data-testid={testId}
      >
        {text.split("\n").map((line, i) => (
          <span key={i} className="sv-text-line">
            <span aria-hidden="true" className="sv-text-ln select-none text-right opacity-50" style={{ color: "var(--color-muted, #6b7280)" }}>
              {i + 1}
            </span>
            <span className="sv-text-body">{line || " "}</span>
          </span>
        ))}
      </pre>
    </div>
  );
}
