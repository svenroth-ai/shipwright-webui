/*
 * core/mission-context/planned-impact.ts — mid-run PLANNED impact from the
 * iterate spec (CONTRACT §6 mid-run column, AC1).
 *
 * Before Finalize no run record exists, so the spec is the only evidence of
 * what the run intends to touch. CONTRACT §6 names the source precisely: the
 * spec's **"Affected Boundaries"** prose, shown as *planned impact* and never
 * labelled new/changed/technical.
 *
 * Two defects this module exists to fix (internal code review, MEDIUM):
 *
 *  1. A whole-document `FR-\d{2}\.\d{2,3}` scrape reads FR ids out of
 *     References sections, prior-art citations and "unchanged" callouts, then
 *     presents them as "Expected to affect …". The scan is now SCOPED to the
 *     affected-boundaries / spec-impact section; ids elsewhere are ignored.
 *
 *  2. When a mid-run spec names no FR id at all, an id-only model yields zero
 *     rows → `not_yet_created` → the client's hide-empty rule removes the
 *     artifact entirely, so AC1 ("a live standalone iterate shows a non-empty
 *     Spec + Requirement") fails SILENTLY. So the section's PROSE is carried as
 *     a fallback: a spec that says what it will touch always produces a
 *     Requirement, with or without a literal id.
 */

/** Bound the scan so a pathological spec cannot drive an unbounded walk. */
const SCAN_BYTES = 200_000;

const FR_IN_TEXT = /\bFR-\d{2}\.\d{2,3}\b/g;

/**
 * Headings that carry the run's intended impact. `Affected Boundaries` is the
 * CONTRACT-named one (ADR-024); the others are the shapes real iterate specs
 * in this repo actually use for the same thing.
 */
const IMPACT_HEADING =
  /^(#{1,6})\s*(?:\d+[.)]\s*)?(affected\s+boundaries|affected\s+requirements?|requirements?\s+impact|spec\s+impact|scope)\b.*$/i;

const ANY_HEADING = /^(#{1,6})\s+\S/;

export interface PlannedImpact {
  /** FR ids named INSIDE the impact section (never document-wide). */
  frIds: string[];
  /** One-line prose describing the intended impact, or null. */
  prose: string | null;
}

/** Collapse a markdown block to one readable line, bounded for display. */
function condense(block: string, maxLen = 240): string | null {
  const text = block
    .split(/\r?\n/)
    .map((l) => l.trim())
    // Drop list bullets / table pipes / blockquote marks but keep the words.
    .map((l) => l.replace(/^[-*+]\s+/, "").replace(/^>\s*/, "").replace(/^\|/, "").trim())
    .filter((l) => l.length > 0 && !ANY_HEADING.test(l) && !/^[-|: ]+$/.test(l))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length === 0) return null;
  if (text.length <= maxLen) return text;
  // Cut on a word boundary so the summary does not end mid-token.
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Slice out the impact section: from its heading to the next heading of the
 * SAME OR HIGHER level (a deeper sub-heading stays part of the section).
 * Returns null when the spec has no such section.
 */
export function extractImpactSection(specText: string): string | null {
  const lines = specText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = IMPACT_HEADING.exec(lines[i]);
    if (!m) continue;
    const level = m[1].length;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const h = ANY_HEADING.exec(lines[j]);
      if (h && h[1].length <= level) break;
      body.push(lines[j]);
    }
    const text = body.join("\n").trim();
    if (text.length > 0) return text;
  }
  return null;
}

/** Unique FR ids appearing in `text`, in first-seen order. */
function frIdsIn(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  FR_IN_TEXT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FR_IN_TEXT.exec(text)) !== null) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    out.push(m[0]);
  }
  return out;
}

/**
 * The mid-run planned impact for a spec body.
 *
 * Prefers the impact SECTION for both ids and prose. With no such section we
 * deliberately return NO ids — a document-wide scrape is what produced false
 * "Expected to affect …" rows — but we still carry the spec's opening prose so
 * the Requirement artifact can say something true rather than vanish.
 */
export function plannedImpactFromSpec(specText: string | null | undefined): PlannedImpact {
  if (!specText) return { frIds: [], prose: null };
  const slice = specText.length > SCAN_BYTES ? specText.slice(0, SCAN_BYTES) : specText;

  const section = extractImpactSection(slice);
  if (section) {
    return { frIds: frIdsIn(section), prose: condense(section) };
  }

  // No impact section: fall back to the first real paragraph (skipping the
  // title and any front-matter), used as PROSE only — never as id evidence.
  const paragraphs = slice
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !ANY_HEADING.test(p) && !p.startsWith("---"));
  return { frIds: [], prose: paragraphs.length > 0 ? condense(paragraphs[0]) : null };
}
