/*
 * TooLargeNotice — the "File too large to preview inline" chip of the Smart
 * Viewer (split out of SmartViewer.tsx to keep it under its bloat ceiling).
 */

import { AlertCircle } from "lucide-react";

interface Props {
  maxBytes: number;
  source: "server" | "client";
  path: string;
}

export function TooLargeNotice({ maxBytes, source, path }: Props) {
  const mb = (maxBytes / (1024 * 1024)).toFixed(1);
  return (
    <div
      className="flex h-full items-center justify-center p-6"
      data-testid="smart-viewer-too-large"
    >
      <div
        className="flex max-w-md flex-col items-start gap-2 rounded-md border border-[var(--color-border,#e0dbd4)] bg-[var(--color-muted-bg,#ede8e1)] p-4 text-[12px]"
        style={{ color: "var(--color-text, #1a1a1a)" }}
      >
        <div className="flex items-center gap-2 font-medium">
          <AlertCircle
            size={14}
            style={{ color: "var(--color-warning, #D97706)" }}
            aria-hidden="true"
          />
          File too large to preview inline
        </div>
        <div style={{ color: "var(--color-muted, #6b7280)" }}>
          {source === "client"
            ? `Preview cap is ${mb} MB for text / markdown / code.`
            : `Server cap is ${mb} MB.`}
        </div>
        <code className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px]">
          {path}
        </code>
      </div>
    </div>
  );
}
