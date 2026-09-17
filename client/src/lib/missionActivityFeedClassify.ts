/**
 * Bucket-classification helpers for `missionActivityFeed.ts`'s reducer:
 * which `ActivityKind` a given tool_use falls into. Split out once the
 * reducer crossed the project's 300-line convention
 * (iterate-2026-08-22-mission-feed-fixes) — pure classification logic with
 * no dependency on the reducer's mutation state machine.
 */

/**
 * The `/shipwright-iterate` skill's fixed intro banner (SKILL.md "Print Intro
 * Banner") prints this exact line, alone, as its second row, inside a turn
 * with no tool call — so it lands as `pendingNarration` and only ever
 * surfaced indirectly, via whatever generic bucket sentence the NEXT
 * tool-bearing turn happened to fall into (iterate-2026-08-31-mission-feed-gaps,
 * reported: the feed opened on "The implementation was updated in compact
 * steps." instead of ever showing an iterate had started). Matched on this
 * one line rather than the surrounding `====` border, which carries no
 * identifying text of its own and could appear in unrelated fenced output.
 *
 * Matched as a STANDALONE (trimmed) line, not a substring (external code
 * review, openai MEDIUM) — a plain `.includes()` also fired on ordinary prose
 * that merely quotes or discusses the banner mid-sentence, fabricating a
 * "run started" card for a run that never started.
 */
const ITERATE_BANNER_LINE = "SHIPWRIGHT-ITERATE: Adaptive Change Lifecycle";

/** Does this assistant turn's text print the /shipwright-iterate intro banner as its own line? */
export function containsIterateBanner(lines: readonly string[]): boolean {
  return lines.some((line) => line.trim() === ITERATE_BANNER_LINE);
}

const CHAIN_SEPARATORS = new Set(["&", "|", ";"]);

export interface ShellSegment {
  text: string;
  /** The raw run of chain-separator characters immediately preceding this
   *  segment (e.g. `"&&"`, `";"`, `"||"`), or `null` for the first segment —
   *  `leadingCdPrefix` (`missionActivityFeedAuthoringTrack.ts`) needs this to
   *  tell an unconditional `&&`/`;` chain apart from a `||` branch, which
   *  `splitTopLevel`'s plain string[] below discards entirely (32nd-round
   *  external review catch, openai, medium). */
  precedingOperator: string | null;
}

/** Quote-aware split on shell chain separators (`&&`, `||`, `;`, `|`) — NOT
 * a shell parser (no substitution handling), just enough to stop a
 * separator character *inside a quoted argument* from being read as a real
 * command boundary (e.g. a commit message body containing literal `&&`).
 * Inside a DOUBLE-quoted string only, a backslash escapes the next
 * character (so `\"` doesn't close the quote early — two independent
 * external reviews caught this on `git commit -m "... \"quoted\" ..."`);
 * POSIX single quotes take everything literally, backslash included, so no
 * escape handling applies there. */
