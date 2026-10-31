/*
 * OutsideProjectHeader — shown above the Smart Viewer when the file lies
 * OUTSIDE the project root (V6, Board 11): file name, an "Outside project" tag,
 * the full path and a Copy path button. Read-only.
 */

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

import { baseName } from "../../../lib/sessionInfoFormat";

export function OutsideProjectHeader({ path }: { path: string }) {
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const flash = (next: "copied" | "failed") => {
    setCopy(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopy("idle"), 1500);
  };
  const copyPath = () => {
    const write = navigator.clipboard?.writeText(path);
    if (!write) return flash("failed");
    void write.then(() => flash("copied"), () => flash("failed"));
  };
  return (
    <div className="sv-outside-head" data-testid="smart-viewer-outside-head">
      <div className="sv-outside-row">
        <span className="sv-outside-name" title={path}>{baseName(path)}</span>
        <span className="sv-outside-tag" data-testid="smart-viewer-outside-tag">Outside project</span>
        <button type="button" className="sv-outside-copy" data-testid="smart-viewer-copy-path" onClick={copyPath}>
          {copy === "copied" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span role="status">{copy === "copied" ? "Copied" : copy === "failed" ? "Copy failed" : "Copy path"}</span>
        </button>
      </div>
      <div className="sv-outside-path" data-testid="smart-viewer-outside-path">{path}</div>
    </div>
  );
}
