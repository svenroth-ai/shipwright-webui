/*
 * compliance-reader.ts — read-only observer of
 * `<projectPath>/.shipwright/compliance/dashboard.md`.
 *
 * The Control Grade + one-line verdict + the Dimension/Signal/Anchor table
 * + the CI-Security block live ONLY in that machine-generated markdown — there
 * is no JSON form. WebUI never writes it (CLAUDE.md rule 12 spirit: the
 * shipwright-compliance plugin owns every mutation; we only read).
 *
 * `parseDashboard` is pure (exported for tests): it pulls the small structured
 * fields (grade / score / verdict / generatedAt) used by the badge + tooltip,
 * AND slices the raw markdown of the "Control Verdict" and "CI Security"
 * sections for the detail modal — which the client renders verbatim with its
 * existing react-markdown + remark-gfm stack. We deliberately DO NOT model the
 * table as structured data, and we slice to those two sections so the trailing
 * "Compliance Artifacts" links table (relative links, dead in-browser) never
 * reaches the UI.
 *
 * Forward-compat seam: a future producer `dashboard.json` can slot in behind
 * `readCompliance` without touching the client.
 */

import { readFile as fsReadFile } from "node:fs/promises";
import { join } from "node:path";

import {
  parseDimensions,
  type ComplianceDimension,
} from "./compliance-dimensions.js";

export type { ComplianceDimension } from "./compliance-dimensions.js";

export interface ComplianceData {
  /** Control grade letter, e.g. "A", "B+", "C-". */
  grade: string;
  /** Numeric score out of 100. */
  score: number;
  /** One-line control verdict (blockquote, falling back to the grade line). */
  verdict: string;
  /** ISO timestamp from the dashboard's `Generated:` line ("" if absent). */
  generatedAt: string;
  /** Raw markdown of the "Control Verdict" section (grade + dimension table). */
  controlVerdictMarkdown: string;
  /** Raw markdown of the "CI Security" section ("" if the section is absent). */
  ciSecurityMarkdown: string;
  /**
   * Structured Control-Verdict dimensions (A16). `[]` when the table is absent
   * or unparseable — NEVER a throw. `controlVerdictMarkdown` is left untouched
   * (the detail modal keeps rendering it verbatim).
   */
  dimensions: ComplianceDimension[];
}

export type ComplianceReadResult =
  | { status: "ok"; data: ComplianceData }
  | { status: "missing" }
  | { status: "invalid"; reason: string };

export interface ReadComplianceDeps {
  /** Injected for tests; defaults to fs/promises.readFile + utf-8. */
  readFile?: (path: string) => Promise<string>;
}

const DASHBOARD_REL_PATH = [".shipwright", "compliance", "dashboard.md"] as const;

const RETRYABLE_FS_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);

// `### Control Grade: **A** (99/100) — Under full control.`
// Leading whitespace is tolerated — the dashboard is produced out-of-repo, so
// the parser stays lenient about markdown indentation at the boundary.
const GRADE_RE =
  /^[ \t]*#{1,6}\s*Control Grade:\s*\*\*\s*([A-F][+-]?)\s*\*\*\s*\(\s*(\d{1,3})\s*\/\s*100\s*\)\s*(?:[—–-]\s*(.+?))?\s*$/m;
const GENERATED_RE = /^[ \t]*Generated:\s*(\S+)/m;
// First bolded blockquote line, e.g. `> **Under full control. …**`.
const BLOCKQUOTE_VERDICT_RE = /^[ \t]*>\s*\*\*(.+?)\*\*\s*$/m;

interface Section {
  title: string;
  /** Slice of the source markdown from this `## ` header to the next. */
  markdown: string;
}

