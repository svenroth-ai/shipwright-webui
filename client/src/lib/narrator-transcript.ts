/*
 * narrator-transcript.ts — deterministic raw-JSONL → plain-language summary
 * (FR-01.66, iterate-2026-07-17-mission-live-jsonl).
 *
 * The A10 narrator pointed at the raw ~/.claude/**\/<uuid>.jsonl transcript. Pure
 * and side-effect-free: the same content always yields the same summary. It turns
 * the parsed session turns (tool calls, phase markers, messages) into a short
 * rolling "what's happening now" line + a recent-activity list, plus an INFERRED
 * lifecycle stage.
 *
 * HONESTY (FR-01.66 AC3/AC5): it narrates ONLY what the JSONL actually contains —
 * empty content → the honest EMPTY summary (no fabricated activity); the stage is
 * derived only from real markers (else `null`, rendered as "—"); no count/number
 * the transcript did not produce. JSONL is an untrusted io-boundary from a
 * third-party producer, so every narrated string is control/bidi-stripped +
 * length-capped via `sanitizeProofText`.
 */

import {
  assistantText,
  isOnlyToolResults,
  parseSessionJsonl,
  toolUses,
  userText,
  type ParsedEvent,
} from "../external/session-parser";
import { sanitizeProofText } from "./proofLines";

/** The six fixed lifecycle-stage labels (FR-01.67 AC1 — verbatim, Sven's call:
 *  Shipwright phase nouns, NOT gerunds). Analyze (the repo-scout/kickoff bookend)
 *  and Merge (pushed · CI · awaiting the squash) join the original four. A test
 *  pins these six strings. */
export const STAGE_LABELS = ["Analyze", "Spec", "Build", "Test", "Finalize", "Merge"] as const;
export type LifecycleStage = (typeof STAGE_LABELS)[number];

export interface TranscriptActivity {
  id: string;
  text: string;
}

export interface TranscriptSummary {
  /** The session's opening topic — the first real user instruction, sanitized. */
  topic: string | null;
  /** The single most-recent "what's happening now" line, or null when empty. */
  summary: string | null;
  /** The recent-activity list (chronological, capped). */
  activity: TranscriptActivity[];
  /** Inferred lifecycle stage, or null when it cannot be derived (honest "—"). */
  stage: LifecycleStage | null;
  /** True only when the transcript contained at least one narratable turn. */
  hasActivity: boolean;
}

const MAX_ACTIVITY = 6;
const TEXT_CAP = 90;

const EMPTY: TranscriptSummary = {
  topic: null,
  summary: null,
  activity: [],
  stage: null,
  hasActivity: false,
};

function firstLine(s: string): string {
  const idx = s.indexOf("\n");
  return (idx >= 0 ? s.slice(0, idx) : s).trim();
}

/** Cross-platform basename, sanitized + capped. */
function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  const b = idx >= 0 ? p.slice(idx + 1) : p;
  return sanitizeProofText(b, 40);
}

function toolPath(input: unknown): string | null {
  const fp = (input as { file_path?: unknown } | undefined)?.file_path;
  return typeof fp === "string" ? fp : null;
}

function toolCommand(input: unknown): string {
  const cmd = (input as { command?: unknown } | undefined)?.command;
  return typeof cmd === "string" ? cmd : "";
}

/** Plain-language phrase for a shell command — detects the common Shipwright
 *  moments (tests, build, commit, push, PR); otherwise echoes the head verbatim. */
function describeBash(cmd: string): string {
  const c = cmd.toLowerCase();
  if (/\b(npm (run )?test|vitest|playwright|pytest|jest)\b/.test(c)) return "Running tests";
  if (/\b(npm run build|vite build|tsc|npm run typecheck)\b/.test(c)) return "Building the project";
  if (/git commit/.test(c)) return "Committing the change";
  if (/git push/.test(c)) return "Pushing to the remote";
  if (/\bgh pr\b/.test(c)) return "Working with the pull request";
  const head = sanitizeProofText(firstLine(cmd), 40);
  return head ? `Running: ${head}` : "Running a command";
}

