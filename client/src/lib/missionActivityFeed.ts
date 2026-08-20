import { askUserQuestionSummary, assistantText, toolResults, toolUses, type ParsedEvent } from "../external/session-parser";
import type { ArtifactKind, CommitArtifact, MissionContext } from "./missionContextApi";
import { clean, commandDetail, commandLabel, excerpt, isCompactionMarker, meaningfulRequest, resolveQuestionAnswer } from "./missionActivityFeedText";

export type ActivityKind = "goal" | "investigate" | "spec" | "implement" | "test" | "review" | "user-input" | "blocker" | "system" | "delivery";

export interface ActivityQuestion {
  text: string;
  options: string[];
  /** Separates "genuinely still pending" from "answered" — the unresolved
   * CTA renders only while this is false, independent of whether the
   * answer matched a listed option. */
  resolved: boolean;
  picked?: string;
  answer?: string;
}

export interface ActivityCard {
  kind: ActivityKind;
  text: string;
  commands: string[];
  artifact?: ArtifactKind;
  /** Bounded, sanitized raw-output excerpt — real transcript content, never
   * a gate verdict (MissionContext stays the sole verdict source). */
  detail?: string;
  /** Pill state, always derived from MissionContext — never string-matched
   * from `text`. */
  status?: "ok" | "err" | "warn";
  question?: ActivityQuestion;
}

export interface ActivityFeed {
  goal: string | null;
  outcome: string;
  cards: ActivityCard[];
}

function artifact(context: MissionContext | null, kind: ArtifactKind): boolean {
  return context?.artifacts.some((item) => item.kind === kind && item.state === "available") ?? false;
}

/** Typed-event reducer for the calm Mission activity feed. `MissionContext`
 * stays the SOLE source for any gate verdict (tests pass/fail, artifact
 * availability) — raw `toolResults()` content is permitted only as bounded,
 * sanitized `detail`/`question.answer` text on `blocker`/`test`/`user-input`
 * cards (iterate-2026-08-20-mission-feed-content, narrowing the prior
 * "no raw tool output" constraint). Per-card text prefers the turn's own
 * `assistantText()` explanation over the generic bucket sentence when Claude
 * wrote one (iterate-2026-08-13-mission-mobile-visual) — rendered by the
 * caller through the same safe markdown/text path as the rest of the
 * transcript (`MarkdownChunk` for prose, a literal text node for raw
 * excerpts), never raw HTML, since it is assistant/tool-influenced content. */
