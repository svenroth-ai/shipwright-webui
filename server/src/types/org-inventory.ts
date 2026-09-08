/*
 * types/org-inventory.ts — wire shapes for `GET /api/org/inventory`
 * (iterate-2026-09-08-lead-inventory-page). New file rather than an edit to
 * `types/org.ts` (already at its 300-line convention ceiling) — same reason
 * `org-schema-sync.test.ts`'s sibling files stay split by route family.
 *
 * Client-side mirrors live in `client/src/lib/leadInventoryApi.ts` (CLAUDE.md
 * rule 7 — verbatim copy, no cross-package import).
 */

import type { CharterAuthorityResult } from "../external/org/charter-authority-read.js";
import type { BeatStep } from "./leadwright-beat-step.js";

export type StepsView =
  | { status: "ok"; steps: BeatStep[]; unreadableLines: number }
  | { status: "unreadable" };

/** `"clear"` = the audit lookup ran and found nothing for this beat;
 *  `"found"` = a `beat_effect_not_claimed` entry names this beat;
 *  `"unknown"` = the audit lookup itself degraded (read failure or
 *  pagination-cap truncation, AC-9) — NEVER collapsed into `"clear"`. */
export type UnclaimedEffectView = { status: "clear" | "found" | "unknown" };

export interface BeatInventoryView {
  beatId: string;
  /** The register's own `startedAt` (always a string field — but its VALUE
   *  may be unparseable; see `beats` below). */
  startedAt: string;
  closedAt: string | null;
  steps: StepsView;
  unclaimedEffect: UnclaimedEffectView;
}

/** Verbatim alias — the AuthorityPanel's shape IS `charterAuthorityCore`'s
 *  result, not a re-derivation of it. */
export type AuthorityPanelView = CharterAuthorityResult;

export interface LeadInventoryEntry {
  leadId: string;
  /** Cheap `entries.length` over the full register — lets the client tell
   *  "never had a beat" apart from "has history, none in this window"
   *  (AC-8). */
  totalBeatsInRegister: number;
  /** Server-side bounded to `startedAt >= now - 48h` (an unparseable
   *  `startedAt` value is INCLUDED, never dropped); ordered `startedAt`
   *  ascending (AC-11). The client narrows further to the exact "last
   *  night" window. */
  beats: BeatInventoryView[];
  authority: AuthorityPanelView;
}

export type LeadInventoryResponse = Record<string, LeadInventoryEntry>;
