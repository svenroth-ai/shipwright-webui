/*
 * InboxCard — one Inbox entry: a compact Triage-style row plus the detail dialog
 * it opens (C7 split 2026-05-26; compact rows + dialog
 * iterate-2026-11-22-w2-inbox-triage-look). The kind-specific work (chip, one-line
 * title, full text, how to render it) is `inboxRowModel`; this component only
 * wires the row, its open state and the dialog. The dialog is a SIBLING of the
 * row, not a child: a portaled dialog bubbles React events up the React tree and
 * the row's click would reopen it.
 */
import { useMemo, useState } from "react";

import type { ExternalTask, InboxItem } from "../../lib/externalApi";
import { InboxDetailDialog } from "./InboxDetailDialog";
import { InboxRow } from "./InboxRow";
import { inboxRowModel } from "./inboxRowModel";

/** Stable React key / testid base for an inbox item, kind-aware. */
export function inboxItemKey(item: InboxItem): string {
  switch (item.kind) {
    case "ask_tool":
      return item.toolUseId;
    case "terminal_prompt":
      return `tp-${item.taskId}`;
    case "text_question":
      return item.questionId;
    case "phase_gate":
      return `pg-${item.taskId}`;
    case "lead_question":
      return `lq-${item.taskId}`;
    case "codex_watcher":
      return `cw-${item.taskId}`;
    case "codex_approval":
      return `ca-${item.taskId}`;
    case "codex_error":
      return `ce-${item.taskId}`;
    default:
      // Exhaustiveness guard (FR-04.19 trap 3/4) — a kind added to `InboxItem`
      // without a case here is a TYPE error at this line, not a silent `undefined` key.
      return unhandledInboxItemKind(item);
  }
}

export function unhandledInboxItemKind(item: never): never {
  throw new Error(
    `inboxItemKey: unhandled inbox item kind: ${(item as InboxItem).kind}`,
  );
}

export function InboxCard({
  item,
  task,
}: {
  item: InboxItem;
  task: ExternalTask | undefined;
}) {
  const [open, setOpen] = useState(false);
  // Both throw on an unknown kind (never a silent wrong render).
  const itemKey = inboxItemKey(item);
  const model = useMemo(() => inboxRowModel(item), [item]);

  return (
    <>
      <InboxRow
        itemKey={itemKey}
        sessionUuid={item.sessionUuid}
        model={model}
        task={task}
        onOpen={() => setOpen(true)}
      />
      {item.kind === "ask_tool" && (
        <span data-testid={`inbox-item-${item.toolUseId}`} style={{ display: "none" }} aria-hidden="true" />
      )}
      {open && (
        <InboxDetailDialog
          open={open}
          onOpenChange={setOpen}
          item={item}
          itemKey={itemKey}
          model={model}
          task={task}
        />
      )}
    </>
  );
}

// Re-exported for existing importers; the copy lives in the leaf module.
export { INBOX_TERMINAL_HONESTY, InboxTerminalHonesty } from "./InboxHonesty";
