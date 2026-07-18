/*
 * core/mission-context/traceability.ts — read `test-traceability.json` (#289)
 * and index it BY TEST FILE (CONTRACT §10 Slice-2, campaign
 * 2026-07-18-mission-artifacts).
 *
 * The manifest is keyed the other way round — requirement → layer → tests — but
 * the Tests artifact starts from a git diff, which speaks in FILE PATHS. So the
 * index is inverted once, here, rather than re-scanned per changed file.
 *
 * MEASURED ON THIS REPO 2026-07-18: 917 KB, 29 requirements, 1038 test entries,
 * layers `unit` + `e2e`. It is the largest input this feature reads and it is
 * machine-generated, so the two failure modes that matter are SIZE and
 * CORRUPTION. Both degrade to a typed `unavailable` (never a throw, never an
 * unbounded parse) — and, critically, `unavailable` here does NOT mean "no
 * tests". The git diff still knows which test files changed; losing the manifest
 * only loses the requirement links, and the caller says so explicitly rather
 * than reporting an empty test list (S1 review lesson: an absent-data path must
 * never silently read as "nothing happened").
 *
 * `resolved_from` is the fold-provenance field: the manifest links a test to the
 * SURVIVING parent FR while the source tag named the FOLDED id. Carrying it is
 * what lets the UI render "mapped from FR-01.44" (Slice-2 AC2, covers monorepo
 * `trg-5f6a4f74`).
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { readBoundedFile } from "./fs-read.js";
import { pathGuard } from "../path-guard.js";
import type { TestFrRef } from "./types-slice2.js";

export const TRACEABILITY_REL = ".shipwright/compliance/test-traceability.json";

/** Hard cap — the real file is ~0.9 MB; 8 MB is generous and still bounded. */
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;

/**
 * Cap on indexed test entries. A pathological manifest cannot make this loop
 * (or the resulting Map) unbounded. Real: 1038.
 */
export const MAX_TEST_ENTRIES = 50_000;

export interface TraceabilityFileEntry {
  /** Distinct layers this file's tests are recorded under (`unit`, `e2e`, …). */
  layers: string[];
  /**
   * Distinct requirement links, deduped by `frId`. `mappedFrom` carries the
   * fold provenance — the FOLDED id the source tag named, when the manifest
   * resolved it to a surviving parent (AC2).
   */
  frs: TestFrRef[];
  /** How many individual test cases the manifest records for this file. */
  caseCount: number;
}

export type TraceabilityIndex =
  | {
      status: "ok";
      byFile: Map<string, TraceabilityFileEntry>;
      generatedAt: string | null;
      /**
       * The entry cap was hit, so the index is PARTIAL.
       *
       * This must be reported (external code review, MEDIUM): a changed test
       * whose manifest entry fell after the cap would otherwise render with no
       * requirement links while the UI claimed the manifest was fine — a false
       * negative dressed as a clean answer, which is the exact failure this
       * whole slice exists to prevent.
       */
      truncated: boolean;
    }
  | { status: "unavailable"; reason: "missing" | "too_large" | "corrupt" | "denied" };

/** Absolute path to the manifest — used for `sourceRev` probing. */
export function traceabilityPath(projectRoot: string): string {
  return path.join(projectRoot, ...TRACEABILITY_REL.split("/"));
}

/**
 * A manifest test `id` is `<file path>::<test name>`. Only the FILE half joins
 * against a git diff, so split on the FIRST `::` and normalise separators —
 * git reports POSIX paths, the manifest may carry either.
 */
export function testIdToFile(id: string): string | null {
  if (typeof id !== "string" || id.length === 0) return null;
  const cut = id.indexOf("::");
  const file = (cut === -1 ? id : id.slice(0, cut)).trim();
  if (file.length === 0) return null;
  return file.replace(/\\/g, "/").replace(/^\.\//, "");
}

function addLink(entry: TraceabilityFileEntry, link: TestFrRef): void {
  const existing = entry.frs.find((f) => f.frId === link.frId);
  if (!existing) {
    entry.frs.push(link);
    return;
  }
  // Keep the fold provenance if ANY case on this file carried one — dropping it
  // would silently lose the "mapped from" badge for a file whose first-seen
  // case happened to be tagged with the survivor id directly.
  if (!existing.mappedFrom && link.mappedFrom) existing.mappedFrom = link.mappedFrom;
}

/**
 * Read + invert the manifest. Never throws: every defect becomes a typed
 * `unavailable` the caller renders honestly.
 */
export function readTraceabilityIndex(
  projectRoot: string,
  /**
   * Entry cap. Overridable ONLY so the truncation branch below has a direct
   * test: a 50k-entry fixture would be absurd, and asserting the cap through a
   * hand-built `{truncated: true}` downstream would still pass if this producer
   * never set the flag (internal code review, FIX-IF-CHEAP).
   */
  maxEntries: number = MAX_TEST_ENTRIES,
): TraceabilityIndex {
  const guard = pathGuard(projectRoot, TRACEABILITY_REL);
  if (!guard.ok) return { status: "unavailable", reason: "denied" };
  if (!existsSync(guard.absolute)) return { status: "unavailable", reason: "missing" };

  // ONE atomic bounded read — the size cap is enforced against the same
  // descriptor the bytes come from (see fs-read.ts).
  const read = readBoundedFile(guard.absolute, MAX_MANIFEST_BYTES);
  if (!read) return { status: "unavailable", reason: "too_large" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(read.text);
  } catch {
    return { status: "unavailable", reason: "corrupt" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "unavailable", reason: "corrupt" };
  }

  const root = parsed as Record<string, unknown>;
  const requirements = root.requirements;
  if (!requirements || typeof requirements !== "object" || Array.isArray(requirements)) {
    return { status: "unavailable", reason: "corrupt" };
  }

  const byFile = new Map<string, TraceabilityFileEntry>();
  let seen = 0;

  for (const req of Object.values(requirements as Record<string, unknown>)) {
    if (!req || typeof req !== "object" || Array.isArray(req)) continue;
    const r = req as Record<string, unknown>;
    const frId = typeof r.id === "string" && r.id.length > 0 ? r.id : null;
    const tests = r.tests;
    if (!frId || !tests || typeof tests !== "object" || Array.isArray(tests)) continue;

    for (const [layer, cases] of Object.entries(tests as Record<string, unknown>)) {
      if (!Array.isArray(cases)) continue;
      for (const raw of cases) {
        if (seen >= maxEntries) {
          // Truncated rather than aborted: a partial index is strictly better
          // than none, and the cap is far above any real manifest — but the
          // caller MUST be told, or the missing links read as "covers nothing".
          return { status: "ok", byFile, generatedAt: asStr(root.generated_at), truncated: true };
        }
        seen++;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        const t = raw as Record<string, unknown>;
        const file = testIdToFile(typeof t.id === "string" ? t.id : "");
        if (!file) continue;

        let entry = byFile.get(file);
        if (!entry) {
          entry = { layers: [], frs: [], caseCount: 0 };
          byFile.set(file, entry);
        }
        entry.caseCount++;

        const testLayer = typeof t.layer === "string" && t.layer.length > 0 ? t.layer : layer;
        if (typeof testLayer === "string" && !entry.layers.includes(testLayer)) {
          entry.layers.push(testLayer);
        }

        // The fold only "moved" the id when the source tag named something else.
        const from = typeof t.resolved_from === "string" ? t.resolved_from.trim() : "";
        addLink(entry, { frId, mappedFrom: from && from !== frId ? from : null });
      }
    }
  }

  return { status: "ok", byFile, generatedAt: asStr(root.generated_at), truncated: false };
}

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
