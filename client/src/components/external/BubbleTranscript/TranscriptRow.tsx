/*
 * TranscriptRow — Campaign-C C3 BubbleTranscript split (2026-05-26).
 *
 * Renders one transcript row for any ParsedEvent kind. Dispatches by
 * `event.kind` to the appropriate bubble shape — extracted bit-perfect
 * from the legacy `BubbleTranscript.tsx` `BubbleRow` + `renderBubble`.
 *
 * The spec's minimum prop shape is `{ entry: TranscriptEntry; isLatest: boolean }`;
 * the additional context props (`previous`, `resolved`, `toolResultsById`,
 * `visibleToolUseIds`, `allToolUses`, `task`) are orchestration data the
 * shell threads through so bubble dispatch sees the same scope it does
 * in the monolithic shell. Bit-perfect preservation per external review
 * openai-3 + gemini-1.
 *
 * Small pill-renderers (system / custom-title / agent-name / permission-
 * mode / unknown / fallback) + `BubbleHeader` + `renderAttachmentCard` +
 * `formatTimestamp` live in `BubblePills.tsx` so this file stays under
 * the 300-LOC cleanup-invariant cap.
 */

import type { ReactNode } from "react";
import {
  assistantText,
  fileSnapshotBasenames,
  hasVisibleBubbleContent,
  isOnlyToolResults,
  isThinkingOnly,
  toolResults,
  toolUses,
  userText,
  type ParsedEvent,
} from "../../../external/session-parser";
import { AttachmentCard } from "../AttachmentCard";
import { MarkdownChunk } from "./MarkdownChunk";
import { AnsiText } from "./AnsiText";
import { SkillCard } from "../SkillCard";
import { SlashCommandChip } from "../SlashCommandChip";
import { TaskNotificationChip } from "../TaskNotificationChip";
import { PrLinkCard } from "./PrLinkCard";
import { StopHookCard } from "./StopHookCard";
import { ToolOutputBlock } from "./ToolOutputBlock";
import {
  AgentNamePill,
  BubbleHeader,
  CustomTitlePill,
  FallbackChip,
  ModeChangePill,
  PermissionModePill,
  SystemPill,
  UnknownDetails,
  renderAttachmentCard,
} from "./BubblePills";
import type { ExternalTask } from "../../../lib/externalApi";

export type TranscriptEntry = ParsedEvent;

interface Props {
  entry: TranscriptEntry;
  isLatest: boolean;
  previous: TranscriptEntry | null;
  resolved: Set<string>;
  toolResultsById: Map<string, { content: string; is_error: boolean }>;
  visibleToolUseIds: Set<string>;
  allToolUses: { id: string; name: string; input: unknown }[];
  task?: ExternalTask;
}

export function TranscriptRow({
  entry,
  previous,
  resolved,
  toolResultsById,
  visibleToolUseIds,
  allToolUses,
  task,
}: Props) {
  const turnSeparator = isTurnBoundary(previous, entry);
  const bubble = renderBubble(
    entry,
    resolved,
    toolResultsById,
    visibleToolUseIds,
    allToolUses,
    task,
  );
  if (bubble == null) return null;
  return (
    <div className="flex flex-col" style={{ gap: "10px" }}>
      {turnSeparator && (
        <hr
          className="my-2"
          style={{ borderTop: "1px solid var(--color-border, #e0dbd4)" }}
          data-testid="turn-separator"
        />
      )}
      {bubble}
    </div>
  );
}

function isTurnBoundary(prev: ParsedEvent | null, current: ParsedEvent): boolean {
  if (!prev) return false;
  if (prev.kind === current.kind) return false;
  const continuationKinds = new Set(["assistant", "user"]);
  if (prev.kind === "user" && current.kind === "assistant") return true;
  if (prev.kind === "assistant" && current.kind === "user" && continuationKinds.has("user")) {
    return false;
  }
  return false;
}

