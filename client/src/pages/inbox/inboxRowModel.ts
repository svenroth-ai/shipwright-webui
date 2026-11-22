/*
 * inboxRowModel — what one Inbox entry looks like as a compact row and as a
 * detail dialog (iterate-2026-11-22-w2-inbox-triage-look). Pure: one function
 * turns any InboxItem kind into the same small shape (chip, one-line title,
 * full text and how to render it), so the row and the dialog never switch on
 * the kind themselves. The text is untrusted and stays text: the row shows it
 * through React (escaped), the dialog renders markdown only for the kinds that
 * always did (text_question, lead_question), through the XSS-safe MarkdownText.
 */
import { extractAskUserPayload } from "../../lib/askUserPayload";
import type { InboxItemPart } from "../../types/inbox";
import type { InboxItem } from "../../lib/externalApi";
import { reminderRowModel, type ReminderFilter } from "./reminderModel";
import type { ProjectGroup } from "./types";

/** Buckets of the session entries (Claude questions, Codex notices). */
export type InboxEntryFilter = "awaiting" | "notices";

/** Filter-bar buckets. `all` is the "Open" chip; the others are exclusive. `reminders` / `parked` hold the due reminders and expired parked-triage entries (W3). */
export type InboxFilter = "all" | InboxEntryFilter | ReminderFilter;

export type InboxChipTone = "awaiting" | "notice" | "error";

export interface InboxRowModel {
  /** Filter-bar bucket this entry belongs to. */
  filter: InboxEntryFilter;
  chip: { label: string; tone: InboxChipTone };
  /** First line of the text, markdown marks removed - the row title. */
  title: string;
  /** Label above the full text in the dialog ("Claude asks"). */
  textLabel: string;
  /** The full text. */
  text: string;
  format: "markdown" | "mono" | "plain";
  /** Every readable part of an AskUserQuestion (the row title is the first); empty otherwise. */
  asks: InboxItemPart[];
  /** The honesty line applies: the answer is typed in the task's terminal. */
  answeredInTerminal: boolean;
}

const NOTICE_LABEL: Record<string, string> = {
  nudge_sent: "Nudge sent",
  delivery_error: "Delivery failed",
  no_oracle_unresolved: "Needs a status check",
  launch_confirmation_failed: "Launch may have failed",
};

/** First non-empty line, with the common markdown marks stripped. */
export function firstLine(text: string): string {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw
      .replace(/^\s*(?:#{1,6}\s+|>\s+|[-*+]\s+|\d+[.)]\s+)/, "")
      .replace(/(\*\*|__|`)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .trim();
    if (line) return line; // a line that strips to nothing (bare code fence) is skipped
  }
  return "";
}

const AWAITING = { label: "awaiting reply", tone: "awaiting" } as const;

export function inboxRowModel(item: InboxItem): InboxRowModel {
  switch (item.kind) {
    case "ask_tool": {
      const isAUQ = item.toolName === "AskUserQuestion";
      const asks = isAUQ ? extractAskUserPayload(item.input).parts.filter((p) => p.question.trim()) : [];
      const text = asks[0]
        ? asks[0].question
        : "Question payload schema differed from expected - open the task in your terminal to see the original.";
      return {
        filter: "awaiting",
        chip: AWAITING,
        title: firstLine(text) || "Claude asks",
        textLabel: "Claude asks",
        text,
        format: "plain",
        asks,
        answeredInTerminal: true,
      };
    }
    case "text_question":
      return textRow(item.questionText, "markdown");
    case "terminal_prompt":
    case "phase_gate":
    case "codex_approval":
      return textRow(item.promptText, "mono");
    case "lead_question":
      return {
        filter: "awaiting",
        chip: { label: "lead asks", tone: "awaiting" },
        title: firstLine(item.questionText) || "Lead asks",
        textLabel: "Lead asks",
        text: item.questionText,
        format: "markdown",
        asks: [],
        answeredInTerminal: false,
      };
    case "codex_watcher":
    case "codex_error": {
      const isError = item.kind === "codex_error" || item.noticeKind === "delivery_error";
      const text = item.kind === "codex_watcher" ? item.detail : item.errorText;
      const label = item.kind === "codex_watcher" ? (NOTICE_LABEL[item.noticeKind] ?? "Notice") : "Codex error";
      return {
        filter: "notices",
        chip: { label: isError ? "error" : "notice", tone: isError ? "error" : "notice" },
        title: firstLine(text) || label,
        textLabel: label,
        text,
        format: "plain",
        asks: [],
        answeredInTerminal: false,
      };
    }
    default:
      // Same exhaustiveness guard as inboxItemKey: a new kind is a type error here.
      return unhandledKind(item);
  }
}

function unhandledKind(item: never): never {
  throw new Error(`inboxRowModel: unhandled inbox item kind: ${(item as InboxItem).kind}`);
}

function textRow(text: string, format: "markdown" | "mono"): InboxRowModel {
  return {
    filter: "awaiting",
    chip: AWAITING,
    title: firstLine(text) || "Claude asks",
    textLabel: "Claude asks",
    text,
    format,
    asks: [],
    answeredInTerminal: true,
  };
}

/** Per-bucket counts across every group (the filter chips). */
export function countByFilter(groups: readonly ProjectGroup[]): Record<InboxFilter, number> {
  const c: Record<InboxFilter, number> = { all: 0, awaiting: 0, notices: 0, reminders: 0, parked: 0 };
  for (const g of groups) {
    for (const s of g.sessions) {
      for (const item of s.items) {
        c.all += 1;
        c[inboxRowModel(item).filter] += 1;
      }
    }
    for (const r of g.reminders ?? []) {
      c.all += 1;
      c[reminderRowModel(r).filter] += 1;
    }
  }
  return c;
}

/** Keep only the items of one bucket; empty sessions and groups disappear. */
export function filterGroups(groups: readonly ProjectGroup[], filter: InboxFilter): ProjectGroup[] {
  if (filter === "all") return [...groups];
  const out: ProjectGroup[] = [];
  for (const g of groups) {
    const sessions = g.sessions
      .map((s) => ({ ...s, items: s.items.filter((i) => inboxRowModel(i).filter === filter) }))
      .filter((s) => s.items.length > 0);
    const reminders = (g.reminders ?? []).filter((r) => reminderRowModel(r).filter === filter);
    if (sessions.length === 0 && reminders.length === 0) continue;
    out.push({
      ...g,
      sessions,
      reminders,
      totalItems: sessions.reduce((n, s) => n + s.items.length, 0) + reminders.length,
    });
  }
  return out;
}
