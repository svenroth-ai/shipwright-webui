import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
  // Renders 905 DOM nodes and text-queries all of them — comfortably under
  // 1s locally, but the default 5000ms vitest timeout is too tight under
  // CI's coverage-instrumented, full-suite-parallel run (observed timing out
  // at ~5000ms twice on shipwright-webui#366, pre-existing and unrelated to
  // that PR's diff).
  it("renders the long-iterate fixture in a focusable, operable scrolling timeline", async () => {
    const conciseFeed = deriveActivityFeed(longIterateFixture, fixtureContext("unknown"));
    expect(conciseFeed.cards.length).toBeLessThanOrEqual(6);
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

  // Preserved affordance (internal + external review): the artifact-open CTA's
  // accessible name and click wiring must survive the markup rewrite unchanged.
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

  // Content-safety constraint (external review, iterate-2026-08-13-mission-mobile-visual,
  // extended by iterate-2026-08-20-mission-feed-content to `detail`/`question.*`):
  // card.text can carry a turn's own assistant prose (assistant-influenced content), so it
  // must render through the same safe markdown path as the rest of the transcript, never a
  // raw <p>/dangerouslySetInnerHTML — HTML-like text must never become a real element.
  it("renders HTML-like card text as inert markdown, never a real element", () => {
    const { container } = render(<MissionActivityFeed feed={{
      outcome: "In progress",
      cards: [{ kind: "implement", text: '<img src=x onerror="window.__pwned=true">Edited the login handler.', commands: [] }],
    }} commitArtifact={null} task={TASK} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/Edited the login handler/)).toBeInTheDocument();
  });

  it("renders HTML-like raw-output detail as inert literal text, never a real element", () => {
    const { container } = render(<MissionActivityFeed feed={{
      outcome: "In progress",
      cards: [{ kind: "blocker", text: "A command needs attention before work can continue.", commands: ["Bash: npm test"], status: "err", detail: '<img src=x onerror="window.__pwned=true">FAIL src/x.test.ts' }],
    }} commitArtifact={null} task={TASK} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/FAIL src\/x\.test\.ts/)).toBeInTheDocument();
  });

  it("renders a status pill and a bounded error excerpt for a failing test card", () => {
    render(<MissionActivityFeed feed={{
      outcome: "In progress",
      cards: [{ kind: "test", text: "This test command needs attention.", commands: ["Bash: vitest run"], status: "err", detail: "FAIL slice3-sources.test.ts\nexpect(received).toEqual(expected)" }],
    }} commitArtifact={null} task={TASK} />);
    expect(screen.getByText("Failing")).toBeInTheDocument();
    expect(screen.getByText(/FAIL slice3-sources\.test\.ts/)).toBeInTheDocument();
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

  it("renders a PR-link card for delivery when a merged commit artifact is available", () => {
    render(<MissionActivityFeed feed={{
      outcome: "Completed run",
      cards: [{ kind: "delivery", text: 'Merged as "fix(mission): real content in every card kind".', commands: [], artifact: "commit" }],
    }} commitArtifact={COMMIT_ARTIFACT} task={TASK} />);
    expect(screen.getByText("#367")).toBeInTheDocument();
    expect(screen.getByText("merged")).toBeInTheDocument();
  });

  it("omits the PR-link card gracefully when no commit artifact is available", () => {
    render(<MissionActivityFeed feed={{
      outcome: "Completed run",
      cards: [{ kind: "delivery", text: "This completed run is recorded through durable artifacts.", commands: [] }],
    }} commitArtifact={null} task={TASK} />);
    expect(screen.queryByText(/merged/i)).not.toBeInTheDocument();
  });

  // Preserved affordance: command chip content (the label text) must survive
  // the plain-<li> -> icon-chip markup swap unchanged.
  it("keeps command chip label text after the chip-treatment rewrite", () => {
    render(<MissionActivityFeed feed={{
      outcome: "In progress",
      cards: [{ kind: "implement", text: "Edited the login handler.", commands: ["Edit: src/auth/login.ts"] }],
    }} commitArtifact={null} task={TASK} />);
    expect(screen.getByText("Edit: src/auth/login.ts")).toBeInTheDocument();
  });

  // iterate-2026-08-25-mission-feed-progress-narration.
  describe("card.explanation", () => {
    it("renders it as plain text below the headline, reusing the qa-answer style — never MarkdownChunk", () => {
      const { container } = render(<MissionActivityFeed feed={{
        outcome: "In progress",
        cards: [{ kind: "investigate", text: "Checking the auth guard.", commands: [], explanation: "It reads the cookie, then falls back to the header." }],
      }} commitArtifact={null} task={TASK} />);
      const node = container.querySelector(".mc-feed-explanation");
      expect(node).toHaveTextContent("It reads the cookie, then falls back to the header.");
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
      expect(screen.getByText("Read: auth.ts")).toBeInTheDocument();
    });

    // External LLM Review (openai) MEDIUM finding: the two prior assertions
    // only probe specific substrings, so they would still pass if adding
    // `explanation` had also touched the surrounding card markup (wrapper
    // element, chip/pill structure, status UI) for the unpopulated case.
    // This asserts the FULL card markup is unaffected by toggling
    // `explanation` on/off, beyond just the one new sibling node.
    it("adding explanation changes ONLY the new sibling node — the rest of the card's markup is byte-identical (AC-5 parity, stronger)", () => {
      const base = { kind: "investigate" as const, text: "Checking the auth guard.", status: "ok" as const, commands: ["Read: auth.ts"] };
      const without = render(<MissionActivityFeed feed={{ outcome: "In progress", cards: [base] }} commitArtifact={null} task={TASK} />);
      const withoutHtml = without.container.querySelector('[data-kind="investigate"]')!.outerHTML;
      without.unmount();

      const withExplanation = render(<MissionActivityFeed feed={{ outcome: "In progress", cards: [{ ...base, explanation: "It reads the cookie first." }] }} commitArtifact={null} task={TASK} />);
      const withHtml = withExplanation.container.querySelector('[data-kind="investigate"]')!.outerHTML;
      const explanationNode = withExplanation.container.querySelector(".mc-feed-explanation")!.outerHTML;
      withExplanation.unmount();

      // Removing exactly the new node from the "with" render reproduces the
      // "without" render's markup — nothing else shifted.
      expect(withHtml.replace(explanationNode, "")).toBe(withoutHtml);
    });
  });
});
