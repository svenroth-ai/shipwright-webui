/*
 * InboxCard — polymorphic dispatcher (C7 — 2026-05-26).
 *
 * Pre-budgeted sub-split per mini-plan Risk R1 (and external-plan-review
 * gemini LOW finding): the source's two card variants exceed 300 LOC
 * combined, so this file hosts only the dispatcher + shared module-scope
 * helpers (PHASE_ICON, KNOWN_PHASES, inboxItemKey, MAX_BODY_PREVIEW_PX).
 * The two variants live in InboxCard.AskTool.tsx + InboxCard.Waiting.tsx.
 *
 * Same DOM tree, same testids, same nav semantics as source (no wrapper
 * nodes added — external-plan-review MED #2).
 */
import {
  Hammer,
  ListChecks,
  Palette,
  FlaskConical,
  Rocket,
  ShieldAlert,
  ShieldCheck,
  Workflow,
} from "lucide-react";

import type { ExternalTask, InboxItem } from "../../lib/externalApi";
import { AskToolCard } from "./InboxCard.AskTool";
import { WaitingReplyCard } from "./InboxCard.Waiting";
import { LeadQuestionCard } from "./InboxCard.LeadQuestion";

// Known phase ids (mirrors PIPELINE_PHASES but we intentionally don't couple
// to Kanban phaseMapping, which uses a slightly different vocab). Used as the
// classifyPhase allowlist to derive a best-effort phase tag for the context
// pill from the task title.
export const KNOWN_PHASES = [
  "project",
  "design",
  "plan",
  "build",
  "test",
  "security",
  "compliance",
  "changelog",
  "deploy",
] as const;

/** Inbox card body preview height before the soft fade-out clip kicks in
 *  (iterate-2026-05-19-inbox-markdown-render). The whole card is
 *  click-through to TaskDetail for the full content. */
export const MAX_BODY_PREVIEW_PX = 220;

export const PHASE_ICON: Record<
  string,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  build: Hammer,
  design: Palette,
  plan: ListChecks,
  project: ListChecks,
  test: FlaskConical,
  deploy: Rocket,
  compliance: ShieldCheck,
  security: ShieldAlert,
  changelog: Workflow,
};

/** Stable React key / testid base for an inbox item, kind-aware. */
export function inboxItemKey(item: InboxItem): string {
  switch (item.kind) {
    case "ask_tool":
      return item.toolUseId;
    case "terminal_prompt":
      return `tp-${item.taskId}`;
    case "text_question":
      return item.questionId;
    case "lead_question":
      return `lq-${item.taskId}`;
    default:
      // Exhaustiveness guard (FR-04.19 trap 3/4) — a fifth kind added to
      // `InboxItem` without a case here is a TYPE error at this line,
      // not a silent `undefined` key.
      return unhandledInboxItemKind(item);
  }
}

export function unhandledInboxItemKind(item: never): never {
  throw new Error(
    `inboxItemKey: unhandled inbox item kind: ${(item as InboxItem).kind}`,
  );
}

/**
 * The honesty line (A19, FR-01.63, AC4). Every waiting card states plainly that
 * the operator answers in the terminal and the WebUI does NOT answer for them —
 * so nobody is left guessing whether a click "sent" their reply. The copy is a
 * REQUIREMENT (asserted in a test), not decoration; kept as one canonical string
 * so both card variants say the same thing.
 */
export const INBOX_TERMINAL_HONESTY =
  "Claude is waiting for your answer. Type it in the task's terminal — the WebUI doesn't answer for you.";

export function InboxTerminalHonesty({
  itemKey,
  align = "left",
}: {
  itemKey: string;
  align?: "left" | "right";
}) {
  return (
    <p
      data-testid={`inbox-honesty-${itemKey}`}
      style={{
        fontSize: "11.5px",
        color: "var(--color-muted)",
        lineHeight: 1.5,
        marginTop: "8px",
        textAlign: align,
      }}
    >
      {INBOX_TERMINAL_HONESTY}
    </p>
  );
}

/**
 * InboxCard — dispatches on `item.kind`:
 *  - `ask_tool`        → `AskToolCard`     (read-only Ask-bubble + Answer CTA)
 *  - `text_question`   → `WaitingReplyCard` (plain-text end-of-turn question)
 *  - `terminal_prompt` → `WaitingReplyCard` (live AskUserQuestion picker
 *    detected in the embedded terminal — iterate-2026-05-18-inbox-terminal-prompts)
 *  - `lead_question`   → `LeadQuestionCard` (FR-04.19 — webui answers inline,
 *    PATCHing `poFeedback`, unlike the three terminal-answered kinds above)
 */
export function InboxCard({
  item,
  task,
}: {
  item: InboxItem;
  task: ExternalTask | undefined;
}) {
  switch (item.kind) {
    case "text_question":
    case "terminal_prompt":
      return <WaitingReplyCard item={item} task={task} />;
    case "ask_tool":
      return <AskToolCard item={item} task={task} />;
    case "lead_question":
      return <LeadQuestionCard item={item} task={task} />;
    default:
      // Exhaustiveness guard (FR-04.19 trap 3/4) — see `unhandledInboxItemKind` above.
      return unhandledInboxItemKind(item);
  }
}