export function deriveActivityFeed(
  events: readonly ParsedEvent[],
  context: MissionContext | null,
  taskTitle: string | null,
  explicitGoal?: string | null,
): ActivityFeed {
  const goal = clean(explicitGoal ?? "") || (meaningfulRequest(events) ?? taskTitle?.trim() ?? null);
  const cards: ActivityCard[] = [];
  let unresolvedTest: ActivityCard | null = null;
  const testCards: ActivityCard[] = [];
  const unresolvedBlockers = new Map<string, { card: ActivityCard; bucket: ActivityKind }>();
  const pendingTools = new Map<string, { bucket: ActivityKind; card: ActivityCard; commandKey: string; label: string; background: boolean }>();
  const add = (kind: ActivityKind, text: string, command: string, artifact?: ArtifactKind, coalesce = true): ActivityCard => {
    const previous = cards[cards.length - 1];
    if (coalesce && previous?.kind === kind && previous.text === text && previous.artifact === artifact) {
      if (!previous.commands.includes(command)) previous.commands.push(command);
      return previous;
    }
    const card: ActivityCard = { kind, text, commands: [command], artifact };
    cards.push(card);
    return card;
  };
  for (const event of events) {
    if (isCompactionMarker(event)) {
      cards.push({ kind: "system", text: "Context automatically compacted.", commands: [] });
    }
    if (event.kind === "user") {
      for (const result of toolResults(event)) {
        const pending = pendingTools.get(result.tool_use_id);
        if (!pending) continue;
        pendingTools.delete(result.tool_use_id);
        if (pending.bucket === "user-input") {
          // Only a non-error resolution counts as an actual answer (mini-plan,
          // code review catch): an errored/cancelled prompt sets `resolved`
          // here too would permanently hide `AnswerInTerminalButton` (FR-01.63)
          // even though nothing was actually decided.
          if (pending.card.question && !result.is_error) {
            pending.card.question.resolved = true;
            const resolved = resolveQuestionAnswer(result.content, pending.card.question.options);
            pending.card.question.picked = resolved.picked;
            pending.card.question.answer = resolved.answer;
            pending.card.text = "The requested user input was received and work could continue.";
          }
        } else if (pending.bucket === "test") {
          if (result.is_error) {
            pending.card.text = "This test command needs attention.";
            pending.card.status = "err";
            pending.card.detail = excerpt(result.content);
            unresolvedTest = pending.card;
          } else if (pending.background) {
            // A shell acknowledgement is not proof that the spawned job ended.
            // Keep the card pending until MissionContext records its result.
          } else if (unresolvedTest) {
            // A locally-observed successful retry is real recovery evidence
            // for THIS attempt, independent of whether MissionContext.tests.gate
            // has caught up yet — merging it here regardless of `gate` (external
            // review catch, high) closes a duplicate-card leak: leaving
            // `unresolvedTest` set until `gate === "pass"` let the OLD failed
            // card linger in the feed forever whenever the gate stayed
            // fail/unknown, and let the final reconciliation below attach that
            // lagging gate's status to the NEW card next to text already
            // claiming completion. The PILL stays gate-derived either way (the
            // final reconciliation still runs unconditionally); only this
            // sentence's wording stays conservative about what was RECORDED.
            unresolvedTest.text = context?.tests?.gate === "pass"
              ? "Tests recovered and have a recorded passing result."
              : "This test command completed after an earlier failure.";
            unresolvedTest.status = undefined;
            unresolvedTest.detail = undefined;
            if (!unresolvedTest.commands.includes(pending.label)) unresolvedTest.commands.push(pending.label);
            cards.splice(cards.indexOf(pending.card), 1);
            testCards.splice(testCards.indexOf(pending.card), 1);
            unresolvedTest = null;
          } else {
            pending.card.text = "This test command completed.";
          }
        } else if (result.is_error) {
          pending.card.kind = "blocker";
          pending.card.text = "A command needs attention before work can continue.";
          pending.card.status = "err";
          // `add()` coalesces same-kind/text/artifact cards across several
          // tool_use ids (the "many-files-in-a-row" case) — attaching this
          // one command's error excerpt would misattribute it to a card
          // whose `commands` chip list still names other, unrelated,
          // non-erroring commands. Only attach when unambiguous.
          if (pending.card.commands.length === 1) pending.card.detail = excerpt(result.content);
          unresolvedBlockers.set(pending.commandKey, { card: pending.card, bucket: pending.bucket });
        } else if (unresolvedBlockers.has(pending.commandKey)) {
          const blocker = unresolvedBlockers.get(pending.commandKey)!;
          blocker.card.kind = blocker.bucket;
          blocker.card.text = "A command error recovered after a successful retry.";
          blocker.card.status = undefined;
          blocker.card.detail = undefined;
          if (!blocker.card.commands.includes(pending.label)) blocker.card.commands.push(pending.label);
          cards.splice(cards.indexOf(pending.card), 1);
          unresolvedBlockers.delete(pending.commandKey);
        }
      }
      continue;
    }
    if (event.kind !== "assistant") continue;
    // A turn's own explanation (when Claude wrote one alongside its tool calls)
    // replaces the generic bucket sentence below — reusing the same raw-JSONL
    // `assistantText()` narrator-transcript.ts already narrates from, so a
    // non-technical reader gets the actual reasoning instead of a templated
    // "was updated in compact steps." Purely deterministic text extraction,
    // never a new LLM call. Empty for the common tool-only turn (no text
    // block at all), which keeps every existing fallback-sentence case —
    // including the many-files-in-a-row coalescing the long-iterate test
    // relies on — byte-identical.
    const prose = clean(assistantText(event).split("\n").find((line) => line.trim().length > 0) ?? "");
    for (const tool of toolUses(event)) {
      const input = tool.input as Record<string, unknown> | undefined;
      const shell = typeof input?.command === "string" ? input.command : "";
      const background = input?.run_in_background === true || input?.background === true;
      const bucket = tool.name === "AskUserQuestion" ? "user-input"
        : /test|vitest|playwright|pytest/i.test(shell) ? "test"
        : /review/i.test(shell) || tool.name === "Task" ? "review"
        : tool.name === "Read" || tool.name === "Grep" || tool.name === "Glob" ? "investigate"
        : /\.shipwright[\\/].*(spec|plan)/i.test(String(input?.file_path ?? "")) ? "spec"
        : "implement";
      const label = commandLabel(tool.name, tool.input);
      const commandKey = `${tool.name}\u0000${commandDetail(tool.input)}`;
      if (bucket === "test") {
        const card: ActivityCard = {
          kind: "test",
          text: "This test command needs attention: it is awaiting a result.",
          commands: [label],
          artifact: artifact(context, "tests") ? "tests" : undefined,
        };
        cards.push(card);
        testCards.push(card);
        pendingTools.set(tool.id, { bucket, card, commandKey, label, background });
      } else if (bucket === "user-input") {
        const card = add("user-input", "A user decision is needed before work can continue.", label, undefined, false);
        // Always set `card.question` — even the `fallback` shape carries a
        // real (if generic) placeholder question. Gating this on
        // `!summary.fallback` (code review catch) silently dropped the
        // terminal CTA for a genuinely unparseable AskUserQuestion payload,
        // since the whole question block — CTA included — renders only when
        // `card.question` is truthy.
        const summary = askUserQuestionSummary(tool.input);
        card.question = { text: summary.question, options: summary.options, resolved: false };
        pendingTools.set(tool.id, { bucket, card, commandKey, label, background });
      } else {
        const card = bucket === "review" ? add("review", prose || "Review work is in progress.", label, artifact(context, "review") ? "review" : undefined)
          : bucket === "spec" ? add("spec", prose || "The intended change was captured in the run record.", label, artifact(context, "spec") ? "spec" : undefined)
          : bucket === "investigate" ? add("investigate", prose || "The existing behaviour was examined before changes were made.", label)
          : add("implement", prose || "The implementation was updated in compact steps.", label);
        pendingTools.set(tool.id, { bucket, card, commandKey, label, background });
      }
    }
  }

  if (cards.some((card) => card.kind === "test") || artifact(context, "tests")) {
    const gate = context?.tests?.gate;
    const status: ActivityCard["status"] = gate === "pass" ? "ok" : gate === "fail" ? "err" : "warn";
    const latest = testCards.at(-1);
    // An earlier test still genuinely open must never be silently hidden
    // behind a later completed/recovered one (pre-existing) — surfaced via
    // `latest`'s text below even when `latest` itself already settled.
    const pendingTest = testCards.some((card) => /awaiting a result/i.test(card.text));
    if (!latest) {
      const text = gate === "pass" ? "Tests have a recorded passing result."
        : gate === "fail" ? "Tests have a recorded failing result." : "No reliable test result is recorded.";
      cards.push({ kind: "test", text, commands: [], artifact: artifact(context, "tests") ? "tests" : undefined, status });
    } else if (pendingTest) {
      latest.text = "The latest test attempt needs attention.";
      // A real "fail" gate still escalates the pill (code review catch: a
      // hardcoded "warn" could under-claim a genuine failure), but "pass"
      // cannot claim "ok" here (doubt-review catch, high): something in
      // this run is still unresolved, so a green pill next to "needs
      // attention" text would be self-contradictory.
      latest.status = gate === "fail" ? "err" : "warn";
    } else {
      // The status PILL follows `gate` unconditionally — even when the
      // transcript's own retry-tracking left the last observed attempt
      // unresolved (`unresolvedTest`), the pill must never contradict the
      // recorded gate (external review catch: a stale local "err" from an
      // unretried failure was surviving past a `gate: "pass"` reconcile).
      // The prose TEXT stays conservative under that same guard — it is
      // local-transcript colour commentary, not the verdict itself, and
      // "needs attention" text next to a real recorded pass is deliberate:
      // this transcript never proved the recovery it would be claiming.
      latest.status = status;
      if (!unresolvedTest) {
        if (gate === "pass" && latest.text === "This test command completed.") latest.text = "Tests have a recorded passing result.";
        if (gate === "fail") latest.text = "Tests have a recorded failing result.";
        if (gate === "unknown") latest.text = "No reliable test result is recorded.";
      } else if (status === "ok") {
        // The gate overrode an unretried local failure back to ok (this
        // attempt was never locally proven to recover — code review catch,
        // high) — the stale FAIL excerpt must not keep rendering under a
        // pill that now says "Passing". An "unknown" gate leaves the pill at
        // "warn" and INTENTIONALLY keeps the detail: the local failure is
        // still the best evidence available, not contradicted by anything.
        latest.detail = undefined;
      }
    }
  }
  for (const kind of ["spec", "requirement", "decisions"] as const) {
    if (artifact(context, kind) && !cards.some((card) => card.artifact === kind)) {
      const text = kind === "spec" ? "Specification evidence is available."
        : kind === "requirement" ? "Requirement evidence is available." : "A recorded decision is available.";
      cards.push({ kind: "spec", text, commands: [], artifact: kind, status: "ok" });
    }
  }
  if (artifact(context, "review")) {
    const review = [...cards].reverse().find((card) => card.kind === "review");
    if (review) {
      review.text = "The recorded review evidence is available.";
      review.artifact = "review";
      review.status = "ok";
    } else {
      cards.push({ kind: "review", text: "The recorded review evidence is available.", commands: [], artifact: "review", status: "ok" });
    }
  }
  const pipelinePhase = context?.artifacts.find((item) => item.kind === "phase");
  const pipelineFinished = context?.scenario === "pipeline" && context.runLive === false && pipelinePhase?.state === "available" && /^(done|completed|succeeded)$/i.test(pipelinePhase.detail?.status ?? "");
  const requirement = context?.artifacts.find((item) => item.kind === "requirement");
  const requirementRecorded = requirement?.kind === "requirement" && (
    requirement.detail?.lifecycle === "recorded" || (
      requirement.detail?.lifecycle === "none" && requirement.detail.confidence === "finalized"
    )
  );
  // These fields are populated from the same `work_completed` record by the
  // server resolver. A merely terminal task can have neither, so it cannot
  // fabricate a completed delivery card.
  const iterateFinished = context?.scenario === "iterate" && context.runLive === false && (
    requirementRecorded || context.tests !== null
  );
  const finished = iterateFinished || pipelineFinished;
  if (finished) {
    const link: ArtifactKind = pipelineFinished ? "phase" : "commit";
    const commit = context?.artifacts.find((item) => item.kind === "commit") as CommitArtifact | undefined;
    const text = !pipelineFinished && commit?.detail?.message
      ? `Merged as "${commit.detail.message}".`
      : "This completed run is recorded through durable artifacts.";
    cards.push({ kind: "delivery", text, commands: [], artifact: link });
  }
  const outcome = finished ? "Completed run" : context?.runLive ? "In progress" : "Waiting for reliable evidence";
  return { goal, outcome, cards };
}
