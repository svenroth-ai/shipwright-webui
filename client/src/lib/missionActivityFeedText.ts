/**
 * Text-extraction helpers for `missionActivityFeed.ts`'s reducer: per-card
 * command labels, and the bounded raw-output excerpt + question-answer
 * matching that back the `detail`/`question` fields
 * (iterate-2026-08-20-mission-feed-content). Split out of the reducer file
 * itself once it crossed the project's 300-line convention — pure text
 * transforms with no dependency on the reducer's mutation state machine.
 */
import stripAnsi from "strip-ansi";
import type { ParsedEvent } from "../external/session-parser";
import { sanitizeProofText, stripControl } from "./proofLines";

export const clean = (value: string) => sanitizeProofText(value.split("\n")[0] ?? "", 280);

export function isCompactionMarker(event: ParsedEvent): boolean {
  return event.kind === "system" && (
    /compact/i.test(event.subtype ?? "") || /context automatically compacted/i.test(event.text)
  );
}

export function commandDetail(input: unknown): string {
  const value = input as Record<string, unknown> | undefined;
  return typeof value?.command === "string" ? value.command
    : typeof value?.file_path === "string" ? value.file_path
    : typeof value?.description === "string" ? value.description
    : typeof value?.pattern === "string" ? value.pattern : "";
}

export function commandLabel(name: string, input: unknown): string {
  const detail = commandDetail(input);
  return detail ? `${name}: ${sanitizeProofText(detail, 180)}` : `Used ${name}`;
}

/**
 * Turns an already-sanitized `commandLabel()` chip ("Tool: detail") into a
 * short standalone sentence ("Tool detail.") — reuses the exact same
 * sanitized/truncated text already shown in the command chip, never a new
 * raw-text exposure path.
 */
export function sentenceFromLabel(label: string): string {
  const colonIndex = label.indexOf(": ");
  const sentence = colonIndex === -1 ? label : `${label.slice(0, colonIndex)} ${label.slice(colonIndex + 2)}`;
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/**
 * Bounded, sanitized raw-output excerpt: its own multi-line truncation, not
 * `sanitizeProofText` (which single-line-truncates and would collapse a
 * multi-line failure back to one line, defeating the point).
 */
export function excerpt(content: string, maxLines = 4, maxChars = 320): string {
  const allLines = stripControl(stripAnsi(content))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const lines = allLines.slice(0, maxLines);
  if (lines.length === 0) return "";
  const joined = lines.join("\n");
  if (joined.length > maxChars) return `${joined.slice(0, maxChars)}…`;
  // Line-count truncation is otherwise silent (doubt-review catch): dropping
  // lines beyond `maxLines` with no marker left a reader unable to tell a
  // partial excerpt from the complete output. Appended to the last line
  // (not a new line) so a `split("\n")` line count still matches `maxLines`.
  return allLines.length > maxLines ? `${joined}…` : joined;
}

const normalizeForMatch = (value: string) => value.trim().toLowerCase();

/**
 * Real CLI resolution content is plain text matching one option's label
 * verbatim (confirmed against a captured real transcript fixture,
 * `askuser-roundtrip.jsonl`). A resolution routed through the webui's own
 * multi-question answer serialization (`askUserPayload.ts`
 * `serializePartAnswers`) instead uses `## header\nbody` blocks — handled
 * defensively since `askUserQuestionSummary()` only surfaces the FIRST
 * question (existing precedent), matching that shape's first block.
 */
export function resolveQuestionAnswer(rawContent: string, options: string[]): { picked?: string; answer?: string } {
  const trimmed = rawContent.trim();
  const direct = options.find((option) => normalizeForMatch(option) === normalizeForMatch(trimmed));
  if (direct) return { picked: direct };
  const block = /^##\s*.+\n([\s\S]*?)(?:\n\n##|$)/.exec(trimmed);
  const body = (block ? block[1] : trimmed).trim();
  const bodyMatch = options.find((option) => normalizeForMatch(option) === normalizeForMatch(body));
  if (bodyMatch) return { picked: bodyMatch };
  const excerpted = excerpt(body || trimmed);
  return excerpted ? { answer: excerpted } : {};
}