function splitTopLevelSegments(shell: string): ShellSegment[] {
  const segments: ShellSegment[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let pendingOperator: string | null = null;
  for (let i = 0; i < shell.length; i++) {
    const ch = shell[i];
    if (quote === '"' && ch === "\\" && i + 1 < shell.length) {
      current += ch + shell[i + 1];
      i++;
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (CHAIN_SEPARATORS.has(ch)) {
      const trimmed = current.trim();
      if (trimmed) segments.push({ text: trimmed, precedingOperator: pendingOperator });
      let op = ch;
      while (i + 1 < shell.length && CHAIN_SEPARATORS.has(shell[i + 1])) { op += shell[i + 1]; i++; }
      pendingOperator = op;
      current = "";
      continue;
    }
    current += ch;
  }
  const trimmed = current.trim();
  if (trimmed) segments.push({ text: trimmed, precedingOperator: pendingOperator });
  return segments;
}

function splitTopLevel(shell: string): string[] {
  return splitTopLevelSegments(shell).map((s) => s.text);
}

// Quote-aware so a quoted value containing an internal space
// (`SOME_VAR="a b" vitest run`) doesn't truncate mid-value and corrupt the
// rest of the split (internal code review, low).
const LEADING_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|\S*)(\s+|$)/;

/** Strips leading `VAR=value` shell assignments, then splits on whitespace. */
function tokenize(segment: string): string[] {
  let s = segment;
  while (LEADING_ASSIGNMENT.test(s)) {
    s = s.replace(LEADING_ASSIGNMENT, "");
  }
  return s.split(/\s+/).filter(Boolean);
}

/** The command actually being invoked by `segment` — resolves through
 * common runner prefixes (`npx`, `npm run`, `uv run`, `python -m`, bare
 * `python script.py`) to the real target, or the segment's own leading
 * token otherwise. */
function invocationTarget(segment: string): string | undefined {
  const [a, b, c] = tokenize(segment);
  if (a === "npx" || a === "pnpm" || a === "yarn") return b;
  if (a === "npm" && b === "run") return c;
  if (a === "uv" && b === "run") return c;
  if ((a === "python" || a === "python3") && b === "-m") return c;
  if ((a === "python" || a === "python3") && b !== undefined) return b;
  return a;
}

const TEST_BINARIES = /^(vitest|playwright|pytest|jest)$/i;
const REVIEW_SCRIPTS = /^(record_review_pass\.py|external_review\.py)$/i;

/** A real test-runner invocation shape, not a bare substring anywhere in
 * the command — the leading token (or the token past a runner prefix) of
 * SOME top-level segment must itself be a test binary. */
function isTestSegment(segment: string): boolean {
  const [a, b, c] = tokenize(segment);
  if (a === "npm" && (b === "test" || b === "t")) return true;
  if (a === "npm" && b === "run" && /^test/i.test(c ?? "")) return true;
  return TEST_BINARIES.test(invocationTarget(segment) ?? "");
}

function isReviewSegment(segment: string): boolean {
  return REVIEW_SCRIPTS.test(invocationTarget(segment) ?? "");
}

function looksLikeInvocation(shell: string, tester: (segment: string) => boolean): boolean {
  return shell.length > 0 && splitTopLevel(shell).some(tester);
}

export function isTestInvocation(shell: string): boolean {
  return looksLikeInvocation(shell, isTestSegment);
}

// Exposed for `missionActivityFeedAuthoringTrack.ts` (iterate-2026-09-16-
// mission-feed-render-fidelity bloat-ceiling split) — the TDD authoring-run
// detection there needs the same quote-aware shell splitter/tokenizer this
// file already builds for its own classification, and duplicating it would
// let the two drift. `isTestSegment` is exposed too (6th-round external
// review catch, openai, medium): `testInvocationTargetPath` must only look
// for a test-file path inside a segment that IS a test invocation, never
// any chained segment — `git diff --check src/foo.test.ts && npm test`
// mentions the just-written file in an unrelated `git diff` segment, and
// scanning every segment misread that as the run's own authoring target.
export { splitTopLevel, splitTopLevelSegments, tokenize, isTestSegment };

export function isReviewInvocation(shell: string): boolean {
  return looksLikeInvocation(shell, isReviewSegment);
}

const REVIEW_TOKEN = /\breview(?:s|ing|ed|er)?\b/i;

/** A Task subagent bucketed as review-related only when its OWN declared
 * purpose says so — never unconditionally, since `Task` covers every kind
 * of subagent spawn. Word-boundary-scoped (not a bare substring) so
 * "preview" does not false-positive. */
export function isReviewTask(name: string, input: Record<string, unknown> | undefined): boolean {
  if (name !== "Task") return false;
  const subagentType = typeof input?.subagent_type === "string" ? input.subagent_type : "";
  const description = typeof input?.description === "string" ? input.description : "";
  return REVIEW_TOKEN.test(subagentType) || REVIEW_TOKEN.test(description);
}

/** Which bucket one tool_use falls into — extracted from
 *  `missionActivityFeed.ts`'s per-tool loop (iterate-2026-09-16-mission-feed-
 *  render-fidelity bloat-ceiling split) so the loop itself reads as
 *  dispatch, not classification. Pure function of the tool's own
 *  name/input/shell — never MissionContext, which only ever gates whether
 *  an artifact chip is shown, not the bucket itself. */
export function classifyToolBucket(
  toolName: string,
  input: Record<string, unknown> | undefined,
  shell: string,
): "user-input" | "test" | "review" | "investigate" | "spec" | "implement" {
  if (toolName === "AskUserQuestion") return "user-input";
  if (isTestInvocation(shell)) return "test";
  if (isReviewInvocation(shell) || isReviewTask(toolName, input)) return "review";
  if (toolName === "Read" || toolName === "Grep" || toolName === "Glob") return "investigate";
  if (/\.shipwright[\\/].*(spec|plan)/i.test(String(input?.file_path ?? ""))) return "spec";
  return "implement";
}
