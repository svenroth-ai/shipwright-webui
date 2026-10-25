/*
 * adopt-scan-findings.ts - the live rows of the Adopt result screen, read from the
 * analyzer snapshot of an UNTRUSTED repo (`analyze_codebase.py`, schema 1.x).
 *
 * Every value is short, typed and cleaned, and one malformed key nulls only itself:
 * `undefined` (key omitted) = the snapshot does not report it (a 1.0 snapshot, or an
 * analyzer without that detector); `null` = reported, nothing found. Commands are
 * exposed as NAMES only (dev, build, ...), never as command text - the screen sits
 * next to an "Adopt this repo" button, and repo-authored command text on a
 * trusted-looking screen is exactly what a hostile repo would want to place there.
 * The values are shown as plain text by the client and are never logged.
 */

export interface AdoptScanFindings {
  stack?: string | null;
  routes?: number | null;
  tests?: string | null;
  ci?: string | null;
  conventions?: string | null;
  commands?: string[] | null;
}

const MAX_TEXT = 120;
const MAX_ITEMS = 8;
const COMMAND_NAMES = ["dev", "build", "test", "lint"] as const;
const TEST_KINDS = ["unit", "integration", "e2e", "db", "coverage_tool"] as const;
// eslint-disable-next-line no-control-regex
export const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\u061c\u00ad\u2060-\u2064\ufeff\u3164\u115f\u1160\u2800\u034f\u180e\ufe00-\ufe0f\u{e0000}-\u{e007f}]/gu;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Cleaned, single-spaced, capped; "" when nothing readable is left. */
function clean(v: unknown, max = MAX_TEXT): string {
  const text = typeof v === "string" ? v.replace(CONTROL, " ").replace(/\s+/g, " ").trim() : "";
  return [...text].slice(0, max).join("");
}

function joined(parts: string[]): string | null {
  const text = [...parts.filter(Boolean).slice(0, MAX_ITEMS).join(" · ")].slice(0, MAX_TEXT).join("").trim();
  return text || null;
}

function count(v: unknown): number | null {
  return Array.isArray(v) && Number.isSafeInteger(v.length) ? v.length : null;
}

/** "React@^19.0.0" -> "React" (names of detected technologies, version stripped). */
function techNames(group: unknown): string[] {
  if (!isObject(group)) return [];
  return Object.values(group).map((v) => clean(typeof v === "string" ? v.split("@")[0] : "", 60)).filter(Boolean);
}

function stack(v: unknown): string | null {
  if (!isObject(v)) return null;
  const names = [clean(v.primary_language, 40), ...["frontend", "backend", "database", "auth"].flatMap((k) => techNames(v[k]))];
  return joined([...new Set(names)]);
}

function tests(v: unknown): string | null {
  if (!isObject(v)) return null;
  const parts = TEST_KINDS.flatMap((kind) => {
    const raw = v[kind];
    const names = (Array.isArray(raw) ? raw : [raw]).map((n) => clean(n, 40)).filter(Boolean);
    return names.length > 0 ? [`${kind}: ${names.join(", ")}`] : [];
  });
  return joined(parts);
}

function ci(v: unknown): string | null {
  if (!isObject(v)) return null;
  const provider = clean(v.provider, 40);
  if (!provider) return null;
  const n = count(v.workflows);
  return n ? `${provider} · ${n} workflow${n === 1 ? "" : "s"}` : provider;
}

function conventions(v: unknown): string | null {
  if (!isObject(v)) return null;
  return joined([clean(v.linter, 40), clean(v.formatter, 40), v.tsconfig_strict === true ? "strict TypeScript" : ""]);
}

function commands(v: unknown): string[] | null {
  if (!isObject(v)) return null;
  const found = COMMAND_NAMES.filter((name) => clean(v[name], 200) !== "");
  return found.length > 0 ? [...found] : null;
}

/** Findings of a snapshot; `{}` for anything that is not an object. */
export function extractFindings(raw: unknown): AdoptScanFindings {
  if (!isObject(raw)) return {};
  const out: AdoptScanFindings = {};
  const has = (key: string) => Object.prototype.hasOwnProperty.call(raw, key);
  if (has("stack")) out.stack = stack(raw.stack);
  if (has("features")) out.routes = count(raw.features);
  if (has("test_frameworks")) out.tests = tests(raw.test_frameworks);
  if (has("ci_pipeline")) out.ci = ci(raw.ci_pipeline);
  if (has("conventions")) out.conventions = conventions(raw.conventions);
  if (has("commands")) out.commands = commands(raw.commands);
  return out;
}
