import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MissionActivityFeed } from "./MissionActivityFeed";
import type { ActivityFeed } from "../../../lib/missionActivityFeed";
import { deriveActivityFeed } from "../../../lib/missionActivityFeed";
import { fixtureContext, longIterateFixture } from "../../../lib/missionActivityFeed.fixtures";
import type { CommitArtifact } from "../../../lib/missionContextApi";
import type { ExternalTask } from "../../../lib/externalApi";

const mutateAsync = vi.fn().mockResolvedValue({ commands: { posix: "claude --resume x", powershell: "claude --resume x" } });
vi.mock("../../../hooks/useLaunchTask", () => ({
  useLaunchTask: () => ({ mutateAsync, isPending: false }),
}));

const TASK = { taskId: "task-mission-feed", projectId: "p1" } as unknown as ExternalTask;

const COMMIT_ARTIFACT: CommitArtifact = {
  kind: "commit", label: "Delivery", state: "available", summary: null, receipt: null,
  detail: { type: "commit", commit: "abc123", message: 'fix(mission): real content in every card kind', prNumber: 367, prUrl: "https://github.com/x/y/pull/367", merge: "merged" },
};

const renderedLongIterateFixture: ActivityFeed = {
  outcome: "In progress",
  cards: Array.from({ length: 905 }, (_, index) => ({
    kind: "investigate" as const,
    text: `Recorded activity ${index + 1}`,
    commands: [`Read source ${index + 1}`],
  })),
};

