/**
 * Per-question model for a Mission feed AskUserQuestion card (campaign
 * mission-desktop-style, M5). Built from the tool_use input
 * (`{questions:[{question, header, multiSelect, options:[{label, description}]}]}`)
 * and joined with the tool_result line's top-level `toolUseResult.answers`
 * (keyed by question text). Read-only display data — nothing here answers a
 * question (ADR-034).
 */
export interface AskOption {
  label: string;
  description?: string;
}

export interface AskItem {
  question: string;
  header?: string;
  multiSelect: boolean;
  options: AskOption[];
  /** The recorded answer text, verbatim. Absent until/unless the question was answered. */
  answer?: string;
  /** The option label the answer matches (single-select only). */
  chosen?: string;
  /** multiSelect only: set when EVERY comma-separated part of the raw answer is an option label (unambiguous); otherwise the raw text is all there is. */
  chosenAll?: string[];
  /** The user's own note on this question (`annotations[question].notes`), when one was typed. */
  notes?: string;
  /** Single-select answer that matches NO option label: a free-text "Other" answer. */
  other?: boolean;
}

const norm = (value: string) => value.trim().toLowerCase();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toOption(raw: unknown): AskOption | null {
  if (typeof raw === "string") return raw ? { label: raw } : null;
  if (!isRecord(raw) || typeof raw.label !== "string" || !raw.label) return null;
  return typeof raw.description === "string" && raw.description ? { label: raw.label, description: raw.description } : { label: raw.label };
}

/** Every question of an AskUserQuestion tool_use input, in order; `[]` for an unreadable payload. */
export function buildAskItems(input: unknown): AskItem[] {
  if (!isRecord(input) || !Array.isArray(input.questions)) return [];
  const items: AskItem[] = [];
  for (const raw of input.questions) {
    if (!isRecord(raw) || typeof raw.question !== "string" || !raw.question.trim()) continue;
    const options = Array.isArray(raw.options) ? raw.options.map(toOption).filter((o, i, all): o is AskOption => o !== null && all.findIndex((x) => x?.label === o.label) === i) : [];
    items.push({
      question: raw.question,
      ...(typeof raw.header === "string" && raw.header ? { header: raw.header } : {}),
      multiSelect: raw.multiSelect === true,
      options,
    });
  }
  return items;
}

/** True when the sidecar carries an `answers` map whose values are ALL blank strings (or none) — a call that decided nothing.
 *  A map with real answers under keys that do not match any question is NOT this: it falls back to the legacy display.
 *  Any non-string value (an unverified shape, e.g. an array) is NOT "nothing" either — fail toward showing, never hiding. */
export function recordsNoAnswer(toolUseResult: unknown): boolean {
  if (!isRecord(toolUseResult) || !isRecord(toolUseResult.answers)) return false;
  return Object.values(toolUseResult.answers).every((v) => typeof v === "string" && v.trim() === "");
}

/** True when every non-blank answer key matches some item's question text (nothing real would be left out of the cards). */
export function allAnswersMatched(items: AskItem[], toolUseResult: unknown): boolean {
  if (!isRecord(toolUseResult) || !isRecord(toolUseResult.answers)) return true;
  return Object.entries(toolUseResult.answers).every(([key, v]) => typeof v !== "string" || !v.trim() || items.some((i) => i.question === key));
}

/** Joins `toolUseResult.answers` onto `items` (mutating). Returns true when at least one question got an answer.
 *  A string `toolUseResult` (a rejected question) or a missing `answers` map answers nothing. */
export function applyAskAnswers(items: AskItem[], toolUseResult: unknown): boolean {
  if (!isRecord(toolUseResult) || !isRecord(toolUseResult.answers)) return false;
  const answers = toolUseResult.answers;
  let any = false;
  const seen = new Set<string>();
  for (const item of items) {
    // The map is keyed by question text, so a repeated text cannot be told apart: first occurrence wins, later ones stay unanswered.
    if (seen.has(item.question)) continue;
    seen.add(item.question);
    const raw = answers[item.question];
    if (typeof raw !== "string" || !raw.trim()) continue;
    any = true;
    item.answer = raw;
    const note = isRecord(toolUseResult.annotations) && isRecord(toolUseResult.annotations[item.question]) ? (toolUseResult.annotations[item.question] as Record<string, unknown>).notes : undefined;
    if (typeof note === "string" && note.trim()) item.notes = note;
    if (item.multiSelect) {
      // Encoding unverified (no real multiSelect fixture): the raw text is always shown; options are marked only when every part is a label.
      const labels = raw.split(",").map((part) => part.trim()).filter(Boolean);
      const matched = labels.map((part) => item.options.find((o) => norm(o.label) === norm(part))?.label);
      if (matched.every((label): label is string => label !== undefined)) item.chosenAll = matched;
      continue;
    }
    const match = item.options.find((o) => norm(o.label) === norm(raw));
    if (match) item.chosen = match.label;
    else item.other = true;
  }
  return any;
}
