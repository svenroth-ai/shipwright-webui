/*
 * TranscriptRow — Campaign-C C3 BubbleTranscript split (2026-05-26).
 *
 * Public surface contract (spec mandates `{ entry: TranscriptEntry; isLatest: boolean }`):
 *   - Renders one transcript row for any ParsedEvent kind.
 *   - User → right-aligned `bubble-user`, plain whitespace text.
 *   - Assistant → left-aligned `bubble-assistant`, markdown rendered.
 *   - Slash-command → centered chip.
 *   - Attachment → left chip card via AttachmentCard.
 *   - System → left muted pill.
 *   - Unknown → warning <details> disclosure.
 *   - Previous-event-sensitive: turn-boundary <hr> between user→assistant.
 */

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

import { TranscriptRow } from "./TranscriptRow";
import { parseSessionJsonl, type ParsedEvent } from "../../../external/session-parser";

// Mock usePrStatus (React Query) so `pr-link` rows render without a provider;
// the open/merged badge is covered by PrLinkCard.test.tsx + the F0.5 E2E.
vi.mock("../../../hooks/usePrStatus", () => ({ usePrStatus: () => ({ data: undefined }) }));

const EMPTY_RESOLVED = new Set<string>();
const EMPTY_MAP = new Map<string, { content: string; is_error: boolean }>();
const EMPTY_VIS = new Set<string>();
const EMPTY_TOOLS: { id: string; name: string; input: unknown }[] = [];

function parseFirst(events: object[]): ParsedEvent {
  const jsonl = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  const out = parseSessionJsonl(jsonl);
  return out.events[0];
}

function parseAll(events: object[]): ParsedEvent[] {
  const jsonl = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  return parseSessionJsonl(jsonl).events;
}

