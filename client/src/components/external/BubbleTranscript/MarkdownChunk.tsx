/*
 * MarkdownChunk — Campaign-C C3 BubbleTranscript split (2026-05-26).
 *
 * Thin wrapper around the legacy `MarkdownText` renderer (react-markdown +
 * remark-gfm + rehype-highlight per CLAUDE.md rule 4 — no @assistant-ui/*).
 * The wrapper renames the prop `text` → `content` to align with the
 * sub-iterate spec (`{ content: string }`); under the hood it delegates
 * bit-perfectly so all five existing consumers (InboxPage, SkillCard,
 * MarkdownRenderer, the legacy markdown-renderer test, the in-bubble
 * call site here) keep working unchanged.
 */

import { memo } from "react";

import { MarkdownText } from "../MarkdownText";

interface Props {
  content: string;
}

/**
 * Memoized on `content` (of which it is a pure function). Paired with the
 * incremental transcript parse — which keeps an unchanged bubble's text
 * referentially stable across polls — this lets an unchanged bubble skip the
 * react-markdown + rehype-highlight re-render that a streaming poll would
 * otherwise trigger for every visible bubble
 * (iterate-2026-07-23-transcript-incremental-render).
 */
export const MarkdownChunk = memo(function MarkdownChunk({ content }: Props) {
  return <MarkdownText text={content} />;
});
