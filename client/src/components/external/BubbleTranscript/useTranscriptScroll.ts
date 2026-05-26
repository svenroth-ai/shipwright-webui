/*
 * useTranscriptScroll — Campaign-C C3 BubbleTranscript split (2026-05-26).
 *
 * Public surface (per sub-iterate spec):
 *   `useTranscriptScroll(dep) → { scrollContainerRef, isAtBottom, scrollToBottom }`
 *
 * Internals: delegates to the legacy CSS-first `useAutoScroll` hook
 * (ADR-035) WITHOUT changing the ResizeObserver / dep-key / active-scroll-
 * guard semantics. The only addition is that this hook ALLOCATES the
 * `scrollContainerRef` itself and returns it; the consumer attaches that
 * ref to the scroll <div>. Legacy `useAutoScroll(ref, dep)` continues to
 * receive a ref-as-input — preserving its dedicated test surface.
 *
 * External LLM plan review (openai R2): "preserve legacy hook contract as
 * closely as possible". Achieved by delegating the whole observable
 * behaviour to `useAutoScroll`; the only added API surface is the ref
 * allocation.
 */

import { useRef } from "react";

import { useAutoScroll } from "../../../hooks/useAutoScroll";

export function useTranscriptScroll(dep: unknown): {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  isAtBottom: boolean;
  scrollToBottom: () => void;
} {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const { isAtBottom, scrollToBottom } = useAutoScroll(scrollContainerRef, dep);
  return { scrollContainerRef, isAtBottom, scrollToBottom };
}
