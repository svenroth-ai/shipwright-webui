/*
 * BubbleTranscript coverage migrated from retired E2E specs: incremental
 * lifecycle transitions, scale, and multi-surface integration.
 *
 * iterate-2026-08-13-mission-mobile-visual: the Transcript sub-tab that used
 * to host BubbleTranscript in TaskDetailPage was retired, so the E2E cohort
 * that drove it through a live page migrates here (content strings copied
 * verbatim from the retired specs' fixtures so assertions stay provably
 * equivalent). The content-growth / rendering / parser / toggle migrations
 * (specs 32, 37a, 59, 60) live in the sibling BubbleTranscript.migrated-e2e.test.tsx
 * — split by theme, not arbitrarily, to keep each file under its bloat limit.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BubbleTranscript } from "./BubbleTranscript";

// pr-link rows call usePrStatus (React Query) — mocked so this file needs no
// QueryClientProvider, same pattern as TranscriptRow.test.tsx.
vi.mock("../../hooks/usePrStatus", () => ({ usePrStatus: () => ({ data: undefined }) }));

function jsonl(events: object[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

// Migrated from e2e/flows/37b-bubble-lifecycle.spec.ts. The static
// pending/resolved and fold/no-fold shapes already have coverage in
// BubbleTranscript.test.tsx ("bubble layout fixtures" + "AC-1 tool_result
// folding into ToolCard"). What that coverage does NOT exercise is the
// INCREMENTAL path — a tool_result arriving in a later poll and the SAME
// mounted tree flipping state via `rerender`, which is what a live pane
// actually does (the E2E spec drove it with `appendFileSync` + a poll; here
// `rerender` is the component-level equivalent).
describe("BubbleTranscript — AskUserQuestion incremental resolution via append (spec 37b migration)", () => {
  it("flips pending to resolved when a matching tool_result arrives in a later poll (rerender)", () => {
    const askEvent = jsonl([
      {
        type: "assistant",
        sessionId: "s",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu_pending_q",
              name: "AskUserQuestion",
              input: { parts: [{ question: "Pick a stack?", options: ["Supabase", "Firebase"] }] },
            },
          ],
        },
      },
    ]);
    const { rerender } = render(<BubbleTranscript content={askEvent} />);
    const pending = screen.getByTestId("askuser-pending");
    expect(pending.textContent).toContain("Pick a stack?");
    expect(pending.textContent).toContain("Supabase");
    expect(pending.textContent).toContain("Firebase");
    expect(pending.dataset.toolUseId).toBe("tu_pending_q");

    const grown =
      askEvent +
      JSON.stringify({
        type: "user",
        sessionId: "s",
        message: {
          content: [{ type: "tool_result", tool_use_id: "tu_pending_q", content: "Supabase" }],
        },
      }) +
      "\n";
    rerender(<BubbleTranscript content={grown} />);
    expect(screen.getByTestId("askuser-resolved")).toBeInTheDocument();
    expect(screen.queryByTestId("askuser-pending")).toBeNull();
  });

  it("folds a resolved tool_result into its tool_use card (ADR-065), never a sibling bubble", () => {
    // Exact fixture from the retired spec: text + tool_use, then the
    // matching tool_result in the next event.
    const content = jsonl([
      {
        type: "assistant",
        sessionId: "s",
        message: {
          content: [
            { type: "text", text: "Running Bash" },
            { type: "tool_use", id: "tu_bash", name: "Bash", input: { command: "ls" } },
          ],
        },
      },
      {
        type: "user",
        sessionId: "s",
        message: {
          content: [{ type: "tool_result", tool_use_id: "tu_bash", content: "file.ts\nREADME.md" }],
        },
      },
    ]);
    render(<BubbleTranscript content={content} />);
    const assistant = screen.getByTestId("bubble-assistant");
    expect(assistant).toBeInTheDocument();
    const tu = screen.getByTestId("bubble-tool-use");
    expect(tu).toBeInTheDocument();
    expect(assistant.querySelector("[data-testid='bubble-tool-use']")).not.toBeNull();
    expect(screen.queryByTestId("bubble-tool-result")).toBeNull();
  });
});

// Migrated (functional slice only) from e2e/flows/37c-perf-1000-events.spec.ts.
// The wall-clock FCP/IR budgets that spec measured have NO component-level
// equivalent — jsdom does no real paint, and the page it measured (the
// Transcript tab) no longer exists to host the measurement anyway. What
// survives here is the STRUCTURAL behaviour the perf spec also asserted: at
// 1000 events the virtualizer activates and "Load older" works.
describe("BubbleTranscript — 1000-event scale (spec 37c functional migration)", () => {
  it("virtualizes at 1000 events and Load older reveals the rest", async () => {
    const events: object[] = [];
    for (let i = 0; i < 500; i++) {
      events.push({ type: "user", sessionId: "s", message: { content: `user message ${i}` } });
      events.push({
        type: "assistant",
        sessionId: "s",
        message: { content: [{ type: "text", text: `**assistant** reply ${i}` }] },
      });
    }
    render(<BubbleTranscript content={jsonl(events)} />);

    expect(screen.getByTestId("bubble-list-virtual")).toBeInTheDocument();
    expect(screen.queryByTestId("bubble-list-plain")).toBeNull();
    expect(screen.getByTestId("transcript-event-count").textContent).toMatch(/200 of 1000/);

    const loadOlder = screen.getByTestId("load-older-btn");
    await userEvent.click(loadOlder);
    expect(screen.getByTestId("transcript-event-count").textContent).toMatch(/400 of 1000/);
  });
});

// Migrated from e2e/flows/90-transcript-renderer-fingerprints.spec.ts. Each
// surface (mode pill, pr-link card, stop-hook card) has dedicated coverage
// in TranscriptRow.test.tsx / PrLinkCard.test.tsx / StopHookCard.test.tsx;
// this test's job is the INTEGRATION claim the retired spec's name promised
// — all three composed in the SAME transcript, through the full
// BubbleTranscript pipeline, with no bubble-unknown anywhere.
describe("BubbleTranscript — renderer fingerprints integration (spec 90 migration)", () => {
  const STOP_HOOK_BODY = [
    "Stop hook feedback:",
    "================================================================",
    "  SHIPWRIGHT BLOAT GATE — Stop blocked",
    "================================================================",
    "",
    "The IRON LAW",
    "",
    "    NO COMPLETION WHILE FILES ARE GROWING UNCHECKED",
  ].join("\n");

  it("renders mode / pr-link / stop-hook surfaces together, never bubble-unknown", async () => {
    const content = jsonl([
      { type: "mode", sessionId: "s", mode: "normal" },
      {
        type: "pr-link",
        sessionId: "s",
        prNumber: 78,
        prUrl: "https://github.com/svenroth-ai/shipwright-webui/pull/78",
        prRepository: "svenroth-ai/shipwright-webui",
      },
      { type: "user", sessionId: "s", message: { content: STOP_HOOK_BODY } },
      { type: "user", sessionId: "s", message: { content: "Thanks, looks good!" } },
    ]);
    render(<BubbleTranscript content={content} />);

    const prCard = screen.getByTestId("pr-link-card");
    expect(prCard.textContent).toContain("svenroth-ai/shipwright-webui");
    expect(prCard.textContent).toContain("#78");
    const anchor = screen.getByTestId("pr-link-anchor");
    expect(anchor.getAttribute("href")).toBe(
      "https://github.com/svenroth-ai/shipwright-webui/pull/78",
    );
    expect(anchor.getAttribute("target")).toBe("_blank");

    const stopCard = screen.getByTestId("stop-hook-card");
    expect(stopCard).toBeInTheDocument();
    expect(screen.getByTestId("stop-hook-card-gate").textContent).toContain(
      "SHIPWRIGHT BLOAT GATE",
    );
    expect(screen.queryByTestId("stop-hook-card-body")).toBeNull();
    await userEvent.click(screen.getByTestId("stop-hook-card-header"));
    expect(screen.getByTestId("stop-hook-card-body").textContent).toContain(
      "NO COMPLETION WHILE FILES ARE GROWING UNCHECKED",
    );

    expect(screen.getByTestId("bubble-user").textContent).toContain("Thanks, looks good!");

    // mode-change is a SYSTEM_KIND — hidden by default, no unknown fallback.
    expect(screen.queryByTestId("bubble-mode-change")).toBeNull();
    expect(screen.queryByTestId("bubble-unknown")).toBeNull();

    await userEvent.click(screen.getByTestId("system-toggle"));
    expect(screen.getByTestId("bubble-mode-change").textContent).toContain("normal");
    expect(screen.queryByTestId("bubble-unknown")).toBeNull();
  });
});
