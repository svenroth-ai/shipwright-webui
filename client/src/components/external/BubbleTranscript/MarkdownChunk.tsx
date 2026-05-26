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

import { MarkdownText } from "../MarkdownText";

interface Props {
  content: string;
}

export function MarkdownChunk({ content }: Props) {
  return <MarkdownText text={content} />;
}
