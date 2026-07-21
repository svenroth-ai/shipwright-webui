/*
 * narrator-facts.ts — what a transcript actually EVIDENCES (FR-01.68).
 *
 * The first half of the Mission narrative: parsed events in, a flat record of
 * facts out. It owns the narrative WINDOW, the tool-result pairing, the counts
 * and the sanitisation. `narrator-prose.ts` owns the wording and nothing else.
 *
 * Split this way because the two move for different reasons — these facts
 * change when Shipwright's tooling changes, the sentences change when the
 * wording does — and because a renderer that had to decide whether a phrase was
 * sufficiently evidenced would be re-implementing parsing policy in the UI.
 *
 * HONESTY IS BOUGHT HERE. Every guarantee the card makes is a property of this
 * file: an outcome is graded by the evidence that exists (never upgraded), a
 * tool call without a result is pending (never success), and everything
 * transcript-derived is sanitised at the moment the fact is created — the JSONL
 * is an untrusted io-boundary and this card promotes previously-discarded
 * content into prominent UI text.
 *
 * Pure + deterministic. No I/O, no clock.
 */

import {
  isOnlyToolResults,
  toolResults,
  toolUses,
  userText,
  type ParsedEvent,
} from "../external/session-parser";
import { sanitizeProofText } from "./proofLines";
import {
  classifyCommand,
  classifyEditPath,
  isIterateStart,
  opensIterateWorktree,
} from "./stage-markers";

const ASK_CAP = 400;

/**
 * A test run, graded by what its result actually proves.
 *
 * `is_error` establishes that an invocation errored — NOT that "six failed",
 * and certainly not that a later green run means "the whole suite". A command
 * may run a targeted subset, swallow its status with `|| true`, or carry
 * several heads under one result. So the count is carried only when it was
 * READ, and a pass records whether it was counted.
 */
export type TestOutcome =
  | { status: "failed"; failed: number | null }
  | { status: "passed"; counted: boolean }
  | { status: "pending" };

export interface NarrativeFacts {
  /** The operator's request, sanitised. Null when nothing was asked. */
  ask: string | null;
  read: number;
  searched: number;
  /** PRODUCT edits only — scratch/bookkeeping writes are not the work. */
  changed: number;
  /** Shell commands that evidenced nothing more specific. */
  commands: number;
  specWritten: boolean;
  tests: TestOutcome[];
  commits: number;
  pushed: boolean;
  pr: number | null;
  /** At least one tool call is still awaiting its result. */
  pending: boolean;
}

/** Harness-injected user content the SHIPPING PARSER does not yet reclassify
 *  into its own kind. Closed list, deliberately tiny: event structure does the
 *  filtering (AC2), and a growing denylist would start rejecting real requests
 *  that merely resemble a banner. */
const INJECTED = ["[Request interrupted", "API Error:", "<local-command-stdout>"];

const EMPTY: NarrativeFacts = {
  ask: null,
  read: 0,
  searched: 0,
  changed: 0,
  commands: 0,
  specWritten: false,
  tests: [],
  commits: 0,
  pushed: false,
  pr: null,
  pending: false,
};

/**
 * The window the story spans (AC9), stated as four rules:
 *
 *   1. An ANCHOR is an iterate kickoff, or a command creating its worktree.
 *   2. The window starts at the LAST anchor — a later sub-iterate always wins.
 *   3. A `pr-link` NEVER closes it. Claude re-emits that event on every turn the
 *      URL stays visible, and post-PR review fixes belong to the iterate that
 *      produced them. The shipped `currentIterateEvents` starts AFTER the last
 *      pr-link, which is right for a stepper (it only needs the current
 *      position) and amputating for a story — measured on real transcripts it
 *      cut 286 events to 8 and 321 to 109. That function is left untouched.
 *   4. No anchor → the whole array, which is already one session's transcript.
 */
export function narrativeWindow(events: readonly ParsedEvent[]): readonly ParsedEvent[] {
  let start = 0;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.kind === "slash-command" && isIterateStart(ev.commandName)) start = i;
    else if (ev.kind === "assistant" && startsWorktree(ev)) start = i;
  }
  return start > 0 ? events.slice(start) : events;
}

/**
 * The window the ASK may be read from — anchored at the last KICKOFF only.
 *
 * Deliberately wider than `narrativeWindow`, which also anchors on the worktree
 * setup. The operator states what they want BEFORE the worktree exists, so a
 * worktree-anchored window has no ask inside it and the story would open with
 * no reason to exist (observed on all three real transcripts in the probe).
 * Still windowed rather than whole-transcript, so a campaign narrates the
 * CURRENT sub-iterate's request and not the first one of the day.
 */
function askWindow(events: readonly ParsedEvent[]): readonly ParsedEvent[] {
  let start = 0;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.kind === "slash-command" && isIterateStart(ev.commandName)) start = i;
  }
  return start > 0 ? events.slice(start) : events;
}

/**
 * The whole derivation for a parsed transcript: window it, gather the facts,
 * and recover the ask from the wider kickoff window when the narrative window
 * started at a worktree setup. This is the entry point callers want —
 * `narrativeWindow` / `gatherFacts` stay exported for isolated testing.
 */
