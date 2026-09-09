/*
 * leadwright-schema-drift.ts — comparison primitives for
 * leadwright-schema-drift.test.ts (iterate-2026-09-09-leadwright-schema-
 * drift). Lives in types/, not vendor/leadwright/, on purpose: that
 * directory's contract is "runtime JSON only, safe for copy-assets.mjs to
 * blanket-cpSync into dist/" — a logic-plus-test module dropped in there
 * would ride along into the production build unnoticed.
 *
 * leadwright's `.gitattributes` marks `schemas/*.schema.json` as `eol=lf`,
 * but a Windows checkout can still leave those files CRLF-dirty in the
 * working tree (attributes only apply at checkout time — a clone that
 * already had them as CRLF keeps them until re-checked-out) while `git
 * diff`/`git status` stay clean. Comparing bytes or a hash would therefore
 * fail spuriously on every Windows machine. Everything here compares
 * PARSED JSON instead.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** Lists the basenames of every regular file directly inside `dir`
 *  (non-recursive, alphabetically sorted). Directory-driven on purpose —
 *  the caller must never hardcode a filename list, or a newly vendored file
 *  silently falls outside the check. */
export function listVendorFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

/** Reads + parses `filePath`, rethrowing with `label` (e.g. "vendor" /
 *  "checkout") so a missing-file failure reads as "vendor copy of X is
 *  missing" rather than a bare Node ENOENT with no side attached. */
function readJson(filePath: string, label: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err) {
    throw new Error(`${label} file not found: ${filePath}`, { cause: err });
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${label} file is not valid JSON: ${filePath}`, { cause: err });
  }
}

/** Deep-compares two parsed JSON values and returns a pointer-like path
 *  (not RFC-6901-escaped — diagnostic-only, never parsed back) to the first
 *  difference found, or `undefined` when they're equal. Object key order
 *  never matters; array element order does. */
export function findFirstJsonDiff(a: unknown, b: unknown, pointer = ""): string | undefined {
  if (a === b) return undefined;

  const aIsObj = a !== null && typeof a === "object";
  const bIsObj = b !== null && typeof b === "object";
  if (!aIsObj || !bIsObj) return pointer || "/";

  const aIsArr = Array.isArray(a);
  const bIsArr = Array.isArray(b);
  if (aIsArr !== bIsArr) return pointer || "/";

  if (aIsArr && bIsArr) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const diff = findFirstJsonDiff(a[i], b[i], `${pointer}/${i}`);
      if (diff !== undefined) return diff;
    }
    return undefined;
  }

  const aRec = a as Record<string, unknown>;
  const bRec = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(aRec), ...Object.keys(bRec)]);
  for (const key of keys) {
    const diff = findFirstJsonDiff(aRec[key], bRec[key], `${pointer}/${key}`);
    if (diff !== undefined) return diff;
  }
  return undefined;
}

export interface SchemaDriftResult {
  file: string;
  matches: boolean;
  /** JSON-pointer path to the first differing key; set only when matches is false. */
  diffPath?: string;
}

export interface CompareVendoredFileOptions {
  /** Directory holding our vendored copy. */
  vendorDir: string;
  /** Directory holding the upstream source-of-truth copy (e.g. `<leadwright checkout>/schemas`). */
  sourceDir: string;
  /** Basename shared by both directories. */
  file: string;
}

/** Compares one vendored file against its counterpart in `sourceDir`, JSON
 *  parsed on both sides (never bytes — see file header). */
export function compareVendoredFile({ vendorDir, sourceDir, file }: CompareVendoredFileOptions): SchemaDriftResult {
  const vendored = readJson(path.join(vendorDir, file), "vendor");
  const source = readJson(path.join(sourceDir, file), "checkout");
  const diffPath = findFirstJsonDiff(vendored, source);
  return diffPath === undefined ? { file, matches: true } : { file, matches: false, diffPath };
}