describe("MissionActivityFeed", () => {
  // 905 DOM nodes: 5000ms is too tight under CI coverage (webui#366).
  it("renders the long-iterate fixture in a focusable, operable scrolling timeline", async () => {
    const conciseFeed = deriveActivityFeed(longIterateFixture, fixtureContext("unknown"));
    expect(conciseFeed.cards.length).toBeLessThanOrEqual(6);
    expect(conciseFeed.cards.findIndex((card) => card.kind === "system")).toBeGreaterThan(0);
    render(<MissionActivityFeed feed={renderedLongIterateFixture} commitArtifact={null} task={TASK} />);
    const timeline = screen.getByTestId("mission-activity-feed");
    expect(timeline).toHaveAttribute("role", "log");
    expect(timeline).toHaveAttribute("tabindex", "0");
    expect(timeline).toHaveClass("mc-feed-scroll");
    expect(screen.getAllByText(/Recorded activity/)).toHaveLength(905);
    Object.defineProperties(timeline, {
      clientHeight: { configurable: true, value: 160 },
      scrollHeight: { configurable: true, value: 90_500 },
    });
    expect(timeline.scrollHeight).toBeGreaterThan(timeline.clientHeight);
    await userEvent.tab();
    expect(timeline).toHaveFocus();
    timeline.scrollTop = 240;
    fireEvent.wheel(timeline, { deltaY: 240 });
    expect(timeline.scrollTop).toBe(240);
    expect(screen.getByTestId("mission-feed-outcome").parentElement).not.toBe(timeline);
  }, 20_000);

  // Preserved affordance: the artifact-open CTA keeps name + click wiring.
  it("opens durable evidence from a card", async () => {
    const onArtifactClick = vi.fn();
    render(<MissionActivityFeed
      feed={{ ...renderedLongIterateFixture, cards: [{ kind: "delivery", text: "Delivered", commands: [], artifact: "commit" }] }}
      onArtifactClick={onArtifactClick}
      commitArtifact={null}
      task={TASK}
    />);
    await userEvent.click(screen.getByRole("button", { name: "Open commit" }));
    expect(onArtifactClick).toHaveBeenCalledWith("commit");
  });

  // 40th (glm, low), DECLINED at the `detailExpanded` useState in
  // `MissionActivityFeedCard.tsx` — pinned here. The entry key leads with
  // `card.kind` (rounds 47/48/52 asked to confirm that order: verified), so a
  // card leaving the blocker bucket REMOUNTS and its expanded flag resets. The
  // 64th (glm, low) notes that key is cross-file and outside this diff, and
  // concludes this is adequate anyway. No change: the loud failure IS the guard.
  // 78th (glm, low, test), DECLINED — glm is right that the "FAIL excerpt" line
  // passes on the non-blocker `<pre>` alone, but the SECOND assertion carries
  // the test and is not vacuous: `MissionActivityFeedCard.tsx:274` renders
  // `detailExpanded && card.detailFull ? card.detailFull : card.detail`, so a
  // surviving flag WOULD dump the full trace here. Falsified by dropping
  // `card.kind` from the entry key in `MissionActivityFeed.tsx` — this test,
  // and only this test, then fails. Kept as-is; the name matches what it pins.
  // 81st + 83rd (glm, low) re-raise only the cross-file coupling and answer
  // themselves: "fails loudly rather than silently — acceptable as shipped".
  it("remounts a card that changes kind, so an expanded blocker detail collapses", () => {
    const blocker = { kind: "blocker" as const, text: "Needs attention.", commands: ["Bash: npm test"], status: "err" as const, detail: "FAIL excerpt", detailFull: "FAIL entire traceback dump", timestamp: "2026-09-16T10:00:00.000Z" };
    const { rerender } = render(<MissionActivityFeed feed={{ outcome: "In progress", cards: [blocker] }} commitArtifact={null} task={TASK} />);
    fireEvent.click(screen.getByRole("button", { name: "Show details (1 command)" }));
    rerender(<MissionActivityFeed feed={{ outcome: "In progress", cards: [{ ...blocker, kind: "test" as const }] }} commitArtifact={null} task={TASK} />);
    expect(screen.getByText("FAIL excerpt")).toBeInTheDocument();
    expect(screen.queryByText("FAIL entire traceback dump")).toBeNull();
  });

  // 46th (glm, low, test), ANSWERED: a NON-blocker renders `card.detail` in its own `<pre>` OUTSIDE `FeedCommands` - no toggle.
  it("renders a status pill and a bounded error excerpt for a failing test card", () => {
    const { container } = render(<MissionActivityFeed feed={{
      outcome: "In progress",
      cards: [{ kind: "test", text: "This test command needs attention.", commands: ["Bash: vitest run"], status: "err", detail: "FAIL slice3-sources.test.ts\nexpect(received).toEqual(expected)" }],
    }} commitArtifact={null} task={TASK} />);
    expect(screen.getByText("Failing")).toBeInTheDocument();
    // 61st (glm, low, test), FIXED: the pill/text assertions would still pass
    // if the detail were routed through `FeedCommands`. Pins the visible `<pre>`.
    expect(container.querySelector(".mc-feed-code pre")).toHaveTextContent("FAIL slice3-sources.test.ts");
    expect(screen.queryByRole("button", { name: /Show details/ })).not.toBeInTheDocument();
  });

  describe("question resolution (three branches)", () => {
    const base = { kind: "user-input" as const, text: "A decision is needed.", commands: [] };

    it("shows the terminal CTA while unresolved", () => {
      render(<MissionActivityFeed feed={{
        outcome: "In progress",
        cards: [{ ...base, question: { text: "Which platform?", options: ["Web", "Mobile"], resolved: false } }],
      }} commitArtifact={null} task={TASK} />);
      expect(screen.getByTestId("askuser-answer-in-terminal")).toBeInTheDocument();
      expect(screen.getByText("Which platform?")).toBeInTheDocument();
      expect(screen.queryByText("Web")).toBeInTheDocument();
      expect(screen.queryByText("Mobile")).toBeInTheDocument();
    });

    it("marks the matched option picked and hides the CTA once resolved", () => {
      render(<MissionActivityFeed feed={{
        outcome: "In progress",
        cards: [{ ...base, question: { text: "Which platform?", options: ["Web", "Mobile"], resolved: true, picked: "Web" } }],
      }} commitArtifact={null} task={TASK} />);
      expect(screen.queryByTestId("askuser-answer-in-terminal")).not.toBeInTheDocument();
      expect(screen.getByText("Which platform?")).toBeInTheDocument();
      const picked = screen.getByText("Web");
      expect(picked.closest(".mc-feed-qa-opt")).toHaveAttribute("data-picked", "true");
    });

    it("shows the free-text answer, not the CTA, when resolved but unmatched", () => {
      render(<MissionActivityFeed feed={{
        outcome: "In progress",
        cards: [{ ...base, question: { text: "Which platform?", options: ["Web", "Mobile"], resolved: true, answer: "Both, actually" } }],
      }} commitArtifact={null} task={TASK} />);
      expect(screen.queryByTestId("askuser-answer-in-terminal")).not.toBeInTheDocument();
      expect(screen.getByText("Which platform?")).toBeInTheDocument();
      expect(screen.getByText("Both, actually")).toBeInTheDocument();
    });
  });

  // AC1: card.text is suppressed ONLY when it exactly duplicates the PR
  // box's own title — never blanket-suppressed.
  it("renders a PR-link card for delivery, suppressing card.text only because it exactly duplicates the PR box's own title", () => {
    render(<MissionActivityFeed feed={{
      outcome: "Completed run",
      cards: [{ kind: "delivery", text: 'Merged as "fix(mission): real content in every card kind".', commands: [], artifact: "commit" }],
    }} commitArtifact={COMMIT_ARTIFACT} task={TASK} />);
    expect(screen.getByText("#367")).toBeInTheDocument();
    expect(screen.getByText("merged")).toBeInTheDocument();
    expect(screen.queryByText('Merged as "fix(mission): real content in every card kind".')).not.toBeInTheDocument();
  });

  it("keeps a genuinely different narrative sentence visible alongside the same PR box", () => {
    render(<MissionActivityFeed feed={{
      outcome: "Completed run",
      cards: [{ kind: "delivery", text: "All required checks went green before this merged.", commands: [], artifact: "commit" }],
    }} commitArtifact={COMMIT_ARTIFACT} task={TASK} />);
    expect(screen.getByText("All required checks went green before this merged.")).toBeInTheDocument();
    expect(screen.getByText("#367")).toBeInTheDocument();
  });

  // Local PR-review preflight (BLOCK, 2026-09-26): card.text can strip to ""
  // (it IS the duplicate sentence) while card.textFull has real narration
  // beyond it — that content must stay reachable via the expand toggle.
  it("keeps textFull's non-duplicate narration reachable via the expand toggle when card.text strips to empty", () => {
    render(<MissionActivityFeed feed={{
      outcome: "Completed run",
      cards: [{
        kind: "delivery",
        text: 'Merged as "fix(mission): real content in every card kind".',
        textFull: 'Merged as "fix(mission): real content in every card kind". Also cleaned up two stale branches.',
        commands: [],
        artifact: "commit",
      }],
    }} commitArtifact={COMMIT_ARTIFACT} task={TASK} />);
    expect(screen.queryByText('Merged as "fix(mission): real content in every card kind".')).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /show more/i });
    fireEvent.click(toggle);
    expect(screen.getByText("Also cleaned up two stale branches.")).toBeInTheDocument();
  });

  it("omits the PR-link card gracefully when no commit artifact is available", () => {
    render(<MissionActivityFeed feed={{
      outcome: "Completed run",
      cards: [{ kind: "delivery", text: "This completed run is recorded through durable artifacts.", commands: [] }],
    }} commitArtifact={null} task={TASK} />);
    expect(screen.queryByText(/merged/i)).not.toBeInTheDocument();
  });

  // Preserved affordance: chip label text survives the <li> -> chip swap.
  it("keeps command chip label text after the chip-treatment rewrite", () => {
    render(<MissionActivityFeed feed={{
      outcome: "In progress",
      cards: [{ kind: "implement", text: "Edited the login handler.", commands: ["Edit: src/auth/login.ts"] }],
    }} commitArtifact={null} task={TASK} />);
    // Commands are collapsed behind a count toggle by default — expand it first.
    fireEvent.click(screen.getByRole("button", { name: "1 command" }));
    expect(screen.getByText("Edit: src/auth/login.ts")).toBeInTheDocument();
  });

  describe("card.explanation", () => {
    // 51st (glm, medium, test), FIXED: the name read "never MarkdownChunk" —
    // the contract requirement 3 INVERTED. It pins what ships.
    it("renders it through the sanitized markdown pipeline, inside the .mc-feed-explanation wrapper", () => {
      const { container } = render(<MissionActivityFeed feed={{
        outcome: "In progress",
        cards: [{ kind: "investigate", text: "Checking the auth guard.", commands: [], explanation: "It reads the **cookie**, then falls back to the header." }],
      }} commitArtifact={null} task={TASK} />);
      const node = container.querySelector(".mc-feed-explanation");
      expect(node).toHaveTextContent("It reads the cookie, then falls back to the header.");
      expect(node?.querySelector("strong")).toHaveTextContent("cookie");
    });

    it("renders HTML-like explanation text as inert literal text, never a real element (same safety bar as detail)", () => {
      const { container } = render(<MissionActivityFeed feed={{
        outcome: "In progress",
        cards: [{ kind: "implement", text: "Edited the login handler.", commands: [], explanation: '<img src=x onerror="window.__pwned=true">More detail.' }],
      }} commitArtifact={null} task={TASK} />);
      expect(container.querySelector("img")).toBeNull();
      expect(screen.getByText(/More detail\./)).toBeInTheDocument();
    });

    it("renders no explanation block, and no other card change, when card.explanation is unset (AC-5 parity)", () => {
      const card = { kind: "investigate" as const, text: "Checking the auth guard.", commands: ["Read: auth.ts"] };
      const { container } = render(<MissionActivityFeed feed={{ outcome: "In progress", cards: [card] }} commitArtifact={null} task={TASK} />);
      expect(container.querySelector(".mc-feed-explanation")).toBeNull();
      expect(screen.getByText("Checking the auth guard.")).toBeInTheDocument();
      // Commands are collapsed behind a count toggle by default — expand it first.
      fireEvent.click(screen.getByRole("button", { name: "1 command" }));
      expect(screen.getByText("Read: auth.ts")).toBeInTheDocument();
    });

    // External LLM Review (openai) MEDIUM: substring assertions would pass
    // even if `explanation` shifted the card markup — this pins FULL markup.
    it("adding explanation changes ONLY the new sibling node — the rest of the card's markup is byte-identical (AC-5 parity, stronger)", () => {
      const base = { kind: "investigate" as const, text: "Checking the auth guard.", status: "ok" as const, commands: ["Read: auth.ts"] };
      const without = render(<MissionActivityFeed feed={{ outcome: "In progress", cards: [base] }} commitArtifact={null} task={TASK} />);
      const withoutHtml = without.container.querySelector('[data-kind="investigate"]')!.outerHTML;
      without.unmount();

      const withExplanation = render(<MissionActivityFeed feed={{ outcome: "In progress", cards: [{ ...base, explanation: "It reads the cookie first." }] }} commitArtifact={null} task={TASK} />);
      const withHtml = withExplanation.container.querySelector('[data-kind="investigate"]')!.outerHTML;
      const explanationNode = withExplanation.container.querySelector(".mc-feed-explanation")!.outerHTML;
      withExplanation.unmount();

      // Removing the new node reproduces the "without" markup exactly.
      expect(withHtml.replace(explanationNode, "")).toBe(withoutHtml);
    });
  });

  // "Session started" divider coverage lives in
  // `MissionActivityFeedSessionStart.test.tsx` (split out during the external
  // code-review round to keep this file under the 300-line convention).

  // iterate-2026-08-31-mission-feed-gaps: the Mission tab opens on the LATEST
  // activity. `scrollHeight` is stubbed BEFORE mount (on the prototype) —
  // jsdom does no layout, so an unstubbed 0 makes `scrollTop = 0` vacuous.
  it("scrolls to the bottom on mount instead of defaulting to the top", async () => {
    const restore = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, value: 5_000 });
    try {
      const manyCards: ActivityFeed = {
        outcome: "In progress",
        cards: Array.from({ length: 50 }, (_, index) => ({
          kind: "investigate" as const,
          text: `Recorded activity ${index + 1}`,
          commands: [],
        })),
      };
      render(<MissionActivityFeed feed={manyCards} commitArtifact={null} task={TASK} />);
      const timeline = screen.getByTestId("mission-activity-feed");
      await waitFor(() => expect(timeline.scrollTop).toBe(5_000));
    } finally {
      if (restore) Object.defineProperty(HTMLElement.prototype, "scrollHeight", restore);
    }
  });
});
