/*
 * BubbleTranscript shell — Campaign-C C3 split (2026-05-26).
 *
 * Thin orchestrator that loops over parsed JSONL events, threads the
 * scroll hook, and composes children from `./BubbleTranscript/`:
 *   - Toolbar / PlainBubbles / VirtualBubbles / TranscriptRow /
 *     ToolOutputBlock / MarkdownChunk / AnsiText / shell chrome.
 *   - useTranscriptScroll — CSS-first `overflow-anchor:auto` + RO-light
 *     hook per ADR-035.
 *   - filters.ts — `filterEventsForRender`, `SYSTEM_KINDS`,
 *     `_resetAttachmentWarnDedupeForTesting` (the last two re-exported
 *     below for `BubbleTranscript.test.tsx` back-compat).
 *
 * Behaviour preserved bit-perfect. The legacy 1229-LOC test suite at
 * `BubbleTranscript.test.tsx` is the regression contract.
 */

import { useMemo, useState } from "react";

import { toolResults, toolUses } from "../../external/session-parser";
import { useParsedTranscript } from "../../hooks/useParsedTranscript";
import {
  SYSTEM_KINDS,
  filterEventsForRender,
  _resetAttachmentWarnDedupeForTesting,
} from "./BubbleTranscript/filters";
import { Toolbar } from "./BubbleTranscript/Toolbar";
import { PlainBubbles } from "./BubbleTranscript/PlainBubbles";
import { VirtualBubbles } from "./BubbleTranscript/VirtualBubbles";
import { useSystemVisibility } from "./BubbleTranscript/useSystemVisibility";
import { useTranscriptScroll } from "./BubbleTranscript/useTranscriptScroll";
import {
  EmptyTranscript,
  JumpToLatestButton,
  MalformedBanner,
} from "./BubbleTranscript/ShellChrome";
import type { ExternalTask } from "../../lib/externalApi";

const DEFAULT_TAIL = 200;
const TAIL_PAGE = 200;
const VIRTUALIZE_THRESHOLD = 200;

// Re-exports for the legacy test suite at `BubbleTranscript.test.tsx`.
export { filterEventsForRender, _resetAttachmentWarnDedupeForTesting };

interface Props {
  content: string;
  /** Override the initial tail size (test seam). */
  initialTail?: number;
  /** Optional task threaded into the AnswerInTerminalButton inside ask-bubbles. */
  task?: ExternalTask;
}

export function BubbleTranscript({ content, initialTail = DEFAULT_TAIL, task }: Props) {
  // Incremental parse: only the bytes appended since the last poll are parsed,
  // and already-parsed event objects keep their references so React reconciles
  // only new bubbles (iterate-2026-07-23-transcript-incremental-render).
  const parsed = useParsedTranscript(content);
  const [tail, setTail] = useState<number>(initialTail);
  const [showSystem, setShowSystem] = useSystemVisibility();

  const allEvents = parsed.events;
  const systemCount = useMemo(
    () => allEvents.reduce((n, e) => (SYSTEM_KINDS.has(e.kind) ? n + 1 : n), 0),
    [allEvents],
  );
  const filtered = useMemo(() => {
    return allEvents.filter((e) => {
      if (e.kind === "file-history-snapshot") return false;
      if (e.kind === "last-prompt") return false;
      if (!showSystem && SYSTEM_KINDS.has(e.kind)) return false;
      return true;
    });
  }, [allEvents, showSystem]);
  const visible = useMemo(
    () => (filtered.length > tail ? filtered.slice(-tail) : filtered),
    [filtered, tail],
  );

  const resolvedToolUseIds = useMemo(() => {
    const set = new Set<string>();
    for (const e of filtered) {
      if (e.kind === "user") for (const r of toolResults(e)) set.add(r.tool_use_id);
    }
    return set;
  }, [filtered]);

  const toolResultsById = useMemo(() => {
    const map = new Map<string, { content: string; is_error: boolean }>();
    for (const e of filtered) {
      if (e.kind !== "user") continue;
      for (const r of toolResults(e)) {
        const prior = map.get(r.tool_use_id);
        const wouldDowngrade = prior && !prior.is_error && r.is_error;
        if (!wouldDowngrade) map.set(r.tool_use_id, { content: r.content, is_error: r.is_error });
      }
    }
    return map;
  }, [filtered]);

  const visibleToolUseIds = useMemo(() => {
    const set = new Set<string>();
    for (const e of visible) {
      if (e.kind !== "assistant") continue;
      for (const tu of toolUses(e)) set.add(tu.id);
    }
    return set;
  }, [visible]);

  const visibleForRender = useMemo(
    () => filterEventsForRender(visible, visibleToolUseIds),
    [visible, visibleToolUseIds],
  );

  const allToolUses = useMemo(() => {
    const out: { id: string; name: string; input: unknown }[] = [];
    for (const e of filtered) {
      if (e.kind !== "assistant") continue;
      for (const tu of toolUses(e)) out.push({ id: tu.id, name: tu.name, input: tu.input });
    }
    return out;
  }, [filtered]);

  const scrollDepKey = `${content.length}:${visible.length}:${showSystem ? 1 : 0}`;
  const { scrollContainerRef, isAtBottom, scrollToBottom } = useTranscriptScroll(scrollDepKey);

  const showVirtualized = visible.length >= VIRTUALIZE_THRESHOLD;

  if (parsed.events.length === 0) return <EmptyTranscript />;

  return (
    <div className="relative flex h-full min-h-0 flex-col" data-testid="bubble-transcript">
      <Toolbar
        total={filtered.length}
        visible={visible.length}
        canLoadOlder={filtered.length > tail}
        onLoadOlder={() => setTail((t) => t + TAIL_PAGE)}
        showSystem={showSystem}
        systemCount={systemCount}
        onToggleSystem={() => setShowSystem((prev) => !prev)}
      />
      <div
        ref={scrollContainerRef}
        className="scroll-themed flex-1 overflow-y-auto overflow-x-hidden"
        style={{
          overflowAnchor: "auto",
          scrollPaddingBottom: "40px",
          background: "var(--color-bg, #f5f0eb)",
          fontSize: "13px",
          lineHeight: 1.6,
        }}
        data-testid="transcript-scroll"
      >
        {showVirtualized ? (
          <VirtualBubbles
            events={visibleForRender}
            resolved={resolvedToolUseIds}
            toolResultsById={toolResultsById}
            visibleToolUseIds={visibleToolUseIds}
            allToolUses={allToolUses}
            containerRef={scrollContainerRef}
            task={task}
          />
        ) : (
          <PlainBubbles
            events={visibleForRender}
            resolved={resolvedToolUseIds}
            toolResultsById={toolResultsById}
            visibleToolUseIds={visibleToolUseIds}
            allToolUses={allToolUses}
            task={task}
          />
        )}
      </div>
      {!isAtBottom && <JumpToLatestButton onClick={scrollToBottom} />}
      {parsed.malformedLines > 0 && <MalformedBanner count={parsed.malformedLines} />}
    </div>
  );
}
