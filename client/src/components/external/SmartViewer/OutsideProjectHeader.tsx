/*
 * OutsideProjectHeader — shown above the Smart Viewer when the file lies
 * OUTSIDE the project root (V6, Board 11): file name, an "Outside project" tag,
 * the full path and a Copy path button. Read-only.
 */

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { baseName } from "../../../lib/sessionInfoFormat";

export function OutsideProjectHeader({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(path).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  };
  return (
    <div className="sv-outside-head" data-testid="smart-viewer-outside-head">
      <div className="sv-outside-row">
        <span className="sv-outside-name" title={path}>{baseName(path)}</span>
        <span className="sv-outside-tag" data-testid="smart-viewer-outside-tag">Outside project</span>
        <button type="button" className="sv-outside-copy" data-testid="smart-viewer-copy-path" onClick={copy}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span>{copied ? "Copied" : "Copy path"}</span>
        </button>
      </div>
      <div className="sv-outside-path" data-testid="smart-viewer-outside-path">{path}</div>
    </div>
  );
}
