/*
 * external/inbox/_types.ts — the aggregator's output shape, shared by
 * `_derive.ts` (JSONL/terminal-derived kinds), `_lead.ts` (the written
 * `lead_question` kind), and `_codex.ts` (the `codex_watcher` kind — Codex
 * Light AC6 — plus `codex_approval`/`codex_error`, Codex Light §5.3/AC6).
 * Split out to keep `_derive.ts` under the 300-LOC guideline.
 * Discriminated union precedence: ask_tool > terminal_prompt >
 * text_question; `lead_question`, `codex_watcher`, `codex_approval` and
 * `codex_error` are independent of that precedence — each reflects a
 * different waiting state on the same task, not a JSONL read.
 */

import type { CodexWatcherNoticeKind } from "../../core/codex-task-watcher.js";

export type AggregatedEntry =
  | {
      kind: "ask_tool";
      taskId: string;
      sessionUuid: string;
      taskTitle: string;
      toolUseId: string;
      toolName: string;
      input: unknown;
      bestEffort: true;
    }
  | {
      kind: "text_question";
      taskId: string;
      sessionUuid: string;
      taskTitle: string;
      questionId: string;
      questionText: string;
      bestEffort: true;
    }
  | {
      kind: "terminal_prompt";
      taskId: string;
      sessionUuid: string;
      taskTitle: string;
      promptText: string;
      bestEffort: true;
    }
  | {
      kind: "lead_question";
      taskId: string;
      sessionUuid: string;
      taskTitle: string;
      questionText: string;
    }
  | {
      kind: "codex_watcher";
      taskId: string;
      sessionUuid: string;
      taskTitle: string;
      noticeKind: CodexWatcherNoticeKind;
      detail: string;
      bestEffort: true;
    }
  | {
      kind: "codex_approval";
      taskId: string;
      sessionUuid: string;
      taskTitle: string;
      promptText: string;
      bestEffort: true;
    }
  | {
      kind: "codex_error";
      taskId: string;
      sessionUuid: string;
      taskTitle: string;
      errorText: string;
      bestEffort: true;
    };
