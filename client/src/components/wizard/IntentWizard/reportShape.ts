/*
 * reportShape — the cross-repo contract GUARD (A08, AC2 + AC4 shape-guard).
 *
 * The grade card renders the shipwright-grade `ReportModel` field-for-field. A
 * field renamed/dropped in the monorepo does NOT fail loudly here — it renders a
 * half-empty or plausible-but-wrong card. So before we trust a payload we:
 *
 *   1. refuse an unrecognised MAJOR schema_version (the plugin says the consumer
 *      must REFUSE, not half-render — report_model.py SCHEMA_VERSION contract);
 *   2. assert the structural fields the card reads are present + well-typed;
 *   3. assert the AC2 invariant on the wire: a dimension with status "n/a" MUST
 *      carry score === null. A payload that pairs "n/a" with a number is either
 *      a synthesized score or a corrupt row — either way we do NOT render it as a
 *      real reading. (Our own renderer additionally never derives a number from a
 *      null score; this guards the INPUT side of the same invariant.)
 *
 * On any failure the caller renders an honest "report shape not recognised"
 * state instead of a broken card.
 */

import type { DimensionStatus, ReportModel } from "./types";

/** Major version this build renders. Mirrors report_model.SCHEMA_VERSION "1.x". */
export const SUPPORTED_REPORT_MAJOR = 1;

const STATUS_VALUES: DimensionStatus[] = ["ok", "gap", "n/a"];

