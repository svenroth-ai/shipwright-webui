/*
 * external/org/charter-authority-read.ts — per-band authority prose for the
 * Lead Inventory page's AuthorityPanel (iterate-2026-09-08-lead-inventory-page,
 * AC-4).
 *
 * Started as a plan to hand-port leadwright's `lib/charter-validate.ts`
 * `validateCharterBands` verbatim into its own pinned mirror file — dropped
 * per Architecture Review (GLM, low/proportionality, accepted): the 4 band
 * names are already hardcoded in this repo (the vendored beat-step schema's
 * `band` enum), so the §4.4 heading-detection logic is owned LOCALLY here
 * instead of behind a second cross-repo pin. `CHARTER_BANDS` and the
 * slash-spacing-normalized heading match below are the SAME algorithm
 * `charter-validate.ts` runs (leadwright @
 * db2938b308899b8cbca017b291c18696a54844b5), just not vendored — a rename
 * of a §4.4 heading on leadwright's side is a silent divergence here, same
 * disclosed-limitation posture as every other cross-repo read in this
 * directory.
 *
 * Read this as PROSE, not authorization: a band's heading being present in
 * the charter means the lead's charter puts that band in scope (the same
 * signal `checkBeatStart`'s `charter-missing-band` gate uses to allow a beat
 * to start at all) — it is NOT a per-band "may act alone" flag, which no
 * field in leadwright's schemas or store carries (Internal Plan Review
 * finding #1). Because `checkBeatStart` denies a beat outright when ANY
 * band is missing, a lead with beats to show already has all 4 declared —
 * the declared/missing count is real, disclosed information (a charter
 * completeness signal), never dressed up as an authorization claim.
 *
 * Charter-path handling (Internal/External Plan Review): only the DEFAULT
 * `<leadId>/charter.md` location is readable through the shared allowlist
 * (`resolveOrgAllowlistedTarget`) that `orgFileReadCore` enforces — the same
 * limitation `org-leads-composite.ts`'s `buildRole` and
 * `existing-charters-read.ts` already have. A non-default `charter_path`
 * degrades with an HONEST reason instead of silently reading the wrong
 * file. Widening the allowlist to an arbitrary path is a separate,
 * independently-reviewable change touching all three call sites, not
 * squeezed into this iterate.
 */

import { orgFileReadCore, type OrgFileReadDeps, type OrgFileReadCoreResult } from "./file-read.js";

export interface CharterBand {
  id: "bugfix" | "maintenance" | "feature" | "architecture";
  /** The exact §4.4 name a heading must contain, case-insensitively. */
  name: string;
}

export const CHARTER_BANDS: readonly CharterBand[] = [
  { id: "bugfix", name: "Bugfix / bekannter Defekt" },
  { id: "maintenance", name: "Kleine Pflege" },
  { id: "feature", name: "Neues Feature" },
  { id: "architecture", name: "Architektur / Grundsatz" },
];

const DEFAULT_CHARTER_RELPATH = "charter.md";

export interface AuthorityBandView {
  id: CharterBand["id"];
  name: string;
  declared: boolean;
  /** The heading section's own prose, or `null` if not declared / the section is empty. */
  text: string | null;
}

export type CharterAuthorityResult =
  | { measured: true; bands: AuthorityBandView[]; declaredCount: number }
  | { measured: false; reason: string };

function normalizeSlashSpacing(value: string): string {
  return value.replace(/\s*\/\s*/g, "/");
}

interface HeadingLine {
  index: number;
  normalizedText: string;
}

function headingLines(lines: string[]): HeadingLine[] {
  const out: HeadingLine[] = [];
  lines.forEach((line, index) => {
    if (/^\s*#+\s/.test(line)) {
      out.push({ index, normalizedText: normalizeSlashSpacing(line.toLowerCase()) });
    }
  });
  return out;
}

