/*
 * VirtualBubbles — Campaign-C C3 BubbleTranscript split (2026-05-26).
 *
 * Virtualized event list renderer engaged when the visible event count
 * reaches `VIRTUALIZE_THRESHOLD` (200). Uses `@tanstack/react-virtual`
 * with three load-bearing settings:
 *
 *   - `getItemKey` keys size measurements to event identity via
 *     `stableEventKey` so a row's measured height survives every filter
 *     / tail / poll-tick re-render that shifts indices.
 *   - `useAnimationFrameWithResizeObserver` batches RO-fired measurement
 *     updates to a single paint frame.
 *   - `overscan` 16 steady-state with a one-shot warmup pass on first
 *     visit (cap WARMUP_OVERSCAN_MAX = 500) to pre-mount every visible
 *     row so its measured size lands in the cache before the user can
 *     scroll. See ADR-066 for the rationale.
 *
 * Persistent measured-size cache keyed by `task.sessionUuid` in
 * localStorage; rehydrated on mount via `initialMeasurementsCache`.
 *
 * Extracted bit-perfect from the legacy `BubbleTranscript.tsx`.
 */

import { useEffect, useRef, useState, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { ParsedEvent } from "../../../external/session-parser";
import {
  loadSizeCache,
  persistSizeCache,
  pruneSizeCache,
} from "../../../lib/virtualizerSizeCache";
import { stableEventKey } from "./filters";
import { TranscriptRow } from "./TranscriptRow";
import type { ExternalTask } from "../../../lib/externalApi";

const FALLBACK_ROW_PX = 96;
const WARMUP_OVERSCAN_MAX = 500;

export function VirtualBubbles({
  events,
  resolved,
  toolResultsById,
  visibleToolUseIds,
  allToolUses,
  containerRef,
  task,
}: {
  events: ParsedEvent[];
  resolved: Set<string>;
  toolResultsById: Map<string, { content: string; is_error: boolean }>;
  visibleToolUseIds: Set<string>;
  allToolUses: { id: string; name: string; input: unknown }[];
  containerRef: RefObject<HTMLDivElement | null>;
  task?: ExternalTask;
}) {
  const sessionUuid = task?.sessionUuid ?? "";
  const sizeCacheRef = useRef<Map<string, number> | null>(null);
  const wasEmptyOnMount = useRef<boolean | null>(null);
  if (sizeCacheRef.current === null) {
    sizeCacheRef.current = loadSizeCache(sessionUuid);
    wasEmptyOnMount.current = sizeCacheRef.current.size === 0;
  }

  // initialMeasurementsCache is consumed once when measurementsCache is
  // first empty (TanStack Virtual virtual-core line 472). Lazy via
  // useState's initializer so it captures the first render's events +
  // cached sizes.
  const [initialMeasurementsCache] = useState(() => {
    const cache = sizeCacheRef.current ?? new Map<string, number>();
    if (cache.size === 0) return [] as never[];
    const out: { index: number; start: number; size: number; end: number; key: string; lane: number }[] = [];
    for (let i = 0; i < events.length; i += 1) {
      const key = stableEventKey(events[i], i);
      const size = cache.get(key);
      if (typeof size !== "number") continue;
      out.push({ index: i, key, size, start: 0, end: 0, lane: 0 });
    }
    return out;
  });

  const [overscanMode, setOverscanMode] = useState<"warmup" | "normal">(
    wasEmptyOnMount.current ? "warmup" : "normal",
  );
  const overscan =
    overscanMode === "warmup"
      ? Math.min(WARMUP_OVERSCAN_MAX, Math.max(16, events.length))
      : 16;

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => FALLBACK_ROW_PX,
    overscan,
    getItemKey: (index) => stableEventKey(events[index], index),
    useAnimationFrameWithResizeObserver: true,
    initialMeasurementsCache,
  });

  // Drop overscan back to normal after the warmup paint settles. 2 rAFs
  // ensures (1) the high-overscan render committed and (2) ResizeObserver-
  // driven measurement updates landed.
  useEffect(() => {
    if (overscanMode !== "warmup") return;
    let raf1 = 0;
    let raf2 = 0;
    const timeout = window.setTimeout(() => setOverscanMode("normal"), 1_000);
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        window.clearTimeout(timeout);
        setOverscanMode("normal");
      });
    });
    return () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      window.clearTimeout(timeout);
    };
  }, [overscanMode]);

  // Persist measurements via three triggers, in priority order:
  //   1. pagehide event.
  //   2. Periodic flush every 5 s.
  //   3. React unmount cleanup.
  const eventsRef = useRef(events);
  eventsRef.current = events;

  useEffect(() => {
    if (!sessionUuid) return;

    const flushCache = () => {
      const cache = sizeCacheRef.current;
      if (!cache || cache.size === 0) return;
      const currentEvents = eventsRef.current;
      const active = new Set<string>();
      for (let i = 0; i < currentEvents.length; i += 1) {
        active.add(stableEventKey(currentEvents[i], i));
      }
      persistSizeCache(sessionUuid, pruneSizeCache(cache, active));
    };

    window.addEventListener("pagehide", flushCache);
    const handle = setInterval(flushCache, 5_000);

    return () => {
      window.removeEventListener("pagehide", flushCache);
      clearInterval(handle);
      flushCache();
    };
  }, [sessionUuid]);

  return (
    <div
      style={{
        height: virtualizer.getTotalSize(),
        position: "relative",
        padding: "20px 40px 80px",
      }}
      data-testid="bubble-list-virtual"
    >
      {virtualizer.getVirtualItems().map((vi) => {
        const event = events[vi.index];
        const previous = vi.index > 0 ? events[vi.index - 1] : null;
        const isLatest = vi.index === events.length - 1;
        // Combined ref: virtualizer.measureElement + persistent size-cache
        // tap. Latter keeps sizeCacheRef in sync with the virtualizer's
        // live measurements so pagehide / periodic flush has fresh data.
        const measureRef = (el: HTMLDivElement | null) => {
          virtualizer.measureElement(el);
          if (el && sizeCacheRef.current) {
            const h = el.getBoundingClientRect().height;
            if (Number.isFinite(h) && h > 0) {
              sizeCacheRef.current.set(String(vi.key), h);
            }
          }
        };
        return (
          <div
            key={vi.key}
            ref={measureRef}
            data-index={vi.index}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              transform: `translateY(${vi.start}px)`,
              padding: "7px 0",
            }}
          >
            <TranscriptRow
              entry={event}
              isLatest={isLatest}
              previous={previous}
              resolved={resolved}
              toolResultsById={toolResultsById}
              visibleToolUseIds={visibleToolUseIds}
              allToolUses={allToolUses}
              task={task}
            />
          </div>
        );
      })}
    </div>
  );
}
