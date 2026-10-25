/*
 * adopt-scan.ts — a READ-ONLY look at a local repo for the Adopt screen: runs the
 * shipwright adopt analyzer (`analyze_codebase.py`, Layer-1 detectors) and returns
 * ONLY the detected stack-profile block (match, source, discovery warnings) plus a
 * few short, cleaned findings rows (`adopt-scan-findings.ts`) - never the snapshot.
 *
 * "Nothing has been written yet" must stay true, so the analyzer is always given
 * `--output` pointing at a private temp dir (without it the analyzer writes
 * `<repo>/.shipwright/adopt/snapshot.json`); the temp dir is removed in `finally`.
 * The path is untrusted: absolute, an existing directory, realpath'd, never a
 * filesystem root or the home folder. One scan at a time (a stalled/huge repo
 * cannot pile up processes); the analyzer is discovered from the newest installed
 * `shipwright-adopt` (no hardcoded version). Spawn discipline mirrors
 * `stack-profiles.ts`: `uv run --no-project`, shell:false, fixed argv, honest
 * engine-unavailable, whole-tree kill on timeout (cli-child-spawn).
 */

import { closeSync, existsSync, fstatSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { CONTROL, extractFindings, type AdoptScanFindings } from "./adopt-scan-findings.js";
import { defaultCliChildSpawn, type CliChildSpawnFn } from "./cli-child-spawn.js";
import { READINESS_REPAIR_COMMAND, shipwrightCacheRoot, type RunFn } from "./readiness-probe.js";
import { resolveUv } from "./uv-runner.js";

export const ADOPT_SCAN_TIMEOUT_MS = 45_000;
export const SUPPORTED_SNAPSHOT_MAJOR = 1;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_WARNINGS = 20;
const MAX_WARNING_CHARS = 300;

export interface AdoptScanProfile {
  matched: string | null;
  confidence: number | null;
  source: string | null;
  warnings: string[];
}

export type AdoptScanOutcome =
  | { status: "ok"; profile: AdoptScanProfile; findings: AdoptScanFindings }
  | { status: "invalid-path"; reason: string }
  | { status: "busy"; reason: string }
  | { status: "unsupported-schema"; version: string }
  | { status: "engine-unavailable"; reason: string; repairCommand: string }
  | { status: "failed"; reason: string };

export interface AdoptScanDeps {
  run?: RunFn;
  spawn?: CliChildSpawnFn;
  homeDir?: string;
  baseEnv?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  scriptOverride?: string;
  tmpRoot?: string;
}

/** Newest installed `shipwright-adopt/<version>/scripts/tools/analyze_codebase.py`. */
export function resolveAnalyzerScript(deps: Pick<AdoptScanDeps, "homeDir" | "scriptOverride"> = {}): string | null {
  const override = deps.scriptOverride ?? process.env.SHIPWRIGHT_ANALYZE_CODEBASE_SCRIPT;
  if (override) return existsSync(override) ? override : null;
  const base = path.join(shipwrightCacheRoot(deps.homeDir ?? os.homedir()), "shipwright-adopt");
  let versions: string[];
  try {
    versions = readdirSync(base);
  } catch {
    return null;
  }
  const parse = (v: string) => v.split(".").map((n) => Number.parseInt(n, 10) || 0);
  versions.sort((a, b) => {
    const [pa, pb] = [parse(a), parse(b)];
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pb[i] ?? 0) - (pa[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  });
  for (const v of versions) {
    const candidate = path.join(base, v, "scripts", "tools", "analyze_codebase.py");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Tolerant reader (snapshot 1.0 lacks source/warnings); unknown major refused. */
export function extractProfile(raw: unknown): AdoptScanOutcome {
  if (!isObject(raw)) return { status: "failed", reason: "The scan returned something unreadable." };
  if (raw.schema_version !== undefined) {
    const major = Number.parseInt(String(raw.schema_version).split(".")[0] ?? "", 10);
    if (!Number.isFinite(major) || major < 1 || major > SUPPORTED_SNAPSHOT_MAJOR) {
      return { status: "unsupported-schema", version: String(raw.schema_version).slice(0, 20) };
    }
  }
  const p = raw.profile;
  if (!isObject(p)) return { status: "failed", reason: "The scan has no profile block." };
  const warnings = Array.isArray(p.warnings)
    ? p.warnings
        .filter((w): w is string => typeof w === "string")
        .slice(0, MAX_WARNINGS)
        .map((w) => w.replace(CONTROL, " ").slice(0, MAX_WARNING_CHARS))
    : [];
  return {
    status: "ok",
    findings: extractFindings(raw),
    profile: {
      matched: typeof p.matched === "string" ? p.matched.replace(CONTROL, " ").slice(0, 120) : null,
      confidence: typeof p.confidence === "number" && Number.isFinite(p.confidence) ? p.confidence : null,
      source: typeof p.source === "string" ? p.source.replace(CONTROL, " ").slice(0, 40) : null,
      warnings,
    },
  };
}

function refuseRoot(real: string, home: string): string | null {
  const parsed = path.parse(real);
  if (real === parsed.root) return "That is a drive root, not a project folder.";
  const norm = (x: string) => (process.platform === "win32" ? x.toLowerCase() : x);
  let realHome = path.resolve(home);
  try {
    realHome = realpathSync(home);
  } catch {
    // keep the resolved path
  }
  if (norm(real) === norm(realHome) || norm(real) === norm(path.resolve(home))) return "That is your home folder, not a project folder.";
  return null;
}

let busy = false;

export async function scanRepoProfile(input: { path: unknown }, deps: AdoptScanDeps = {}): Promise<AdoptScanOutcome> {
  const raw = input.path;
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 1024 || raw.includes("\0") || /^[\\/]{2}/.test(raw) || !path.isAbsolute(raw)) {
    return { status: "invalid-path", reason: "Pick a folder on this computer." };
  }
  let real: string;
  try {
    real = realpathSync(raw);
    if (!statSync(real).isDirectory()) return { status: "invalid-path", reason: "That is a file, not a folder." };
  } catch {
    return { status: "invalid-path", reason: "That folder doesn't exist." };
  }
  const rootProblem = refuseRoot(real, deps.homeDir ?? os.homedir());
  if (rootProblem) return { status: "invalid-path", reason: rootProblem };

  const unavailable = (reason: string): AdoptScanOutcome => ({
    status: "engine-unavailable",
    reason,
    repairCommand: READINESS_REPAIR_COMMAND,
  });
  // The lock is taken BEFORE any process is started, so concurrent POSTs cannot each
  // spawn a `uv --version`; it is released in the finally below on every path.
  if (busy) return { status: "busy", reason: "Another scan is still running." };
  busy = true;
  try {
    return await scanLocked(real, deps, unavailable);
  } finally {
    busy = false;
  }
}

async function scanLocked(real: string, deps: AdoptScanDeps, unavailable: (reason: string) => AdoptScanOutcome): Promise<AdoptScanOutcome> {
  const script = resolveAnalyzerScript(deps);
  if (!script) return unavailable("The Shipwright adopt tool isn't installed.");
  const uv = await resolveUv({ run: deps.run, homeDir: deps.homeDir, baseEnv: deps.baseEnv });
  if (!uv) return unavailable("uv isn't installed — the scan needs it to run in a managed Python 3.11+.");
  let out: string | undefined;
  try {
    out = mkdtempSync(path.join(deps.tmpRoot ?? os.tmpdir(), "sw-adopt-scan-"));
    // the snapshot must never be written into the repo being looked at
    const rel = path.relative(real, realpathSync(out));
    if (rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel))) {
      return { status: "failed", reason: "The scan needs a temporary folder outside the project." };
    }
    const file = path.join(out, "snapshot.json");
    const spawn = deps.spawn ?? defaultCliChildSpawn;
    const result = await spawn(
      uv.bin,
      ["run", "--no-project", "--python", ">=3.11", script, "--project-root", real, "--output", file],
      { timeoutMs: deps.timeoutMs ?? ADOPT_SCAN_TIMEOUT_MS, env: uv.env },
    );
    if (result.code === -1) return unavailable("uv couldn't start on this machine.");
    if (result.spawnError === "timeout") return { status: "failed", reason: "The scan took too long and was stopped." };
    if (result.code !== 0) {
      const line = result.stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() ?? "";
      return { status: "failed", reason: line.replace(CONTROL, " ").slice(0, 200) || "The scan failed." };
    }
    let parsed: unknown;
    try {
      // size check and read share one descriptor - no check-then-act window
      const fd = openSync(file, "r");
      try {
        if (fstatSync(fd).size > MAX_SNAPSHOT_BYTES) return { status: "failed", reason: "The scan result was too large." };
        parsed = JSON.parse(readFileSync(fd, "utf-8"));
      } finally {
        closeSync(fd);
      }
    } catch {
      return { status: "failed", reason: "The scan returned something unreadable." };
    }
    return extractProfile(parsed);
  } catch {
    return { status: "failed", reason: "The scan could not be run." };
  } finally {
    if (out) {
      try {
        rmSync(out, { recursive: true, force: true });
      } catch {
        // best-effort: a stray temp dir holds a snapshot only, never repo content
      }
    }
  }
}
