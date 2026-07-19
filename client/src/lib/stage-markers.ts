/*
 * stage-markers.ts — the REAL phase markers a transcript can evidence
 * (FR-01.66, campaign 2026-07-18-mission-artifacts S4).
 *
 * The classification half of the honest stage derivation: it turns a parsed
 * transcript window into a flat set of booleans ("a test ran", "a product file
 * was edited"). `stage-derivation.ts` owns the scenario branches that read them.
 * Split out because the two concerns move for different reasons — the marker
 * vocabulary changes when Shipwright's tooling changes, the branches change when
 * the scenario model does.
 *
 * ONE definition per concept, used everywhere. The recurring review finding in
 * this campaign was reasoning applied in one place but not the parallel one, so
 * `classifyEditPath` is the single edit-path authority: no caller re-implements
 * "is this a spec file".
 */

import { toolUses, type ParsedEvent } from "../external/session-parser";

export type EditKind = "spec" | "finalize" | "incidental" | "product";

/**
 * What KIND of thing an `Edit`/`Write`/`MultiEdit` touched.
 *
 * Path-SEGMENT / filename anchors, never bare substrings: `specification.ts` and
 * `login.spec.ts` (a test file) must NOT read as the Spec stage — a false
 * positive an earlier substring match actually made.
 *
 * `incidental` is the S4 addition and the whole fix: scratch space, plan/todo
 * state, `.shipwright` bookkeeping and memory notes are things an iterate writes
 * WHILE it is still scouting. They are not product work and must not claim Build.
 */
export function classifyEditPath(rawPath: string): EditKind {
  const p = rawPath.toLowerCase().replace(/\\/g, "/");
  if (/changelog|decision_log/.test(p)) return "finalize";
  if (/(^|\/)spec\.md$|\/planning\/|\/adr\//.test(p)) return "spec";
  if (
    /\/scratchpad\//.test(p) ||
    /\/(tmp|temp)\//.test(p) ||
    /\/memory\//.test(p) ||
    /\/\.claude\//.test(p) ||
    /\/\.shipwright\//.test(p) ||
    /(^|\/)plan\.json$/.test(p) ||
    /(^|\/)todos?\.(json|md)$/.test(p) ||
    p.endsWith(".log")
  ) {
    return "incidental";
  }
  return "product";
}

/** True for a `/shipwright-iterate` kickoff (incl. `--campaign … --autonomous`) —
 *  both an Analyze marker and the `currentIterateEvents` windowing boundary. */
export function isIterateStart(commandName: string): boolean {
  return /shipwright-iterate/i.test(commandName);
}

const RE_MERGE = /git push|\bgh pr\b|\bgh run\b/;
const RE_FINALIZE =
  /git commit|changelog|decision_log|finalize_iterate|write_decision_log|artifact_sync|verify_iterate/;
const RE_TEST = /\b(npm (run )?test|vitest|playwright|pytest|jest)\b/;
const RE_BUILD = /npm run build|vite build|\btsc\b|typecheck/;
/** The iterate's OWN scope/calibration tooling — the real Analyze phase. Measured
 *  frequency over 114 real iterate transcripts: `setup_iterate_worktree` 89%,
 *  `classify_complexity` 66%, `external_review.py` 46%. */
const RE_SCOPE =
  /setup_iterate_worktree|classify_complexity|check-external-review-keys|external_review\.py|mark-review-state/;

/** The tools that evidence scouting rather than producing. */
const SCOPE_TOOLS: ReadonlySet<string> = new Set(["Read", "Grep", "Glob", "Task", "TodoWrite"]);
const EDIT_TOOLS: ReadonlySet<string> = new Set(["Edit", "Write", "MultiEdit"]);

export interface Markers {
  scope: boolean;
  spec: boolean;
  build: boolean;
  test: boolean;
  finalize: boolean;
  merge: boolean;
  /** A real product-source edit — genuine build work. */
  productEdit: boolean;
  /** Scratch / bookkeeping / notes — scope activity, NOT build work. */
  incidentalEdit: boolean;
  /** A `/shipwright-iterate` kickoff is present in this window. */
  iterateKickoff: boolean;
}

function readString(input: unknown, key: "command" | "file_path"): string {
  const v = (input as Record<string, unknown> | undefined)?.[key];
  return typeof v === "string" ? v : "";
}

/** Flatten a transcript window into the marker set. Pure; order-independent. */
export function collectMarkers(events: readonly ParsedEvent[]): Markers {
  const m: Markers = {
    scope: false,
    spec: false,
    build: false,
    test: false,
    finalize: false,
    merge: false,
    productEdit: false,
    incidentalEdit: false,
    iterateKickoff: false,
  };
  for (const ev of events) {
    if (ev.kind === "pr-link") {
      m.merge = true; // the strongest "pushed, awaiting merge" marker
      continue;
    }
    if (ev.kind === "slash-command") {
      const name = ev.commandName.toLowerCase();
      if (isIterateStart(name)) {
        m.iterateKickoff = true;
        m.scope = true;
      } else if (/\banalyze\b|\bscout\b/.test(name)) m.scope = true;
      // NOTE (external code review, GPT finding 1 — HIGH): invoking a command
      // whose NAME contains "spec"/"plan" used to set the Spec marker. That is
      // exactly the class of claim AC2 forbids — Spec means the iterate spec was
      // actually WRITTEN, and running `/…-plan` writes nothing. Spec is now
      // evidenced only by a real spec/planning/ADR write (`classifyEditPath`).
      continue;
    }
    if (ev.kind !== "assistant") continue;
    for (const tu of toolUses(ev)) {
      if (tu.name === "Bash") {
        const cmd = readString(tu.input, "command").toLowerCase();
        if (RE_MERGE.test(cmd)) m.merge = true;
        if (RE_FINALIZE.test(cmd)) m.finalize = true;
        if (RE_TEST.test(cmd)) m.test = true;
        if (RE_BUILD.test(cmd)) m.build = true;
        if (RE_SCOPE.test(cmd)) m.scope = true;
        continue;
      }
      if (SCOPE_TOOLS.has(tu.name)) {
        m.scope = true;
        continue;
      }
      if (EDIT_TOOLS.has(tu.name)) {
        switch (classifyEditPath(readString(tu.input, "file_path"))) {
          case "finalize":
            m.finalize = true;
            break;
          case "spec":
            m.spec = true;
            break;
          case "incidental":
            m.incidentalEdit = true;
            m.scope = true; // writing a probe/note IS scope work
            break;
          default:
            m.productEdit = true;
        }
      }
    }
  }
  return m;
}
