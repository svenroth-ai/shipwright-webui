/*
 * VideoRenderer — streams video bytes into a native <video> element via
 * the Range-capable /media route (iterate-2026-06-03-smartviewer-video-view).
 *
 * Mirrors ImageRenderer: the browser streams directly via `src` (no JS
 * copy), and `onError` falls back to a chip so a 415/416/404 — or an
 * undecodable codec inside a supported container — surfaces something
 * actionable instead of a silent black box.
 */

import { useState } from "react";
import { Film } from "lucide-react";

import { mediaUrl } from "../../../lib/mediaApi";

interface Props {
  projectId: string;
  path: string;
}

export function VideoRenderer({ projectId, path }: Props) {
  const [broken, setBroken] = useState(false);
  const src = mediaUrl(projectId, path);
  if (broken) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 p-6 text-[12px]"
        style={{ color: "var(--color-muted, #6b7280)" }}
        data-testid="smart-viewer-video-error"
      >
        <Film size={24} aria-hidden="true" />
        <span>Video could not be played.</span>
        <code className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px]">
          {path}
        </code>
      </div>
    );
  }
  return (
    <div
      className="flex h-full items-center justify-center overflow-auto p-4"
      style={{ background: "var(--color-surface, #ffffff)" }}
      data-testid="smart-viewer-video"
    >
      <video
        src={src}
        controls
        preload="metadata"
        onError={() => setBroken(true)}
        className="max-h-full max-w-full"
        style={{
          borderRadius: "var(--radius-button, 8px)",
          boxShadow: "var(--shadow-sm, 0 2px 8px rgba(0,0,0,0.06))",
        }}
      />
    </div>
  );
}
