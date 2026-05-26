/*
 * ToolOutputBlock — Campaign-C C3 BubbleTranscript split (2026-05-26).
 *
 * Renders one tool-use + (optionally) matching tool-result as a card.
 * Branch dispatch:
 *   - `name === "AskUserQuestion"` → ask-bubble (pending amber / resolved
 *     green); when unresolved AND `task` provided, embeds an
 *     `AnswerInTerminalButton` for one-click clipboard-copy of the
 *     resume command.
 *   - `name === "TodoWrite"` → `TodoWriteCard` (specialized renderer).
 *   - `name === "TaskCreate" | "TaskUpdate"` → `TaskListAggregateCard`
 *     (ADR-057 — walks all tool_uses up to this id and snapshots state).
 *   - everything else → generic `ToolCard` (collapsed-by-default,
 *     `defaultOpen` controls the initial expanded state).
 *
 * Naming note (external review openai-8 / gemini-5): this file is a
 * DIFFERENT module from the legacy strip-ansi `ToolOutputBlock` at
 * `client/src/components/external/ToolOutputBlock.tsx`. The legacy one
 * is now re-exported through `BubbleTranscript/AnsiText.tsx`. Imports
 * here use the legacy strip-ansi block ONLY indirectly through
 * `ToolCard` (which renders the output body).
 */

import { askUserQuestionSummary } from "../../../external/session-parser";
import { ToolCard } from "../ToolCard";
import { TaskListAggregateCard, TodoWriteCard } from "../TaskListCard";
import type { ExternalTask } from "../../../lib/externalApi";
import { AnswerInTerminalButton } from "./AnswerInTerminalButton";

export type ToolUseEntry = { id: string; name: string; input: unknown };
export type ToolResultEntry = { content: string; is_error: boolean };

interface Props {
  toolUse: ToolUseEntry;
  toolResult?: ToolResultEntry;
  defaultOpen?: boolean;
  /** ids of tool_uses whose result is in scope — used for AskUserQuestion lifecycle. */
  resolved: Set<string>;
  /** Full chronological tool-use array — used by TaskListAggregateCard. */
  allToolUses: ToolUseEntry[];
  /** Optional task for the AnswerInTerminalButton (omit → no resume CTA). */
  task?: ExternalTask;
}

export function ToolOutputBlock({
  toolUse,
  toolResult,
  defaultOpen,
  resolved,
  allToolUses,
  task,
}: Props) {
  const { id, name, input } = toolUse;

  if (name === "AskUserQuestion") {
    return (
      <AskUserBubble id={id} input={input} resolved={resolved} task={task} />
    );
  }

  if (name === "TodoWrite") {
    return (
      <div
        className="max-w-[90%] w-full"
        data-testid="bubble-tool-use"
        data-tool-use-id={id}
      >
        <TodoWriteCard id={id} input={input} result={toolResult} />
      </div>
    );
  }

  if (name === "TaskCreate" || name === "TaskUpdate") {
    return (
      <div
        className="max-w-[90%] w-full"
        data-testid="bubble-tool-use"
        data-tool-use-id={id}
      >
        <TaskListAggregateCard
          id={id}
          allToolUses={allToolUses}
          streamComplete={toolResult != null}
        />
      </div>
    );
  }

  return (
    <div
      className="max-w-[90%] w-full"
      data-testid="bubble-tool-use"
      data-tool-use-id={id}
    >
      <ToolCard
        id={id}
        name={name}
        input={input}
        result={toolResult}
        {...(defaultOpen != null ? { defaultOpen } : {})}
      />
    </div>
  );
}

function AskUserBubble({
  id,
  input,
  resolved,
  task,
}: {
  id: string;
  input: unknown;
  resolved: Set<string>;
  task?: ExternalTask;
}) {
  const q = askUserQuestionSummary(input);
  const isResolved = resolved.has(id);
  return (
    <div
      className="max-w-[90%] p-3 text-[13px]"
      style={{
        background: "var(--color-surface, #ffffff)",
        border: "1px solid var(--color-border, #e0dbd4)",
        borderLeft: `3px solid ${
          isResolved
            ? "var(--color-success, #059669)"
            : "var(--color-warning, #D97706)"
        }`,
        borderRadius: "var(--radius-button, 8px)",
        boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
        color: "var(--color-text, #1a1a1a)",
      }}
      data-testid={isResolved ? "askuser-resolved" : "askuser-pending"}
      data-tool-use-id={id}
    >
      <div
        className="text-[10px] font-semibold uppercase tracking-wide"
        style={{
          color: isResolved
            ? "var(--color-success, #059669)"
            : "var(--color-warning, #D97706)",
        }}
      >
        {isResolved ? "✓ Answered" : "→ Answer in your terminal"}
      </div>
      <div className="mt-1.5 text-[14px] font-medium">{q.question}</div>
      {q.options.length > 0 && (
        <ul
          className="mt-2 flex flex-wrap gap-1.5 pl-0"
          style={{ listStyle: "none" }}
          data-testid="askuser-options"
        >
          {q.options.map((o, i) => (
            <li
              key={i}
              data-testid={`askuser-option-${i}`}
              className="inline-flex items-center"
              style={{
                background: "var(--color-muted-bg, #ede8e1)",
                border: "1px solid var(--color-border, #e0dbd4)",
                borderRadius: "999px",
                color: "var(--color-text, #1a1a1a)",
                fontSize: "13px",
                fontWeight: 500,
                lineHeight: 1.3,
                padding: "4px 10px",
              }}
            >
              {o}
            </li>
          ))}
        </ul>
      )}
      {q.fallback && (
        <div
          className="mt-1 italic text-[12px]"
          style={{ color: "var(--color-muted, #6b7280)" }}
        >
          (Question payload schema differed from expected — open the task in your terminal to see the original.)
        </div>
      )}
      {!isResolved && task && (
        <div className="mt-2.5 flex justify-end" data-testid="askuser-resume-row">
          <AnswerInTerminalButton task={task} />
        </div>
      )}
    </div>
  );
}
