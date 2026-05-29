/*
 * BubbleTranscript helpers — Campaign-C C3 split (2026-05-26).
 *
 * Pure functions + small constants extracted from the legacy
 * `BubbleTranscript.tsx` shell. Three groups:
 *
 *  1. `SYSTEM_KINDS`: ParsedEvent kinds the system-toggle controls.
 *  2. `filterEventsForRender`: drops events that would render null
 *     downstream (ADR-065 — keeps the virtualizer free of zero-height
 *     placeholder rows during scroll-up).
 *  3. `stableEventKey`: stable React key derivation that survives
 *     array-position shifts (ADR-056 AC-A + GPT external-review #8).
 *
 * Plus a module-scoped dev warn-dedupe set (`warnUnknownAttachmentSchemaOnce`)
 * + a test seam (`_resetAttachmentWarnDedupeForTesting`). Both were public
 * exports from the legacy shell and are re-exported back through it for
 * binary compatibility with `BubbleTranscript.test.tsx`.
 */

import type { ParsedEvent } from "../../../external/session-parser";
import { isOnlyToolResults, toolResults } from "../../../external/session-parser";

/**
 * Event kinds treated as "system messages" for the toolbar toggle.
 * The original `system` kind plus three Claude-emitted metadata pills
 * (custom-title, agent-name, permission-mode) — session-info noise that
 * doesn't belong in the conversation flow by default.
 */
export const SYSTEM_KINDS: ReadonlySet<ParsedEvent["kind"]> = new Set([
  "system",
  "custom-title",
  "agent-name",
  "permission-mode",
  // 2026-05-27 AC1 — mode-change is a heartbeat (~30× per session), same
  // signal class as permission-mode: pure metadata noise unless the user
  // opts in via the toolbar's "show system" toggle.
  "mode-change",
]);

/**
 * Pre-virtualizer null-render filter (ADR-065). Drops events that
 * `renderBubble` would otherwise return null for, so the absolute-
 * positioned wrapper around them never enters the virtualizer's items
 * list. See the long-form comment in the legacy file (2026-05-01 entry).
 */
export function filterEventsForRender(
  events: ParsedEvent[],
  visibleToolUseIds: Set<string>,
): ParsedEvent[] {
  return events.filter((e) => {
    if (e.kind === "user") {
      const results = toolResults(e);
      if (results.length > 0 && isOnlyToolResults(e)) {
        const allFolded = results.every((r) => visibleToolUseIds.has(r.tool_use_id));
        if (allFolded) return false;
      }
      return true;
    }
    if (e.kind === "attachment") {
      const payload = e.attachment as Record<string, unknown> | undefined;
      const filename = readNonEmptyString(payload, "filename");
      const altName = readNonEmptyString(payload, "name");
      if (!filename && !altName) {
        warnUnknownAttachmentSchemaOnce(payload);
        return false;
      }
    }
    return true;
  });
}

/**
 * Stable React key derivation that survives array-position shifts.
 * Priority order:
 *   1. `event.uuid` — Claude always emits it for parsed events.
 *   2. `${kind}-${timestamp}` — stable across reads of the same JSONL
 *      when the event has a timestamp but no uuid.
 *   3. `${kind}-i-${position}` — last-resort for uuid-less + timestamp-less
 *      events (e.g. `unknown` stubs from malformed lines).
 */
export function stableEventKey(event: ParsedEvent, position: number): string {
  if (event.uuid) return event.uuid;
  if (event.timestamp) return `${event.kind}-${event.timestamp}`;
  return `${event.kind}-i-${position}`;
}

// Module-scoped dedupe set so a given payload-key-shape produces at most
// one dev warn per page lifetime. Original behaviour (in
// `renderAttachmentCard`) emitted the warn on every render — once per
// filter pass, sometimes hundreds per second on tool-heavy sessions.
const _warnedAttachmentKeys = new Set<string>();

function warnUnknownAttachmentSchemaOnce(payload: Record<string, unknown> | undefined): void {
  if (!import.meta.env?.DEV) return;
  if (!payload || typeof payload !== "object") return;
  const keys = Object.keys(payload).sort();
  const sig = keys.join("|");
  if (_warnedAttachmentKeys.has(sig)) return;
  _warnedAttachmentKeys.add(sig);
  // eslint-disable-next-line no-console
  console.warn(
    "[BubbleTranscript] Dropping attachment event with no filename/name field. Keys:",
    keys,
  );
}

/** Test-only seam to clear the warn-dedupe set between tests. */
export function _resetAttachmentWarnDedupeForTesting(): void {
  _warnedAttachmentKeys.clear();
}

export function readNonEmptyString(
  obj: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  if (!obj) return undefined;
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
