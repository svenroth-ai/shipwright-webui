/*
 * BubbleTranscript coverage migrated from retired E2E specs.
 *
 * iterate-2026-08-13-mission-mobile-visual: the Transcript sub-tab that used
 * to host BubbleTranscript in TaskDetailPage was retired, so the E2E cohort
 * that drove it through a live page (specs 32, 37a, 37b, 37c, 59, 60, 90)
 * migrates here. Content strings below are copied verbatim from the retired
 * specs' fixtures so the assertions stay provably equivalent, not just
 * superficially similar. Split out of BubbleTranscript.test.tsx (same iterate)
 * to keep that file under its bloat baseline — see BubbleTranscript.test.tsx
 * for the primary layout/pagination/virtualization coverage this file
 * complements.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BubbleTranscript } from "./BubbleTranscript";

// pr-link rows call usePrStatus (React Query) — mocked so this file needs no
// QueryClientProvider, same pattern as TranscriptRow.test.tsx.
vi.mock("../../hooks/usePrStatus", () => ({ usePrStatus: () => ({ data: undefined }) }));

const SYSTEM_VISIBILITY_KEY = "webui.transcript.showSystem";

function jsonl(events: object[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

// Migrated from e2e/flows/32-transcript-live.spec.ts. The live-polling
// mechanism itself (1s cadence, real HTTP) has no component-level home — it
// stays covered by src/hooks/useTaskTranscript.*.test.ts. What IS a
// BubbleTranscript concern is proven here: as `content` grows (what every
// poll tick does to the prop), previously-rendered bubbles survive and the
// newly-appended event renders alongside them.
describe("BubbleTranscript — live content growth (spec 32 migration)", () => {
  it("renders user + assistant from seeded content, then keeps both after an appended line grows `content`", () => {
    const seed = jsonl([
      { type: "user", sessionId: "s", message: { content: "hello from e2e" } },
      {
        type: "assistant",
        sessionId: "s",
        message: { content: [{ type: "text", text: "hi back" }] },
      },
    ]);
    const { rerender } = render(<BubbleTranscript content={seed} />);
    expect(screen.getByTestId("bubble-user").textContent).toContain("hello from e2e");
    expect(screen.getByTestId("bubble-assistant").textContent).toContain("hi back");

    // A poll tick never truncates — it only ever appends. Simulate that by
    // re-rendering with MORE content, the same shape `useTaskTranscript`
    // hands the component every second.
    const grown =
      seed +
      JSON.stringify({
        type: "assistant",
        sessionId: "s",
        message: { content: [{ type: "text", text: "second response" }] },
      }) +
      "\n";
    rerender(<BubbleTranscript content={grown} />);
    expect(screen.getByText("second response")).toBeInTheDocument();
    // The earlier bubbles are still there — growth is additive, not a reset.
    expect(screen.getByTestId("bubble-user").textContent).toContain("hello from e2e");
    expect(screen.getByText("hi back")).toBeInTheDocument();
  });
});

// Migrated from e2e/flows/37a-markdown-rendering.spec.ts. Each individual
// primitive (bold/italic/fenced-code/GFM/ZWS-wrap in MarkdownText.test.tsx;
// ANSI-stripping in AnsiText.test.tsx; the unknown-event fallback shape in
// TranscriptRow.test.tsx) already has dedicated component coverage — this
// test's job is the one thing those don't cover: that all of it survives
// together, through the FULL BubbleTranscript pipeline, in one transcript,
// without a malformed line anywhere in the middle taking the rest down with
// it. It also exercises the one JSON.parse-failure path (a truly non-JSON
// line, not just an unrecognized `type`) that no other test hits.
describe("BubbleTranscript — heterogeneous rendering integration (spec 37a migration)", () => {
  it("renders markdown + fenced code + a malformed middle line + ANSI tool_result + a long line, all together", () => {
    const markdownAssistant =
      "## Heading\n\n" +
      "Some **bold** and *italic* text with a `code span`.\n\n" +
      "```ts\nconst pi = 3.14;\n```\n";
    const ansiToolResult = "[31mRED ERROR[0m\nplain second line";
    const longLine = "y".repeat(5000);

    const lines = [
      JSON.stringify({
        type: "assistant",
        sessionId: "s",
        message: { content: [{ type: "text", text: markdownAssistant }] },
      }),
      // A genuinely non-JSON middle line — JSON.parse throws, not just an
      // unrecognized `type` field (that path is TranscriptRow.test.tsx's
      // "this_kind_does_not_exist" case; this is the other one).
      "this-is-not-json-and-should-become-an-unknown-event",
      JSON.stringify({
        type: "user",
        sessionId: "s",
        message: {
          content: [{ type: "tool_result", tool_use_id: "tu_x", content: ansiToolResult }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "s",
        message: { content: [{ type: "text", text: longLine }] },
      }),
    ];
    const content = lines.join("\n") + "\n";

    const { container } = render(<BubbleTranscript content={content} />);

    // Markdown body: heading, bold, italic, fenced code.
    expect(container.querySelector("h2")?.textContent).toBe("Heading");
    expect(screen.getAllByTestId("markdown-body")[0]).toBeInTheDocument();
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
    expect(screen.getByTestId("fenced-code").textContent).toContain("const pi = 3.14;");

    // Malformed middle line surfaces as an unknown stub, not a silent drop
    // and not a thrown render error (a crash would have made `render` above
    // throw synchronously — there is no error boundary in this tree).
    expect(screen.getByTestId("bubble-unknown")).toBeInTheDocument();

    // Orphan tool_result renders ANSI-stripped.
    const toolBlock = screen.getByTestId("bubble-tool-result");
    expect(toolBlock.textContent).toContain("RED ERROR");
    expect(toolBlock.textContent).not.toMatch(/\[/);

    // Long line: content survives and gets zero-width-space wrap points
    // (MarkdownText.capLineLengths) instead of blowing out the layout.
    expect(container.textContent).toContain("yyyyy");
    expect(container.textContent).toContain("​");
  });
});

// Migrated from e2e/flows/37b-bubble-lifecycle.spec.ts. The static
// pending/resolved and fold/no-fold shapes already have coverage above
// ("bubble layout fixtures" + "AC-1 tool_result folding into ToolCard").
// What that coverage does NOT exercise is the INCREMENTAL path — a
// tool_result arriving in a later poll and the SAME mounted tree flipping
// state via `rerender`, which is what a live pane actually does (the E2E
// spec drove it with `appendFileSync` + a poll; here `rerender` is the
// component-level equivalent).
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
// Transcript tab) no longer exists to host the measurement anyway. That
// timing coverage is genuinely lost; see the deletion note in the spec's
// commit. What survives here is the STRUCTURAL behaviour the perf spec also
// asserted: at 1000 events the virtualizer activates and "Load older" works.
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

// Migrated from e2e/flows/59-parser-variants.spec.ts. custom-title /
// agent-name / permission-mode chips already have dedicated coverage above
// ("iterate-3 chip variants"); the piece that section doesn't cover is the
// regression this spec pinned — an INVENTED future event type falling
// through to the unknown card instead of crashing the parser.
describe("BubbleTranscript — parser variants + unknown fallback (spec 59 migration)", () => {
  beforeEach(() => {
    window.localStorage.setItem(SYSTEM_VISIBILITY_KEY, "true");
  });
  afterEach(() => {
    window.localStorage.removeItem(SYSTEM_VISIBILITY_KEY);
  });

  it("renders custom-title / agent-name / permission-mode as chips AND an invented type as bubble-unknown", () => {
    const content = jsonl([
      { type: "custom-title", sessionId: "s", customTitle: "Implement user auth" },
      { type: "agent-name", sessionId: "s", agentName: "Claude Sonnet 4.6" },
      { type: "permission-mode", sessionId: "s", permissionMode: "acceptEdits" },
      { type: "plugin-hook-v2", sessionId: "s", whatever: { foo: "bar" } },
    ]);
    render(<BubbleTranscript content={content} />);

    const titleChip = screen.getByTestId("bubble-custom-title");
    expect(titleChip.textContent).toContain("Implement user auth");
    const agentChip = screen.getByTestId("bubble-agent-name");
    expect(agentChip.textContent).toContain("Claude Sonnet 4.6");
    const permChip = screen.getByTestId("bubble-permission-mode");
    expect(permChip.textContent).toContain("acceptEdits");

    // An invented type still falls through to the unknown card — the parser
    // must never crash on a future/unrecognized event type.
    const unknown = screen.getByTestId("bubble-unknown");
    expect(unknown.textContent).toContain("plugin-hook-v2");
  });
});

// Migrated from e2e/flows/60-system-toggle.spec.ts. The "system visibility
// toggle" describe block above already proves default-hidden, toggle-reveal,
// localStorage flip, and unmount/remount persistence (the component-level
// equivalent of a page reload) with smaller fixtures. This test reuses the
// spec's EXACT fixture (3 system lines + 1 user line) so the count assertion
// is provably the same, not just structurally similar.
describe("BubbleTranscript — system toggle exact-fixture parity (spec 60 migration)", () => {
  beforeEach(() => {
    window.localStorage.removeItem(SYSTEM_VISIBILITY_KEY);
  });
  afterEach(() => {
    window.localStorage.removeItem(SYSTEM_VISIBILITY_KEY);
  });

  it("hides 3 system events by default, toggle reveals exactly 3, state survives a fresh mount", async () => {
    const content = jsonl([
      { type: "system", sessionId: "s", subtype: "init", content: "cwd=/tmp session=abc" },
      {
        type: "system",
        sessionId: "s",
        subtype: "local_command",
        content: "<local-command-stdout>ok</local-command-stdout>",
      },
      { type: "user", sessionId: "s", message: { content: "hi" } },
      { type: "system", sessionId: "s", subtype: "informational", content: "background note" },
    ]);
    const first = render(<BubbleTranscript content={content} />);
    expect(screen.getByTestId("bubble-user")).toBeInTheDocument();
    expect(screen.queryByTestId("bubble-system")).toBeNull();

    await userEvent.click(screen.getByTestId("system-toggle"));
    expect(screen.getAllByTestId("bubble-system")).toHaveLength(3);
    expect(window.localStorage.getItem(SYSTEM_VISIBILITY_KEY)).toBe("true");

    // Fresh mount (the component-level equivalent of `page.reload()`) reads
    // localStorage and shows the same 3 system bubbles.
    first.unmount();
    render(<BubbleTranscript content={content} />);
    expect(screen.getAllByTestId("bubble-system")).toHaveLength(3);
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