export type ShapeResult =
  | { ok: true; model: ReportModel }
  | { ok: false; reason: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function majorOf(schemaVersion: unknown): number | null {
  if (typeof schemaVersion !== "string") return null;
  const m = /^(\d+)\./.exec(schemaVersion) ?? /^(\d+)$/.exec(schemaVersion);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Validate an untyped payload against the ReportModel contract. Returns the
 * typed model on success, or a human reason on failure.
 */
export function parseReportModel(raw: unknown): ShapeResult {
  if (!isObject(raw)) return { ok: false, reason: "payload is not an object" };

  const major = majorOf(raw.schema_version);
  if (major === null) {
    return { ok: false, reason: `missing/garbled schema_version (${String(raw.schema_version)})` };
  }
  if (major !== SUPPORTED_REPORT_MAJOR) {
    return {
      ok: false,
      reason: `schema_version ${String(raw.schema_version)} is a newer major than this build renders (${SUPPORTED_REPORT_MAJOR}.x)`,
    };
  }

  // Top-level structural fields the card reads. EVERY scalar the renderer
  // consumes is asserted here — a field renamed/dropped in the monorepo while
  // staying major-v1 (exactly the drift this guard exists to catch) must fall to
  // the honest "shape-unrecognised" state, never crash the card with a TypeError
  // (e.g. `reasons.map` on an absent array).
  const requiredStrings = [
    "grade",
    "verdict",
    "band_label",
    "honest_ceiling_note",
    "target_display",
    "mode",
    "routing_reason",
    "verified_from",
    "network_note",
    "static_test_inventory",
  ];
  for (const k of requiredStrings) {
    if (typeof raw[k] !== "string") return { ok: false, reason: `field "${k}" must be a string` };
  }
  if (typeof raw.network_enabled !== "boolean") {
    return { ok: false, reason: `"network_enabled" must be a boolean` };
  }
  if (typeof raw.gradeable !== "boolean") {
    return { ok: false, reason: `"gradeable" must be a boolean` };
  }
  for (const k of ["measurable_count", "na_count"]) {
    if (typeof raw[k] !== "number" || !Number.isFinite(raw[k])) {
      return { ok: false, reason: `"${k}" must be a finite number` };
    }
  }
  // The four consumed arrays (each read with .length / .map on the card).
  if (!Array.isArray(raw.dimensions)) return { ok: false, reason: `"dimensions" must be an array` };
  if (!Array.isArray(raw.reasons)) return { ok: false, reason: `"reasons" must be an array` };
  if (!Array.isArray(raw.controls_shipwright_would_light)) {
    return { ok: false, reason: `"controls_shipwright_would_light" must be an array` };
  }
  if (!Array.isArray(raw.network_enrichments)) {
    return { ok: false, reason: `"network_enrichments" must be an array` };
  }

  // Each dimension: EVERY field the row renders + the bidirectional score
  // invariant (AC2). A field the renderer reads but the guard skips is a crash or
  // a malformed value waiting to happen — so validate the whole consumed surface.
  for (let i = 0; i < raw.dimensions.length; i++) {
    const d = raw.dimensions[i];
    if (!isObject(d)) return { ok: false, reason: `dimension[${i}] is not an object` };
    if (typeof d.key !== "string") return { ok: false, reason: `dimension[${i}].key must be a string` };
    if (typeof d.label !== "string") return { ok: false, reason: `dimension[${i}].label must be a string` };
    if (typeof d.weight !== "number" || !Number.isFinite(d.weight)) {
      return { ok: false, reason: `dimension[${i}].weight must be a finite number` };
    }
    if (typeof d.detail !== "string") return { ok: false, reason: `dimension[${i}].detail must be a string` };
    if (typeof d.would_light_up !== "boolean") {
      return { ok: false, reason: `dimension[${i}].would_light_up must be a boolean` };
    }
    if (typeof d.status !== "string" || !STATUS_VALUES.includes(d.status as DimensionStatus)) {
      return { ok: false, reason: `dimension[${i}].status "${String(d.status)}" is outside {ok,gap,n/a}` };
    }
    const score = d.score;
    // BOTH directions of the AC2 invariant: n/a ⇒ null (never a synthesized
    // number), and ok/gap ⇒ a finite number (never a null the bar would render
    // as "null/100" / a broken width).
    if (d.status === "n/a") {
      if (score !== null) {
        return {
          ok: false,
          reason: `dimension[${i}] ("${d.label}") is n/a but carries a score (${String(score)}) — a synthesized value for an underivable dimension`,
        };
      }
    } else {
      if (typeof score !== "number" || !Number.isFinite(score)) {
        return {
          ok: false,
          reason: `dimension[${i}] ("${d.label}") is ${d.status} but its score is not a finite number (${String(score)})`,
        };
      }
    }
    // provenance — the "how this was measured" disclosure the row expands.
    const prov = d.provenance;
    if (!isObject(prov)) return { ok: false, reason: `dimension[${i}].provenance must be an object` };
    if (typeof prov.source !== "string") return { ok: false, reason: `dimension[${i}].provenance.source must be a string` };
    if (typeof prov.mode !== "string") return { ok: false, reason: `dimension[${i}].provenance.mode must be a string` };
    if (typeof prov.freshness !== "string") return { ok: false, reason: `dimension[${i}].provenance.freshness must be a string` };
    if (!Array.isArray(prov.disabled_enrichments)) {
      return { ok: false, reason: `dimension[${i}].provenance.disabled_enrichments must be an array` };
    }
  }

  // Aggregate counts must AGREE with the dimensions (a report that says "2 not
  // derivable" while showing one n/a row is misleading — reject it).
  const naSeen = raw.dimensions.filter((d) => isObject(d) && d.status === "n/a").length;
  const measurableSeen = raw.dimensions.length - naSeen;
  if (typeof raw.na_count === "number" && raw.na_count !== naSeen) {
    return { ok: false, reason: `na_count (${raw.na_count}) disagrees with the ${naSeen} n/a dimension(s)` };
  }
  if (typeof raw.measurable_count === "number" && raw.measurable_count !== measurableSeen) {
    return {
      ok: false,
      reason: `measurable_count (${raw.measurable_count}) disagrees with the ${measurableSeen} scored dimension(s)`,
    };
  }

  return { ok: true, model: raw as unknown as ReportModel };
}