function renderBubble(
  event: ParsedEvent,
  resolved: Set<string>,
  toolResultsById: Map<string, { content: string; is_error: boolean }>,
  visibleToolUseIds: Set<string>,
  allToolUses: { id: string; name: string; input: unknown }[],
  task?: ExternalTask,
): ReactNode {
  if (event.kind === "user") {
    const results = toolResults(event);
    if (results.length > 0) {
      const isOnly = isOnlyToolResults(event);
      const allFolded = isOnly && results.every((r) => visibleToolUseIds.has(r.tool_use_id));
      if (allFolded) return null;
      return (
        <div className="flex justify-start" data-testid="bubble-tool-result">
          <div
            className="max-w-[90%] p-2"
            style={{
              background: "var(--color-surface, #ffffff)",
              border: "1px solid var(--color-border, #e0dbd4)",
              borderRadius: "var(--radius-button, 8px)",
              boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
            }}
          >
            <BubbleHeader role="tool_result" timestamp={event.timestamp} />
            {results.map((r) => (
              <AnsiText key={r.tool_use_id} text={r.content} isError={r.is_error} />
            ))}
          </div>
        </div>
      );
    }
    const t = userText(event);
    return (
      <div className="flex justify-end" data-testid="bubble-user">
        <div
          className="max-w-[80%] px-3 py-2 text-sm"
          style={{
            background: "var(--color-border, #e0dbd4)",
            color: "var(--color-text, #1a1a1a)",
            border: "none",
            borderRadius: "14px",
            borderTopRightRadius: "4px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <BubbleHeader role="user" timestamp={event.timestamp} />
          <div className="whitespace-pre-wrap break-words">
            {t || (
              <em style={{ color: "var(--color-muted, #6b7280)" }}>(empty user message)</em>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (event.kind === "assistant") {
    const text = assistantText(event);
    const tools = toolUses(event);
    const bubbleHasContent = hasVisibleBubbleContent(event);
    const thinkingOnly = isThinkingOnly(event);
    return (
      <div className="flex flex-col gap-1.5" data-testid="bubble-assistant">
        {bubbleHasContent && (
          <div className="flex justify-start">
            <div
              className="max-w-[90%] px-3 py-2 text-sm"
              style={{
                background: "var(--color-surface, #ffffff)",
                color: "var(--color-text, #1a1a1a)",
                border: "1px solid var(--color-border, #e0dbd4)",
                borderRadius: "14px",
                borderTopLeftRadius: "4px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              }}
            >
              <BubbleHeader role="claude" timestamp={event.timestamp} />
              {text && <MarkdownChunk content={text} />}
            </div>
          </div>
        )}
        {!bubbleHasContent && thinkingOnly && (
          <div className="flex justify-start" data-testid="thinking-card">
            <div
              className="max-w-[90%] px-3 py-2 text-[12px] italic"
              style={{
                color: "var(--color-muted, #6b7280)",
                background: "rgba(107,114,128,0.05)",
                border: "1px dashed var(--color-border, #e0dbd4)",
                borderRadius: "var(--radius-button, 8px)",
              }}
            >
              Thinking…
            </div>
          </div>
        )}
        {tools.map((tu) => (
          <div className="flex justify-start" key={tu.id}>
            <ToolOutputBlock
              toolUse={{ id: tu.id, name: tu.name, input: tu.input }}
              toolResult={toolResultsById.get(tu.id)}
              resolved={resolved}
              allToolUses={allToolUses}
              task={task}
            />
          </div>
        ))}
      </div>
    );
  }

  if (event.kind === "slash-command") return <SlashCommandChip commandName={event.commandName} />;
  if (event.kind === "task-notification") {
    return (
      <TaskNotificationChip
        status={event.status}
        summary={event.summary}
        taskId={event.taskId}
      />
    );
  }
  if (event.kind === "skill-body") return <SkillCard skillName={event.skillName} body={event.body} />;
  if (event.kind === "stop-hook") return <StopHookCard gateName={event.gateName} body={event.body} />;
  if (event.kind === "file-history-snapshot") {
    const names = fileSnapshotBasenames(event);
    if (names.length === 0) return null;
    const [first, ...rest] = names;
    return (
      <div className="flex justify-start" data-testid="bubble-file-snapshot">
        <AttachmentCard basename={first} extraCount={rest.length} />
      </div>
    );
  }
  if (event.kind === "attachment") {
    return (
      <div className="flex justify-start" data-testid="bubble-attachment">
        {renderAttachmentCard(event)}
      </div>
    );
  }
  if (event.kind === "system") return <SystemPill event={event} />;
  if (event.kind === "custom-title") return <CustomTitlePill event={event} />;
  if (event.kind === "agent-name") return <AgentNamePill event={event} />;
  if (event.kind === "permission-mode") return <PermissionModePill event={event} />;
  if (event.kind === "mode-change") return <ModeChangePill event={event} />;
  if (event.kind === "pr-link") return <PrLinkCard event={event} />;
  if (event.kind === "unknown") return <UnknownDetails event={event} />;
  return <FallbackChip event={event} />;
}