/** Plain-language phrase for a single tool_use block. */
function describeTool(tu: { name: string; input: unknown }): string {
  const path = toolPath(tu.input);
  const named = path ? basename(path) : null;
  switch (tu.name) {
    case "Edit":
    case "MultiEdit":
      return named ? `Editing ${named}` : "Editing a file";
    case "Write":
      return named ? `Writing ${named}` : "Writing a file";
    case "Read":
      return named ? `Reading ${named}` : "Reading a file";
    case "Bash":
      return describeBash(toolCommand(tu.input));
    case "Grep":
    case "Glob":
      return "Searching the code";
    case "TodoWrite":
      return "Planning the work";
    case "Task":
      return "Delegating a sub-task";
    default:
      return `Using ${sanitizeProofText(tu.name, 30)}`;
  }
}

/** One activity line for an event, or null when the event is not narratable
 *  (system heartbeats, snapshots, tool-result-only turns, empty prose). */
function activityFor(ev: ParsedEvent): string | null {
  switch (ev.kind) {
    case "slash-command":
      return `Started ${sanitizeProofText(ev.commandName, 40)}`;
    case "user": {
      if (isOnlyToolResults(ev)) return null;
      const t = sanitizeProofText(firstLine(userText(ev)), TEXT_CAP);
      return t ? `You said: ${t}` : null;
    }
    case "assistant": {
      const tus = toolUses(ev);
      if (tus.length > 0) return describeTool(tus[tus.length - 1]);
      const t = sanitizeProofText(firstLine(assistantText(ev)), TEXT_CAP);
      return t ? `Claude: ${t}` : null;
    }
    case "task-notification":
      return `Background task ${sanitizeProofText(ev.status, 20)}`;
    case "pr-link":
      return `Opened PR #${ev.prNumber}`;
    case "stop-hook":
      return `Gate: ${sanitizeProofText(ev.gateName, 40)}`;
    default:
      return null;
  }
}

/** The opening topic — the first real (non-tool-result) user instruction. */
function topicFor(ev: ParsedEvent): string | null {
  if (ev.kind !== "user" || isOnlyToolResults(ev)) return null;
  const t = sanitizeProofText(firstLine(userText(ev)), TEXT_CAP);
  return t || null;
}

/** True for a `/shipwright-iterate` kickoff (incl. `--campaign … --autonomous`) —
 *  the start of a (sub-)iterate, used both as an Analyze marker and as the
 *  windowing boundary (`currentIterateEvents`). */
function isIterateStart(commandName: string): boolean {
  return /shipwright-iterate/i.test(commandName);
}

/**
 * The events belonging to the CURRENT (sub-)iterate (FR-01.67 AC2). `inferStage`
 * OR-latches forward and never resets, which is correct for a single iterate but
 * WRONG for a campaign: once sub-iterate #1 opens a PR, Merge would latch for the
 * whole multi-hour session and the stepper would read "Merge" while sub-iterate
 * #21 is still in Build.
 *
 * The current iterate begins at the LATEST boundary — its `/shipwright-iterate`
 * kickoff (inclusive), OR the event right AFTER a prior sub-iterate's terminal
 * `pr-link`. A forward scan keeps the last such boundary; a plain single iterate
 * has none, so the slice is the whole transcript (unchanged behaviour). A pr-link
 * with NOTHING after it is the CURRENT iterate's own Merge (its PR just opened),
 * so the boundary is clamped to keep it in view (never an empty window).
 *
 * NOTE: the spec also names `work_completed`, but that lives in
 * `shipwright_events.jsonl`, NOT the Claude `<uuid>.jsonl` this reads
 * (`session-parser` has no such kind) — don't add a phantom branch for it.
 */
export function currentIterateEvents(
  events: readonly ParsedEvent[],
): readonly ParsedEvent[] {
  let start = 0;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.kind === "slash-command" && isIterateStart(ev.commandName)) {
      start = i; // a (sub-)iterate begins AT its kickoff (inclusive)
    } else if (ev.kind === "pr-link") {
      start = i + 1; // a prior sub-iterate ended; the next begins after it
    }
  }
  // A trailing pr-link pushed `start` past the end — back off to keep it in view.
  if (start >= events.length) start = events.length - 1;
  return start > 0 ? events.slice(start) : events;
}

