/*
 * agentTranscriptFeed - a subagent's JSONL tail as the SAME feed cards the Mission chat renders (V3).
 * parseSessionJsonl + deriveActivityFeed (no run context) do the work; this file only decides what a
 * subagent view shows differently from the chat: the first user record is the PROMPT from the session
 * (a card, never a human bubble), system notes are dropped, and the view is windowed (latest N events,
 * "Load older" widens it). Pure, read-only.
 */

import { assistantText, parseSessionJsonl, isOnlyToolResults, type ParsedEvent } from "../external/session-parser";
import { deriveActivityFeed } from "./missionActivityFeed";
import type { ActivityCard } from "./missionActivityFeedTypes";

export const AGENT_FEED_PAGE = 200;

export type AgentFeedRole = "prompt" | "message" | "card";
export interface AgentFeedItem { card: ActivityCard; role: AgentFeedRole }
export interface AgentFeed { items: AgentFeedItem[]; total: number; shown: number }

/** Events that read as a message in the chat (not tool results, bookkeeping or unknown kinds). */
const isMessageEvent = (e: ParsedEvent) =>
  e.kind === "assistant" || e.kind === "handback" || (e.kind === "user" && !isOnlyToolResults(e));

export function buildAgentFeed(content: string, opts: { limit: number; truncated: boolean }): AgentFeed {
  const events = content ? parseSessionJsonl(content).events : [];
  const messageIdx: number[] = [];
  events.forEach((e, i) => { if (isMessageEvent(e)) messageIdx.push(i); });
  const total = messageIdx.length;
  const cutAt = total > opts.limit ? messageIdx[total - opts.limit] : 0;
  const windowed = cutAt > 0 ? events.slice(cutAt) : events;
  const feed = deriveActivityFeed(windowed, null);
  const cards = chronological(feed.cards);
  // The prompt is only knowable when the file's start is in view: not cut by the server, not by the window.
  let promptAvailable = cutAt === 0 && !opts.truncated;
  const items: AgentFeedItem[] = [];
  for (const card of cards) {
    if (card.kind === "system") continue; // compaction notes and the like: not part of the conversation
    if (card.kind === "user") {
      items.push({ card, role: promptAvailable ? "prompt" : "message" });
      promptAvailable = false;
    } else {
      items.push({ card, role: "card" });
    }
  }
  return { items, total, shown: Math.min(total, opts.limit) };
}

/**
 * The reducer flushes a trailing narration-only turn AFTER every other card, which in a chat that ends there is
 * fine but here would sort it behind a later hand-back / user record. Put that last card back where its own
 * timestamp says it belongs (only ever the final card moves; everything else keeps the reducer's order).
 */
function chronological(cards: ActivityCard[]): ActivityCard[] {
  const last = cards.at(-1);
  if (!last || last.kind !== "note" || !last.timestamp) return cards;
  const rest = cards.slice(0, -1);
  let at = rest.length;
  while (at > 0 && rest[at - 1].timestamp && rest[at - 1].timestamp! > last.timestamp) at--;
  return at === rest.length ? cards : [...rest.slice(0, at), last, ...rest.slice(at)];
}

/** The agent's last assistant message (its answer), or null when the tail holds none. */
export function lastAssistantMessage(content: string): string | null {
  if (!content) return null;
  const events = parseSessionJsonl(content).events;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind !== "assistant") continue;
    const text = assistantText(e).trim();
    if (text) return text;
  }
  return null;
}