/** Same line-shape-skip technique `role-extract.ts` uses for its single
 *  paragraph, applied to a bounded slice of lines (one heading's section)
 *  instead of the whole document — text-processing only, not a markdown
 *  AST parse. Returns `null` for an effectively empty section.
 *
 * An UNBALANCED fence (an opening ``` or ~~~ with no matching close before
 * the section ends) is treated as no fence at all for this section — every
 * line, including the stray fence marker itself, is kept as ordinary prose
 * (external code review, low/edge-case): the naive toggle would otherwise
 * leave `inCodeFence` stuck `true` for the rest of the section, silently
 * swallowing everything after a hand-edited charter's forgotten closer.
 * "Fail toward showing more, never toward hiding data" — the same rule
 * this file applies to a missing/empty section already. */
function extractSectionProse(sectionLines: string[]): string | null {
  const fenceLineCount = sectionLines.filter((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith("```") || trimmed.startsWith("~~~");
  }).length;
  const fencesBalanced = fenceLineCount % 2 === 0;

  const paragraphLines: string[] = [];
  let inCodeFence = false;
  for (const line of sectionLines) {
    const trimmed = line.trim();
    if (fencesBalanced && (trimmed.startsWith("```") || trimmed.startsWith("~~~"))) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;
    if (/^\s*#+\s/.test(line)) continue; // nested heading — not part of this section's prose
    if (trimmed.startsWith(">")) continue;
    if (trimmed.length === 0) continue;
    paragraphLines.push(trimmed);
  }
  const joined = paragraphLines.join(" ").trim();
  return joined.length > 0 ? joined : null;
}

/**
 * For each of the 4 §4.4 bands: is it declared (a heading containing the
 * canonical name, case- and slash-spacing-insensitively — mirrors
 * `charter-validate.ts`'s `validateCharterBands` exactly), and if so, what
 * prose follows it up to the next heading of any level (or EOF)? Each
 * heading can satisfy at most ONE band, matching the upstream rule.
 */
export function extractBandSections(charterMd: string): AuthorityBandView[] {
  const lines = charterMd.split(/\r?\n/);
  const headings = headingLines(lines);
  const usedHeadingIndices = new Set<number>();

  return CHARTER_BANDS.map((band): AuthorityBandView => {
    const normalizedName = normalizeSlashSpacing(band.name.toLowerCase());
    const match = headings.find((h) => !usedHeadingIndices.has(h.index) && h.normalizedText.includes(normalizedName));
    if (!match) {
      return { id: band.id, name: band.name, declared: false, text: null };
    }
    usedHeadingIndices.add(match.index);

    const nextHeadingIndex = headings
      .map((h) => h.index)
      .filter((idx) => idx > match.index)
      .sort((a, b) => a - b)[0];
    const sectionEnd = nextHeadingIndex ?? lines.length;
    const sectionLines = lines.slice(match.index + 1, sectionEnd);

    return { id: band.id, name: band.name, declared: true, text: extractSectionProse(sectionLines) };
  });
}

export interface CharterAuthorityDeps extends OrgFileReadDeps {
  /** Test seam — defaults to the real `orgFileReadCore`. */
  readFn?: (deps: OrgFileReadDeps, relpath: string | undefined) => OrgFileReadCoreResult;
}

/** Pure core. `charterPath` is `org-chart.json`'s per-lead `charter_path`
 *  value (verbatim, as read by the caller) — compared against the literal
 *  default rather than resolved, per the header note above. */
export function charterAuthorityCore(
  deps: CharterAuthorityDeps,
  leadId: string,
  charterPath: string | undefined,
): CharterAuthorityResult {
  if (charterPath !== undefined && charterPath !== DEFAULT_CHARTER_RELPATH) {
    return { measured: false, reason: "custom charter path not yet supported by this panel" };
  }

  const readFn = deps.readFn ?? orgFileReadCore;
  const result = readFn(deps, `${leadId}/${DEFAULT_CHARTER_RELPATH}`);
  if (result.status !== 200 || result.kind !== "file") {
    return { measured: false, reason: "not readable at the default charter path" };
  }

  const bands = extractBandSections(result.body.toString("utf8"));
  const declaredCount = bands.filter((b) => b.declared).length;
  return { measured: true, bands, declaredCount };
}
