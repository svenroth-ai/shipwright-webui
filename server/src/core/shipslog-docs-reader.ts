/*
 * shipslog-docs-reader.ts — pure, fs-backed reader for the Ship's-Log
 * Documents panel (iterate-2026-08-31-shipslog-documents-panel). Curates
 * four groups from a project's own tree — no client input beyond
 * `projectRoot` (already resolved server-side from a trusted project
 * record), so every path here is either a fixed constant or discovered by
 * readdir-ing a fixed directory, never client-supplied.
 *
 * "Requirements" = the ur-spec per PLANNING SECTION (a direct subdirectory
 * of .shipwright/planning/ that is not iterate/adr/campaigns and carries
 * its own spec.md) — distinct from "Iterate" (the flat *.md mini-specs
 * under .shipwright/planning/iterate/), which is a SEPARATE tab in the UI
 * (see ShipsLogSpecsTabs.tsx) precisely because they answer different
 * questions ("what did we commit to" vs. "what changed, run by run").
 *
 * Agent Docs / Compliance are a fixed, curated 5-row list each — a file
 * that doesn't exist on disk is skipped silently (no "unavailable" row);
 * these docs are not guaranteed to exist in every clone/fork.
 *
 * Dates are filesystem mtime, not `git log` — cheap even at 200+ iterate
 * specs, and it's already what mtime reflects for these files.
 *
 * CLAUDE.md rule 10 / ADR-044: every path (even a dynamically-readdir'd
 * one) is re-verified with pathGuard + realPathGuard before it is stat'd
 * or returned — the same discipline external/tree/routes.ts applies to a
 * client-supplied path, as defense in depth even though nothing here is
 * client-controlled. `realpathSync(projectRoot)` is hoisted ONCE per read
 * (path-guard.ts's own documented optimization for a batch caller) rather
 * than re-paid on every one of the ~230 iterate-spec entries.
 */

import { readdir, stat } from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";

import { pathGuard, realPathGuard } from "./path-guard.js";
import type { ShipsLogDocRow, ShipsLogDocsBundle } from "./shipslog-docs-types.js";

export type { ShipsLogDocRow, ShipsLogDocsBundle } from "./shipslog-docs-types.js";

const AGENT_DOCS: ReadonlyArray<{ file: string; label: string }> = [
  { file: "build_dashboard.md", label: "Dashboard" },
  { file: "architecture.md", label: "Architecture" },
  { file: "decision_log.md", label: "Decision Log" },
  { file: "conventions.md", label: "Conventions" },
  { file: "design_tokens.md", label: "Design Tokens" },
];

const COMPLIANCE_DOCS: ReadonlyArray<{ file: string; label: string }> = [
  { file: "dashboard.md", label: "Dashboard" },
  { file: "traceability-matrix.md", label: "Traceability Matrix" },
  { file: "test-evidence.md", label: "Test Evidence" },
  { file: "change-history.md", label: "Change History" },
  { file: "sbom.md", label: "SBOM" },
];

const PLANNING_SECTION_EXCLUDES = new Set(["iterate", "adr", "campaigns"]);

/** "01-adopted" → "01 — Adopted"; no dash → the raw name unchanged. */
function sectionLabel(dirName: string): string {
  const dash = dirName.indexOf("-");
  if (dash === -1) return dirName;
  const num = dirName.slice(0, dash);
  const rest = dirName
    .slice(dash + 1)
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return rest ? `${num} — ${rest}` : dirName;
}

/** Guard + realpath-verify `relPath`; null if it fails the guard, doesn't
 *  exist, or escapes the project root via a symlink (skip-silently caller
 *  contract — see module doc). */
function verifiedAbsolute(
  projectRoot: string,
  realRoot: string,
  relPath: string,
): string | null {
  const guard = pathGuard(projectRoot, relPath);
  if (!guard.ok) return null;
  const real = realPathGuard(projectRoot, guard.absolute, realRoot);
  return real.ok ? real.absolute : null;
}