describe("TranscriptRow", () => {
  it("renders a user event as a right-aligned bubble with raw text", () => {
    const entry = parseFirst([
      { type: "user", message: { content: "hi from user" } },
    ]);
    const { container } = render(
      <TranscriptRow
        entry={entry}
        isLatest={false}
        previous={null}
        resolved={EMPTY_RESOLVED}
        toolResultsById={EMPTY_MAP}
        visibleToolUseIds={EMPTY_VIS}
        allToolUses={EMPTY_TOOLS}
      />,
    );
    const bubble = container.querySelector("[data-testid='bubble-user']");
    expect(bubble).not.toBeNull();
    expect(bubble!.textContent).toContain("hi from user");
    expect(bubble!.className).toMatch(/justify-end/);
  });

  it("renders an assistant event as a left-aligned bubble with markdown", () => {
    const entry = parseFirst([
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "Hello **world**" }] },
      },
    ]);
    const { container } = render(
      <TranscriptRow
        entry={entry}
        isLatest={false}
        previous={null}
        resolved={EMPTY_RESOLVED}
        toolResultsById={EMPTY_MAP}
        visibleToolUseIds={EMPTY_VIS}
        allToolUses={EMPTY_TOOLS}
      />,
    );
    const bubble = container.querySelector("[data-testid='bubble-assistant']");
    expect(bubble).not.toBeNull();
    // Markdown rendering — **world** becomes a <strong>.
    expect(bubble!.querySelector("strong")?.textContent).toBe("world");
  });

  it("renders a slash-command event as a chip", () => {
    const entry = parseFirst([
      { type: "user", message: { content: "<command-name>/help</command-name>" } },
    ]);
    const { container } = render(
      <TranscriptRow
        entry={entry}
        isLatest={false}
        previous={null}
        resolved={EMPTY_RESOLVED}
        toolResultsById={EMPTY_MAP}
        visibleToolUseIds={EMPTY_VIS}
        allToolUses={EMPTY_TOOLS}
      />,
    );
    // slash-command renders via SlashCommandChip — a chip with the command name.
    expect(container.textContent).toContain("/help");
  });

  it("renders an unknown event as a warning <details>", () => {
    const entry = parseFirst([{ type: "this_kind_does_not_exist", foo: "bar" }]);
    const { container } = render(
      <TranscriptRow
        entry={entry}
        isLatest={false}
        previous={null}
        resolved={EMPTY_RESOLVED}
        toolResultsById={EMPTY_MAP}
        visibleToolUseIds={EMPTY_VIS}
        allToolUses={EMPTY_TOOLS}
      />,
    );
    const bubble = container.querySelector("[data-testid='bubble-unknown']");
    expect(bubble).not.toBeNull();
    expect(bubble!.querySelector("details")).not.toBeNull();
  });

  it("renders a mode-change event as a mode pill (AC1)", () => {
    const entry = parseFirst([
      { type: "mode", sessionId: "s", mode: "normal" },
    ]);
    const { container } = render(
      <TranscriptRow
        entry={entry}
        isLatest={false}
        previous={null}
        resolved={EMPTY_RESOLVED}
        toolResultsById={EMPTY_MAP}
        visibleToolUseIds={EMPTY_VIS}
        allToolUses={EMPTY_TOOLS}
      />,
    );
    const bubble = container.querySelector("[data-testid='bubble-mode-change']");
    expect(bubble).not.toBeNull();
    expect(bubble!.textContent).toContain("Mode:");
    expect(bubble!.textContent).toContain("normal");
    // Must NOT render as the legacy yellow unknown card.
    expect(container.querySelector("[data-testid='bubble-unknown']")).toBeNull();
  });

  it("renders a pr-link event as a clickable anchor card (AC2)", () => {
    const entry = parseFirst([
      {
        type: "pr-link",
        sessionId: "s",
        prNumber: 78,
        prUrl: "https://github.com/svenroth-ai/shipwright-webui/pull/78",
        prRepository: "svenroth-ai/shipwright-webui",
      },
    ]);
    const { container } = render(
      <TranscriptRow
        entry={entry}
        isLatest={false}
        previous={null}
        resolved={EMPTY_RESOLVED}
        toolResultsById={EMPTY_MAP}
        visibleToolUseIds={EMPTY_VIS}
        allToolUses={EMPTY_TOOLS}
      />,
    );
    const anchor = container.querySelector("a[data-testid='pr-link-anchor']");
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute("href")).toMatch(/pull\/78$/);
    expect(container.querySelector("[data-testid='bubble-unknown']")).toBeNull();
  });

  it("falls back to bubble-unknown when pr-link payload has a javascript: scheme (AC2 XSS guard)", () => {
    const entry = parseFirst([
      {
        type: "pr-link",
        sessionId: "s",
        prNumber: 78,
        prUrl: "javascript:alert(1)",
        prRepository: "svenroth-ai/shipwright-webui",
      },
    ]);
    const { container } = render(
      <TranscriptRow
        entry={entry}
        isLatest={false}
        previous={null}
        resolved={EMPTY_RESOLVED}
        toolResultsById={EMPTY_MAP}
        visibleToolUseIds={EMPTY_VIS}
        allToolUses={EMPTY_TOOLS}
      />,
    );
    expect(container.querySelector("[data-testid='pr-link-card']")).toBeNull();
    expect(container.querySelector("[data-testid='bubble-unknown']")).not.toBeNull();
  });

  it("renders a stop-hook user event as a collapsed card, not a user bubble (AC3)", () => {
    const banner = [
      "Stop hook feedback:",
      "================================================================",
      "  SHIPWRIGHT BLOAT GATE — Stop blocked",
      "================================================================",
      "",
      "    NO COMPLETION WHILE FILES ARE GROWING UNCHECKED",
    ].join("\n");
    const entry = parseFirst([
      { type: "user", sessionId: "s", message: { content: banner } },
    ]);
    const { container } = render(
      <TranscriptRow
        entry={entry}
        isLatest={false}
        previous={null}
        resolved={EMPTY_RESOLVED}
        toolResultsById={EMPTY_MAP}
        visibleToolUseIds={EMPTY_VIS}
        allToolUses={EMPTY_TOOLS}
      />,
    );
    expect(container.querySelector("[data-testid='stop-hook-card']")).not.toBeNull();
    // Must NOT render as a right-aligned user bubble.
    expect(container.querySelector("[data-testid='bubble-user']")).toBeNull();
  });

  it("renders a system event as a left muted pill", () => {
    const entry = parseFirst([
      { type: "system", subtype: "session_start", text: "Session opened" },
    ]);
    const { container } = render(
      <TranscriptRow
        entry={entry}
        isLatest={false}
        previous={null}
        resolved={EMPTY_RESOLVED}
        toolResultsById={EMPTY_MAP}
        visibleToolUseIds={EMPTY_VIS}
        allToolUses={EMPTY_TOOLS}
      />,
    );
    const bubble = container.querySelector("[data-testid='bubble-system']");
    expect(bubble).not.toBeNull();
    expect(bubble!.textContent).toContain("session_start");
  });

  it("inserts a turn-boundary <hr> on user→assistant transition", () => {
    const events = parseAll([
      { type: "user", message: { content: "hi" } },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "hello" }] },
      },
    ]);
    const { container } = render(
      <TranscriptRow
        entry={events[1]}
        isLatest
        previous={events[0]}
        resolved={EMPTY_RESOLVED}
        toolResultsById={EMPTY_MAP}
        visibleToolUseIds={EMPTY_VIS}
        allToolUses={EMPTY_TOOLS}
      />,
    );
    const sep = container.querySelector("[data-testid='turn-separator']");
    expect(sep).not.toBeNull();
  });

  it("returns null for a folded tool_result-only user event whose ids are all visible", () => {
    // tool_result wrapped in a user event; the visibleToolUseIds set marks
    // tu_1 as already rendered upstream → the user bubble must NOT render.
    const entry = parseFirst([
      {
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "tu_1", content: "ok" },
          ],
        },
      },
    ]);
    const { container } = render(
      <TranscriptRow
        entry={entry}
        isLatest={false}
        previous={null}
        resolved={EMPTY_RESOLVED}
        toolResultsById={EMPTY_MAP}
        visibleToolUseIds={new Set(["tu_1"])}
        allToolUses={EMPTY_TOOLS}
      />,
    );
    // No bubble at all — the row collapses.
    expect(container.querySelector("[data-testid='bubble-tool-result']")).toBeNull();
    expect(container.querySelector("[data-testid='bubble-user']")).toBeNull();
  });
});
