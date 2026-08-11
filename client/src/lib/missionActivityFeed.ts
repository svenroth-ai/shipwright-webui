import { isOnlyToolResults, toolResults, toolUses, userText, type ParsedEvent } from "../external/session-parser";
import type { ArtifactKind, MissionContext } from "./missionContextApi";
import { sanitizeProofText } from "./proofLines";

export type ActivityKind = "goal" | "investigate" | "spec" | "implement" | "test" | "review" | "user-input" | "blocker" | "system" | "delivery";

export interface ActivityCard {
  kind: ActivityKind;
  text: string;
  commands: string[];
  artifact?: ArtifactKind;
}

export interface ActivityFeed {
  goal: string | null;
  outcome: string;
  cards: ActivityCard[];
}

const ignored = ["Base directory for this skill:", "Context automatically compacted", "This session is being continued", "<task-notification>", "<local-command"];
const clean = (value: string) => sanitizeProofText(value.split("\n")[0] ?? "", 280);
const valueFlags = new Set(["--type", "--complexity", "--campaign", "--sub-iterate-id"]);

function iterateArgs(raw: string): string {
  const tokens = raw.trim().split(/\s+/);
  let index = 0;
  while (tokens[index]?.startsWith("-")) index += valueFlags.has(tokens[index]) ? 2 : 1;
  return tokens.slice(index).join(" ");
}

function meaningfulRequest(events: readonly ParsedEvent[]): string | null {
  for (const event of events) {
    if (event.kind === "slash-command" && /^shipwright-iterate(?::iterate)?$/.test(event.commandName.replace(/^\//, ""))) {
      const text = clean(iterateArgs(event.args ?? ""));
      if (text.length >= 5 && !ignored.some((prefix) => text.startsWith(prefix))) return text;
    }
    if (event.kind !== "user" || isOnlyToolResults(event)) continue;
    const text = clean(userText(event));
    if (text.length < 5 || ignored.some((prefix) => text.startsWith(prefix))) continue;
    return text;
  }
  return null;
}

function isCompactionMarker(event: ParsedEvent): boolean {
  return event.kind === "system" && (
    /compact/i.test(event.subtype ?? "") || /context automatically compacted/i.test(event.text)
  );
}

function commandDetail(input: unknown): string {
  const value = input as Record<string, unknown> | undefined;
  return typeof value?.command === "string" ? value.command
    : typeof value?.file_path === "string" ? value.file_path
    : typeof value?.description === "string" ? value.description
    : typeof value?.pattern === "string" ? value.pattern : "";
}

function commandLabel(name: string, input: unknown): string {
  const detail = commandDetail(input);
  return detail ? `${name}: ${sanitizeProofText(detail, 180)}` : `Used ${name}`;
}

function artifact(context: MissionContext | null, kind: ArtifactKind): boolean {
  return context?.artifacts.some((item) => item.kind === kind && item.state === "available") ?? false;
}

/** Typed-event reducer for the calm Mission activity feed. It deliberately does
 * not read tool output: only durable MissionContext may prove a completed gate. */
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
  const add = (kind: ActivityKind, text: string, command: string, artifact?: ArtifactKind, coalesce = true) => {
    const previous = cards[cards.length - 1];
    if (coalesce && previous?.kind === kind && previous.text === text && previous.artifact === artifact) {
      if (!previous.commands.includes(command)) previous.commands.push(command);
      return previous;
    }
    const card = { kind, text, commands: [command], artifact };
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
          if (!result.is_error) pending.card.text = "The requested user input was received and work could continue.";
        } else if (pending.bucket === "test") {
          if (result.is_error) {
            pending.card.text = "This test command needs attention.";
            unresolvedTest = pending.card;
          } else if (pending.background) {
            // A shell acknowledgement is not proof that the spawned job ended.
            // Keep the card pending until MissionContext records its result.
          } else if (unresolvedTest && context?.tests?.gate === "pass") {
            unresolvedTest.text = "Tests recovered and have a recorded passing result.";
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
          unresolvedBlockers.set(pending.commandKey, { card: pending.card, bucket: pending.bucket });
        } else if (unresolvedBlockers.has(pending.commandKey)) {
          const blocker = unresolvedBlockers.get(pending.commandKey)!;
          blocker.card.kind = blocker.bucket;
          blocker.card.text = "A command error recovered after a successful retry.";
          if (!blocker.card.commands.includes(pending.label)) blocker.card.commands.push(pending.label);
          cards.splice(cards.indexOf(pending.card), 1);
          unresolvedBlockers.delete(pending.commandKey);
        }
      }
      continue;
    }
    if (event.kind !== "assistant") continue;
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
        pendingTools.set(tool.id, { bucket, card, commandKey, label, background });
      } else {
        const card = bucket === "review" ? add("review", "Review work is in progress.", label, artifact(context, "review") ? "review" : undefined)
          : bucket === "spec" ? add("spec", "The intended change was captured in the run record.", label, artifact(context, "spec") ? "spec" : undefined)
          : bucket === "investigate" ? add("investigate", "The existing behaviour was examined before changes were made.", label)
          : add("implement", "The implementation was updated in compact steps.", label);
        pendingTools.set(tool.id, { bucket, card, commandKey, label, background });
      }
    }
  }

  if (cards.some((card) => card.kind === "test") || artifact(context, "tests")) {
    const gate = context?.tests?.gate;
    const latest = testCards.at(-1);
    const pendingTest = testCards.some((card) => /awaiting a result/i.test(card.text));
    if (!latest) {
      const text = gate === "pass" ? "Tests have a recorded passing result."
        : gate === "fail" ? "Tests have a recorded failing result." : "No reliable test result is recorded.";
      cards.push({ kind: "test", text, commands: [], artifact: artifact(context, "tests") ? "tests" : undefined });
    } else if (pendingTest) {
      latest.text = "The latest test attempt needs attention.";
    } else if (!unresolvedTest) {
      if (gate === "pass" && latest.text === "This test command completed.") latest.text = "Tests have a recorded passing result.";
      if (gate === "fail") latest.text = "Tests have a recorded failing result.";
      if (gate === "unknown") latest.text = "No reliable test result is recorded.";
    }
  }
  for (const kind of ["spec", "requirement", "decisions"] as const) {
    if (artifact(context, kind) && !cards.some((card) => card.artifact === kind)) {
      const text = kind === "spec" ? "Specification evidence is available."
        : kind === "requirement" ? "Requirement evidence is available." : "A recorded decision is available.";
      cards.push({ kind: "spec", text, commands: [], artifact: kind });
    }
  }
  if (artifact(context, "review")) {
    const review = [...cards].reverse().find((card) => card.kind === "review");
    if (review) {
      review.text = "The recorded review evidence is available.";
      review.artifact = "review";
    } else {
      cards.push({ kind: "review", text: "The recorded review evidence is available.", commands: [], artifact: "review" });
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
    cards.push({ kind: "delivery", text: "This completed run is recorded through durable artifacts.", commands: [], artifact: link });
  }
  const outcome = finished ? "Completed run" : context?.runLive ? "In progress" : "Waiting for reliable evidence";
  return { goal, outcome, cards };
}