async function mtimeIso(absPath: string): Promise<string | null> {
  try {
    const s = await stat(absPath);
    return s.mtime.toISOString();
  } catch {
    return null;
  }
}

async function curatedRows(
  projectRoot: string,
  realRoot: string,
  relDir: string,
  files: ReadonlyArray<{ file: string; label: string }>,
): Promise<ShipsLogDocRow[]> {
  const rows: ShipsLogDocRow[] = [];
  for (const { file, label } of files) {
    const relPath = `${relDir}/${file}`;
    const abs = verifiedAbsolute(projectRoot, realRoot, relPath);
    if (!abs) continue; // missing on disk — skip silently, no error row
    const when = await mtimeIso(abs);
    if (when === null) continue; // vanished between realpath and stat — skip
    rows.push({ path: relPath, label, when });
  }
  return rows;
}

async function readRequirements(
  projectRoot: string,
  realRoot: string,
): Promise<ShipsLogDocRow[]> {
  const planningRel = ".shipwright/planning";
  const guard = pathGuard(projectRoot, planningRel);
  if (!guard.ok) return [];
  let entries;
  try {
    entries = await readdir(guard.absolute, { withFileTypes: true });
  } catch {
    return [];
  }
  const rows: ShipsLogDocRow[] = [];
  for (const d of entries) {
    if (!d.isDirectory() || PLANNING_SECTION_EXCLUDES.has(d.name)) continue;
    const relPath = `${planningRel}/${d.name}/spec.md`;
    const abs = verifiedAbsolute(projectRoot, realRoot, relPath);
    if (!abs) continue; // section without its own spec.md — skip
    const when = await mtimeIso(abs);
    if (when === null) continue;
    rows.push({ path: relPath, label: sectionLabel(d.name), when });
  }
  rows.sort((a, b) => a.label.localeCompare(b.label));
  return rows;
}

async function readIterateSpecs(
  projectRoot: string,
  realRoot: string,
): Promise<ShipsLogDocRow[]> {
  const relDir = ".shipwright/planning/iterate";
  const guard = pathGuard(projectRoot, relDir);
  if (!guard.ok) return [];
  let entries;
  try {
    entries = await readdir(guard.absolute, { withFileTypes: true });
  } catch {
    return [];
  }
  const rows: ShipsLogDocRow[] = [];
  for (const d of entries) {
    // Flat files only (per the panel's Iterate tab spec) — a subdirectory
    // like campaigns/ or a per-run folder is out of scope here.
    if (!d.isFile() || !d.name.endsWith(".md")) continue;
    const relPath = `${relDir}/${d.name}`;
    const abs = verifiedAbsolute(projectRoot, realRoot, relPath);
    if (!abs) continue;
    const when = await mtimeIso(abs);
    rows.push({ path: relPath, label: d.name, when });
  }
  // Newest first; a row with no readable mtime sorts last rather than
  // fabricating a position it didn't earn.
  rows.sort((a, b) => {
    if (a.when === b.when) return a.label.localeCompare(b.label);
    if (a.when === null) return 1;
    if (b.when === null) return -1;
    return a.when < b.when ? 1 : -1;
  });
  return rows;
}

export async function readShipsLogDocs(projectRoot: string): Promise<ShipsLogDocsBundle> {
  let realRoot: string;
  try {
    realRoot = realpathSync(path.resolve(projectRoot));
  } catch {
    // Project root itself unreadable — every group degrades to empty
    // rather than throwing (this is a read-only observer, spec AC-honesty).
    return { requirements: [], iterateSpecs: [], agentDocs: [], compliance: [] };
  }

  const [requirements, iterateSpecs, agentDocs, compliance] = await Promise.all([
    readRequirements(projectRoot, realRoot),
    readIterateSpecs(projectRoot, realRoot),
    curatedRows(projectRoot, realRoot, ".shipwright/agent_docs", AGENT_DOCS),
    curatedRows(projectRoot, realRoot, ".shipwright/compliance", COMPLIANCE_DOCS),
  ]);
  return { requirements, iterateSpecs, agentDocs, compliance };
}
