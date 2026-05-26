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
  if (item.kind === "ask_tool") return item.toolUseId;
  if (item.kind === "terminal_prompt") return `tp-${item.taskId}`;
  return item.questionId;
}

/**
 * InboxCard — dispatches on `item.kind`:
 *  - `ask_tool`        → `AskToolCard`     (read-only Ask-bubble + Answer CTA)
 *  - `text_question`   → `WaitingReplyCard` (plain-text end-of-turn question)
 *  - `terminal_prompt` → `WaitingReplyCard` (live AskUserQuestion picker
 *    detected in the embedded terminal — iterate-2026-05-18-inbox-terminal-prompts)
 */
export function InboxCard({
  item,
  task,
}: {
  item: InboxItem;
  task: ExternalTask | undefined;
}) {
  if (item.kind === "text_question" || item.kind === "terminal_prompt") {
    return <WaitingReplyCard item={item} task={task} />;
  }
  return <AskToolCard item={item} task={task} />;
}