export function factsFromTranscript(events: readonly ParsedEvent[]): NarrativeFacts {
  const facts = gatherFacts(narrativeWindow(events));
  return facts.ask == null ? { ...facts, ask: askFrom(askWindow(events)) } : facts;
}

function startsWorktree(ev: ParsedEvent & { kind: "assistant" }): boolean {
  return toolUses(ev).some(
    (tu) => tu.name === "Bash" && opensIterateWorktree(readInput(tu.input, "command")),
  );
}

function readInput(input: unknown, key: "command" | "file_path"): string {
  const v = (input as Record<string, unknown> | undefined)?.[key];
  return typeof v === "string" ? v : "";
}

/** Kickoff flags that CONSUME the next token. Whether a flag takes a value is
 *  not decidable in general, so this is the known set for this command family
 *  (see the iterate skill's usage banner) rather than a guess: an UNKNOWN flag
 *  drops only itself, because eating a real word out of the request is the
 *  worse failure. `--flag=value` needs no entry. */
const VALUE_FLAGS = new Set(["--type", "--complexity", "--campaign", "--sub-iterate-id"]);

/** Leading CLI flags are how a request was made, not what it said. Stops at
 *  `--`, so a request that legitimately begins with a dash survives intact. */
function stripFlags(raw: string): string {
  const tokens = raw.trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "--") {
      i += 1;
      break; // everything after is the request, verbatim
    }
    if (!t.startsWith("-") || t.length < 2) break;
    i += VALUE_FLAGS.has(t) ? 2 : 1;
  }
  return tokens.slice(i).join(" ").trim();
}

function firstLine(s: string): string {
  const i = s.indexOf("\n");
  return (i >= 0 ? s.slice(0, i) : s).trim();
}

function askFrom(events: readonly ParsedEvent[]): string | null {
  for (const ev of events) {
    let raw: string | null = null;
    if (ev.kind === "slash-command" && ev.args) raw = stripFlags(ev.args);
    else if (ev.kind === "user" && !isOnlyToolResults(ev)) raw = userText(ev);
    if (raw == null) continue;
    const line = firstLine(raw);
    if (line.length < 5 || INJECTED.some((p) => line.startsWith(p))) continue;
    const clean = sanitizeProofText(line, ASK_CAP);
    if (clean) return clean;
  }
  return null;
}

const FAIL_COUNT = /(?:tests?\s+)?(\d+)\s+(?:failed|failing)\b/i;
const PASS_COUNT = /(\d+)\s+passed\b/i;

/** Grade a test invocation by its paired result (AC3). Absent result → pending. */
function outcomeOf(res: { content: string; is_error: boolean } | undefined): TestOutcome {
  if (!res) return { status: "pending" };
  const failed = FAIL_COUNT.exec(res.content);
  const n = failed ? Number(failed[1]) : 0;
  if (n > 0) return { status: "failed", failed: n };
  if (res.is_error) return { status: "failed", failed: null };
  return { status: "passed", counted: PASS_COUNT.test(res.content) };
}

/** Pair every `tool_result` to its call, exactly as `BubbleTranscript` already
 *  does — the narrator was the only consumer that ignored `is_error`. */
function resultsById(
  events: readonly ParsedEvent[],
): Map<string, { content: string; is_error: boolean }> {
  const map = new Map<string, { content: string; is_error: boolean }>();
  for (const ev of events) {
    if (ev.kind !== "user") continue;
    for (const r of toolResults(ev)) {
      map.set(r.tool_use_id, { content: r.content, is_error: r.is_error });
    }
  }
  return map;
}

/** Flatten a window into the facts it evidences. Order-independent except for
 *  `tests`, whose sequence IS the plot. */
export function gatherFacts(events: readonly ParsedEvent[]): NarrativeFacts {
  if (events.length === 0) return EMPTY;
  const results = resultsById(events);
  const f: NarrativeFacts = { ...EMPTY, tests: [] };
  f.ask = askFrom(events);

  for (const ev of events) {
    if (ev.kind === "pr-link") {
      f.pr = f.pr ?? ev.prNumber;
      continue;
    }
    if (ev.kind !== "assistant") continue;
    for (const tu of toolUses(ev)) {
      if (tu.name === "Bash") {
        const res = results.get(tu.id);
        switch (classifyCommand(readInput(tu.input, "command"))) {
          case "test": {
            const outcome = outcomeOf(res);
            if (outcome.status === "pending") f.pending = true;
            f.tests.push(outcome);
            break;
          }
          case "finalize":
            f.commits += 1;
            break;
          case "merge":
            f.pushed = true;
            break;
          default:
            f.commands += 1;
        }
        continue;
      }
      if (tu.name === "Read") f.read += 1;
      else if (tu.name === "Grep" || tu.name === "Glob") f.searched += 1;
      else if (tu.name === "Edit" || tu.name === "Write" || tu.name === "MultiEdit") {
        if (classifyEditPath(readInput(tu.input, "file_path")) === "spec") f.specWritten = true;
        else if (classifyEditPath(readInput(tu.input, "file_path")) === "product") f.changed += 1;
      }
    }
  }
  return f;
}
