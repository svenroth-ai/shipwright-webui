/*
 * LaunchPayloadBlock.tsx — renders the producer-generated launchPayload
 * inside `TriageDetailModal` (iterate-2026-05-20-triage-launch-surface-webui).
 *
 * Three render branches (decision lives in `lib/launchPayload.ts`):
 *   - `render`              → <pre><code> with the cleaned payload
 *   - `github-placeholder`  → red-toned warning line (producer bug)
 *   - `none`                → null (legacy producer; renders nothing)
 *
 * All payload bytes flow through React's default text-node escaping;
 * no `dangerouslySetInnerHTML`, no markdown parser. Control chars are
 * stripped upstream by `prepareLaunchPayload` so the rendered string is
 * the SAME string the Fix-now button copies to the clipboard
 * (architecture rule: "rendered text === copied text").
 */

import type { TriageItem } from "../../lib/triageApi";
import {
  GITHUB_PLACEHOLDER_TEXT,
  prepareLaunchPayload,
} from "../../lib/launchPayload";

interface LaunchPayloadBlockProps {
  item: TriageItem;
}

export function LaunchPayloadBlock({ item }: LaunchPayloadBlockProps) {
  const decision = prepareLaunchPayload(item);

  if (decision.kind === "none") {
    return null;
  }

  if (decision.kind === "github-placeholder") {
    return (
      <div
        className="border-t border-[var(--color-border)] pt-4 mt-4"
        data-testid="triage-launch-payload-block"
      >
        <h4 className="text-xs font-semibold text-[var(--color-text)] uppercase mb-2">
          Launch payload
        </h4>
        <div
          className="text-xs text-err bg-err-tint border border-[var(--err-line)] rounded p-3"
          data-testid="triage-launch-payload-placeholder"
        >
          {GITHUB_PLACEHOLDER_TEXT}
        </div>
      </div>
    );
  }

  // decision.kind === "render"
  return (
    <div
      className="border-t border-[var(--color-border)] pt-4 mt-4"
      data-testid="triage-launch-payload-block"
    >
      <h4 className="text-xs font-semibold text-[var(--color-text)] uppercase mb-2">
        Launch payload
      </h4>
      <p className="text-[11px] text-[var(--color-muted)] mb-2">
        Copy into a new Claude Code session to start the matching run.
      </p>
      <pre
        className="font-mono text-xs bg-inset border border-[var(--color-border)] rounded p-3 whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto"
        data-testid="triage-launch-payload-content"
      >
        <code>{decision.cleaned}</code>
      </pre>
    </div>
  );
}
