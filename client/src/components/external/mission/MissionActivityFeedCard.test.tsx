/*
 * iterate-2026-09-05-mission-feed-ux-gaps — click-to-expand affordances for
 * the "nie croppen" fix (textFull/explanationFull/detailFull/answerFull) and
 * the clickable, inspectable command chip (commandFullText). Split into its
 * own file for `FeedCard` (the per-card component split out of
 * `MissionActivityFeed.tsx` in the same iterate) rather than growing
 * `MissionActivityFeed.test.tsx`, already near the project's 300-line
 * convention.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FeedCard } from "./MissionActivityFeedCard";
import type { ActivityCard } from "../../../lib/missionActivityFeed";
import type { ExternalTask } from "../../../lib/externalApi";

const mutateAsync = vi.fn().mockResolvedValue({ commands: { posix: "claude --resume x", powershell: "claude --resume x" } });
vi.mock("../../../hooks/useLaunchTask", () => ({
  useLaunchTask: () => ({ mutateAsync, isPending: false }),
}));

const TASK = { taskId: "task-mission-feed", projectId: "p1" } as unknown as ExternalTask;

function renderCard(card: ActivityCard) {
  return render(<FeedCard card={card} commitArtifact={null} task={TASK} />);
}

describe("FeedCard — empty headline (issue #1: no more generic bucket sentence)", () => {
  it("renders no text block at all when card.text is empty, only the command chip", () => {
    const { container } = renderCard({ kind: "implement", text: "", commands: ["Write: login.ts"] });
    expect(container.querySelector(".mc-feed-card > p")).toBeNull();
    expect(screen.getByText("Write: login.ts")).toBeInTheDocument();
  });
});

describe("FeedCard — click-to-expand for untruncated fields (issue #2/#4: nie croppen)", () => {
  it("shows a Show more toggle and reveals textFull only when it differs from the truncated text", () => {
    renderCard({ kind: "implement", text: "Short headline.", commands: [] });
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("expands card.textFull in place when Show more is clicked, and collapses back on a second click", async () => {
    const user = userEvent.setup();
    renderCard({ kind: "implement", text: "Truncated headline…", textFull: "Truncated headline, but the whole real sentence continues here.", commands: [] });
    expect(screen.getByText("Truncated headline…")).toBeInTheDocument();
    expect(screen.queryByText(/whole real sentence/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText(/whole real sentence/)).toBeInTheDocument();
    expect(screen.queryByText("Truncated headline…")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show less" }));
    expect(screen.getByText("Truncated headline…")).toBeInTheDocument();
  });

  it("expands card.explanationFull in place when Show more is clicked", async () => {
    const user = userEvent.setup();
    renderCard({ kind: "investigate", text: "Checking the auth guard.", commands: [], explanation: "It reads the cookie…", explanationFull: "It reads the cookie, then falls back to the legacy header, and finally denies the request." });
    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText(/falls back to the legacy header/)).toBeInTheDocument();
  });

  it("expands card.detailFull in place when Show more is clicked", async () => {
    const user = userEvent.setup();
    renderCard({ kind: "blocker", text: "A command needs attention.", commands: [], status: "err", detail: "FAIL line one\nline two…", detailFull: "FAIL line one\nline two\nline three\nline four\nline five" });
    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText(/line five/)).toBeInTheDocument();
  });

  it("expands question.answerFull in place, next to the Answer: label", async () => {
    const user = userEvent.setup();
    renderCard({
      kind: "user-input",
      text: "A decision is needed.",
      commands: [],
      question: { text: "Which approach?", options: [], resolved: true, answer: "Short excerpt…", answerFull: "Short excerpt of a much longer free-text answer the user actually gave." },
    });
    expect(screen.getByText("Answer:")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText(/much longer free-text answer/)).toBeInTheDocument();
  });
});

describe("FeedCard — inspectable command chip (issue #3: long commands could not be read)", () => {
  it("renders a plain, non-interactive chip when the label already shows the full command", () => {
    renderCard({ kind: "implement", text: "", commands: ["Bash: npm test"] });
    expect(screen.queryByRole("button", { name: /Bash: npm test/ })).not.toBeInTheDocument();
    expect(screen.getByText("Bash: npm test")).toBeInTheDocument();
  });

  it("renders the chip as a clickable button and reveals the full command on click when commandFullText has an entry", async () => {
    const user = userEvent.setup();
    const label = "Bash: npm run build -- --flag xxxxxxxxxx…";
    const full = "Bash: npm run build -- --flag xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    renderCard({ kind: "implement", text: "", commands: [label], commandFullText: { [label]: full } });
    const chip = screen.getByRole("button", { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    expect(chip).toHaveAttribute("aria-expanded", "false");
    await user.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(full)).toBeInTheDocument();
  });
});