/**
 * Infer the lifecycle stage from REAL markers only — the furthest-along evidenced
 * stage (Merge > Finalize > Test > Build > Spec > Analyze), else null (honest "—",
 * never guessed). Analyze is the WEAKEST signal (leading scout/kickoff cluster),
 * overridden by any real edit/test. Callers run it over `currentIterateEvents` (AC2).
 */
export function inferStage(events: readonly ParsedEvent[]): LifecycleStage | null {
  let analyze = false;
  let spec = false;
  let build = false;
  let test = false;
  let finalize = false;
  let merge = false;
  for (const ev of events) {
    if (ev.kind === "pr-link") {
      merge = true; // a PR link is the strongest "pushed, awaiting merge" marker
      continue;
    }
    if (ev.kind === "slash-command") {
      const name = ev.commandName.toLowerCase();
      if (isIterateStart(name) || /\banalyze\b|\bscout\b/.test(name)) analyze = true;
      else if (/spec|plan/.test(name)) spec = true;
      continue;
    }
    if (ev.kind !== "assistant") continue;
    for (const tu of toolUses(ev)) {
      const cmd = tu.name === "Bash" ? toolCommand(tu.input).toLowerCase() : "";
      // Merge (SPLIT out of Finalize): push, any `gh pr …`, `gh run …`.
      if (/git push|\bgh pr\b|\bgh run\b/.test(cmd)) merge = true;
      // Finalize NARROWED: commit + compliance edits, but NOT push/PR.
      if (/git commit|changelog|finalize|decision_log/.test(cmd)) finalize = true;
      if (/\b(npm (run )?test|vitest|playwright|pytest|jest)\b/.test(cmd)) test = true;
      if (/npm run build|vite build|\btsc\b|typecheck/.test(cmd)) build = true;
      // The leading scout cluster (Analyze): reads/searches/todo/delegation.
      if (
        tu.name === "Read" ||
        tu.name === "Grep" ||
        tu.name === "Glob" ||
        tu.name === "Task" ||
        tu.name === "TodoWrite"
      ) {
        analyze = true;
      }
      if (tu.name === "Edit" || tu.name === "Write" || tu.name === "MultiEdit") {
        const path = (toolPath(tu.input) ?? "").toLowerCase();
        // Path-SEGMENT / filename anchors, not bare substrings: `specification.ts`
        // and `login.spec.ts` (a test file) must NOT read as the Spec stage
        // (external code review, finding 3 — honesty: stage only when derivable).
        if (/changelog|decision_log/.test(path)) finalize = true;
        else if (/(^|\/)spec\.md$|\/planning\/|\/adr\//.test(path)) spec = true;
        else build = true;
      }
    }
  }
  if (merge) return "Merge";
  if (finalize) return "Finalize";
  if (test) return "Test";
  if (build) return "Build";
  if (spec) return "Spec";
  if (analyze) return "Analyze";
  return null;
}

/**
 * Summarize a raw JSONL transcript into a plain-language view model. Deterministic
 * and honest: empty/blank content → the EMPTY summary; a transcript with no
 * narratable turns → an honest empty activity list but a still-inferred stage.
 */
export function summarizeTranscript(content: string): TranscriptSummary {
  if (!content) return EMPTY;
  const { events } = parseSessionJsonl(content);
  if (events.length === 0) return EMPTY;

  const lines: string[] = [];
  let topic: string | null = null;
  for (const ev of events) {
    const line = activityFor(ev);
    if (line) lines.push(line);
    if (topic == null) topic = topicFor(ev);
  }

  // The stage is windowed to the CURRENT (sub-)iterate (FR-01.67 AC2); the
  // activity list stays over the whole transcript (its tail is the current work).
  const stage = inferStage(currentIterateEvents(events));
  if (lines.length === 0) {
    return { topic, summary: null, activity: [], stage, hasActivity: false };
  }

  const tail = lines.slice(-MAX_ACTIVITY);
  const activity = tail.map((text, i) => ({ id: `act-${i}`, text }));
  return {
    topic,
    summary: tail[tail.length - 1],
    activity,
    stage,
    hasActivity: true,
  };
}
