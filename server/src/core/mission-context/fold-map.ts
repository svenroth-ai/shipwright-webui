/*
 * core/mission-context/fold-map.ts — resolve an FR id to its SURVIVING parent
 * (CONTRACT §3.1 / §6; prereq PR #287).
 *
 * The 2026-07-17 taxonomy cleanup folded 37 endpoint/delta rows into their
 * owning capability and recorded the aliases in `## FR-Fold-Map`. Historical
 * `affected_frs` values and source `@fr` tags still name the FOLDED ids — that
 * was deliberate (finer provenance), so every consumer must resolve through the
 * map before display. The canonical example, and AC2 of this slice:
 *   FR-01.44 (terminal appearance)  →  FR-01.28 (Embedded terminal)
 *
 * Honesty rule (§3.1, last clause): an id in NEITHER the table nor the map is
 * shown RAW — never blanked, never silently dropped. A missing name is a
 * display gap; a vanished requirement id would be a lie about what the run did.
 *
 * BOTH ids survive resolution (`originalFrId` + `displayFrId`) so the UI can
 * say "FR-01.28 — mapped from FR-01.44" instead of quietly rewriting history.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { pathGuard } from "../path-guard.js";
import type { FrRow } from "./types.js";

/** The adopted spec, relative to the project root. Constant — no user segment. */
export const SPEC_REL_PARTS = [".shipwright", "planning", "01-adopted", "spec.md"];

/** `FR-01.66` — the immutable id grammar. */
const FR_ID_RE = /^FR-\d{2}\.\d{2,3}$/;

export function isFrId(v: unknown): v is string {
  return typeof v === "string" && FR_ID_RE.test(v);
}

export interface FrEntry {
  id: string;
  area: string | null;
  name: string | null;
}

export interface FoldMap {
  /** Surviving capability rows, keyed by id. */
  entries: Map<string, FrEntry>;
  /** folded id → parent id (one hop; `resolveFr` follows the chain). */
  folds: Map<string, string>;
  /** True when spec.md was found and parsed — false means "resolve raw". */
  loaded: boolean;
}

const EMPTY_MAP: FoldMap = { entries: new Map(), folds: new Map(), loaded: false };

/** Strip markdown code ticks + whitespace from a table cell. */
function cell(s: string): string {
  return s.replace(/`/g, "").trim();
}

/**
 * Parse the FR table rows + the `## FR-Fold-Map` alias table out of spec.md.
 *
 * Both are pipe tables, distinguished by shape rather than by position: a
 * capability row's 2nd column is an AREA code, a fold row's 2nd column is
 * another FR id. That keeps the parser stable if the sections move.
 */
export function parseFoldMap(specText: string): FoldMap {
  const entries = new Map<string, FrEntry>();
  const folds = new Map<string, string>();

  for (const line of specText.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const cols = line.split("|").slice(1, -1).map(cell);
    if (cols.length < 2) continue;
    const first = cols[0];
    if (!isFrId(first)) continue;

    // NB: use the regex, not the `v is string` predicate — the predicate would
    // narrow this already-string cell to `never` in the else branch.
    const second: string = cols[1];
    if (FR_ID_RE.test(second)) {
      // Fold row: | `FR-01.44` | `FR-01.28` | delta | description |
      folds.set(first, second);
    } else if (cols.length >= 3) {
      // Capability row: | FR-01.66 | TSK | Mission view (live session) | … |
      entries.set(first, {
        id: first,
        area: second.length > 0 && second.length <= 8 ? second : null,
        name: cols[2].length > 0 ? cols[2] : null,
      });
    }
  }

  return { entries, folds, loaded: entries.size > 0 || folds.size > 0 };
}

interface CacheEntry {
  map: FoldMap;
  mtimeMs: number;
}
const cache = new Map<string, CacheEntry>();

/**
 * Load (and mtime-cache) the fold map for a project root. A missing or
 * unreadable spec.md yields an EMPTY map with `loaded: false`, which makes
 * `resolveFr` echo ids raw — the honest degradation, never a blank.
 */
export function loadFoldMap(projectRoot: string): FoldMap {
  const guard = pathGuard(projectRoot, SPEC_REL_PARTS.join("/"));
  if (!guard.ok || !existsSync(guard.absolute)) return EMPTY_MAP;

  let mtimeMs: number;
  try {
    mtimeMs = statSync(guard.absolute).mtimeMs;
  } catch {
    return EMPTY_MAP;
  }
  const hit = cache.get(guard.absolute);
  if (hit && hit.mtimeMs === mtimeMs) return hit.map;

  let text: string;
  try {
    text = readFileSync(guard.absolute, "utf-8");
  } catch {
    return EMPTY_MAP;
  }
  const map = parseFoldMap(text);
  if (cache.size > 32) cache.clear();
  cache.set(guard.absolute, { map, mtimeMs });
  return map;
}

/** Test-only cache reset. */
export function _clearFoldMapCache(): void {
  cache.clear();
}

/** Bound the alias chain — a malformed map must not spin (A→B→A). */
const MAX_FOLD_HOPS = 8;

/**
 * Resolve one FR id to its display row. Follows a fold CHAIN (a folded id whose
 * parent was itself later folded) with a hop bound and cycle detection; on a
 * cycle it stops at the last id reached rather than throwing.
 */
export function resolveFr(map: FoldMap, originalFrId: string): FrRow {
  const original = originalFrId.trim();
  let current = original;
  const seen = new Set<string>([current]);

  for (let hop = 0; hop < MAX_FOLD_HOPS; hop++) {
    const next = map.folds.get(current);
    if (!next || seen.has(next)) break;
    seen.add(next);
    current = next;
  }

  const entry = map.entries.get(current) ?? null;
  return {
    originalFrId: original,
    displayFrId: current,
    name: entry?.name ?? null,
    area: entry?.area ?? null,
    // Only set when the fold actually MOVED the id — never a self-reference.
    mappedFrom: current !== original ? original : null,
  };
}

/** Resolve a list, dropping non-FR-shaped junk but keeping unknown-but-valid ids raw. */
export function resolveFrList(map: FoldMap, ids: readonly string[]): FrRow[] {
  const out: FrRow[] = [];
  const seenDisplay = new Set<string>();
  for (const id of ids) {
    if (!isFrId(id)) continue;
    const row = resolveFr(map, id);
    // Two folded ids can collapse onto the same parent — keep the first, so the
    // rail does not repeat a capability.
    if (seenDisplay.has(row.displayFrId)) continue;
    seenDisplay.add(row.displayFrId);
    out.push(row);
  }
  return out;
}

/** Absolute path to the adopted spec (for sourceRev mtime probing). */
export function specPath(projectRoot: string): string {
  return path.join(projectRoot, ...SPEC_REL_PARTS);
}
