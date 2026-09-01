/*
 * external/inbox/_types.ts — the aggregator's output shape, shared by
 * `_derive.ts` (JSONL/terminal-derived kinds) and `_lead.ts` (the written
 * `lead_question` kind). Split out to keep `_derive.ts` under the 300-LOC
 * guideline. Discriminated union precedence: ask_tool > terminal_prompt >
 * text_question; `lead_question` is independent of that precedence — it
 * reflects a different waiting state on the same task, not a JSONL read.
 */

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
    };