/** Split markdown into level-2 (`## `) sections, header line included. */
function splitLevel2Sections(raw: string): Section[] {
  const lines = raw.split("\n");
  const headerIdx: number[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Toggle fenced-code state on ``` / ~~~ fences so a `## ` line INSIDE a code
    // block is not mistaken for a section boundary (the producer is out-of-repo;
    // the slice contract should survive fenced content).
    if (/^[ \t]*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    // `## ` (exactly level-2, leading whitespace tolerated). `### ` etc. do not
    // match — the 3rd char is `#`, not whitespace.
    if (!inFence && /^[ \t]*##\s+\S/.test(line)) headerIdx.push(i);
  }
  const sections: Section[] = [];
  for (let h = 0; h < headerIdx.length; h++) {
    const start = headerIdx[h]!;
    const end = headerIdx[h + 1] ?? lines.length;
    const title = (lines[start] ?? "").replace(/^[ \t]*##\s+/, "").trim();
    sections.push({ title, markdown: lines.slice(start, end).join("\n").trim() });
  }
  return sections;
}

/**
 * Pure parse of a dashboard.md string. Mandatory for `ok`: a recognizable
 * Control-Grade line AND a Control-Verdict section. The CI-Security section
 * is optional (empty string when absent) so older dashboards still surface a
 * grade. Exported for unit tests.
 */
export function parseDashboard(raw: string): ComplianceReadResult {
  if (!raw.trim()) return { status: "invalid", reason: "empty dashboard" };

  const gradeMatch = GRADE_RE.exec(raw);
  if (!gradeMatch) {
    return { status: "invalid", reason: "Control Grade line not found" };
  }
  const grade = gradeMatch[1]!;
  const score = Number.parseInt(gradeMatch[2]!, 10);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    return { status: "invalid", reason: `score out of range: ${gradeMatch[2]}` };
  }
  const gradeLineVerdict = gradeMatch[3]?.trim() ?? "";

  const sections = splitLevel2Sections(raw);
  const controlSection = sections.find((s) => /control verdict/i.test(s.title));
  if (!controlSection) {
    return { status: "invalid", reason: "Control Verdict section not found" };
  }
  const ciSection = sections.find((s) => /ci security/i.test(s.title));

  const blockquote = BLOCKQUOTE_VERDICT_RE.exec(controlSection.markdown);
  const verdict = (blockquote?.[1]?.trim() || gradeLineVerdict || "").trim();

  const generated = GENERATED_RE.exec(raw);

  return {
    status: "ok",
    data: {
      grade,
      score,
      verdict,
      generatedAt: generated?.[1]?.trim() ?? "",
      controlVerdictMarkdown: controlSection.markdown,
      ciSecurityMarkdown: ciSection?.markdown ?? "",
      // A16 (FR-01.60) — structured sub-scores for the Ship's-Log Captain's
      // Drawer. Additive: `controlVerdictMarkdown` above is left untouched, so
      // the detail modal keeps rendering the table verbatim. `[]` when absent.
      dimensions: parseDimensions(controlSection.markdown),
    },
  };
}

function isRetryable(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return Boolean(code && RETRYABLE_FS_CODES.has(code));
}

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/**
 * Read + parse the project's compliance dashboard. Graceful absence: a missing
 * file is `{status:"missing"}` (never an error). One retry on the transient
 * Windows fs codes (EBUSY/EPERM/EACCES) the dashboard write can briefly raise.
 */
export async function readCompliance(
  projectPath: string,
  deps: ReadComplianceDeps = {},
): Promise<ComplianceReadResult> {
  const path = join(projectPath, ...DASHBOARD_REL_PATH);
  const read = deps.readFile ?? ((p: string) => fsReadFile(p, "utf-8"));

  let raw: string;
  try {
    raw = await read(path);
  } catch (err) {
    if (isNotFound(err)) return { status: "missing" };
    if (isRetryable(err)) {
      try {
        raw = await read(path);
      } catch (err2) {
        if (isNotFound(err2)) return { status: "missing" };
        return { status: "invalid", reason: `read failed: ${stringifyErr(err2)}` };
      }
    } else {
      return { status: "invalid", reason: `read failed: ${stringifyErr(err)}` };
    }
  }
  return parseDashboard(raw);
}

function stringifyErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
