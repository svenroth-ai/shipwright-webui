/*
 * iterate-2026-09-05-mission-feed-ux-gaps - click-to-expand affordances for
 * the "nie croppen" fix (textFull/explanationFull/detailFull/answerFull) and
 * the clickable, inspectable command chip (commandFullText). Split into its
 * own file for `FeedCard` rather than growing `MissionActivityFeed.test.tsx`,
 * already near the project's 300-line convention.
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

function renderCard(card: ActivityCard, onSubrunnerClick?: (subrunnerId: string) => void) {
  return render(<FeedCard card={card} commitArtifact={null} task={TASK} onSubrunnerClick={onSubrunnerClick} />);
}

// 24th-round catch (openai, medium): the collapsed summary used
// `commands.length`, so two DISTINCT calls sharing one label showed "1".
describe("FeedCard — collapsed command count reflects real tool calls, not deduplicated labels", () => {
  it("shows the true call count from card.commandCount when it exceeds the deduplicated commands array length", () => {
    renderCard({ kind: "implement", text: "", commands: ["Read: foo.ts"], commandCount: 2 });
    expect(screen.getByRole("button", { name: "2 commands" })).toBeInTheDocument();
  });

  it("falls back to commands.length when commandCount is absent", () => {
    renderCard({ kind: "implement", text: "", commands: ["Write: login.ts"] });
    expect(screen.getByRole("button", { name: "1 command" })).toBeInTheDocument();
  });
});

describe("FeedCard — empty headline (issue #1: no more generic bucket sentence)", () => {
  it("renders no text block at all when card.text is empty, only the (collapsed) command chip", async () => {
    const user = userEvent.setup();
    const { container } = renderCard({ kind: "implement", text: "", commands: ["Write: login.ts"] });
    expect(container.querySelector(".mc-feed-card > p")).toBeNull();
    expect(screen.queryByText("Write: login.ts")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "1 command" }));
    expect(screen.getByText("Write: login.ts")).toBeInTheDocument();
  });
});

// 6th-round catch (glm, low): the existing HTML-inertness test for card.text
// would pass identically if it rendered as a plain text node — proving
// nothing about markdown actually rendering (item 3).
describe("FeedCard — card.text renders real markdown, not just inert HTML", () => {
  it("renders bold markdown syntax in card.text as a real element, not literal source", () => {
    renderCard({ kind: "implement", text: "**Done:** the change is **bold**.", commands: [] });
    expect(screen.getByText("bold", { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByText(/\*\*Done:\*\*/)).not.toBeInTheDocument();
  });

  // 17th-round catch (glm, low): the prior fixture put `##` mid-line, which
  // markdown never treats as a heading - the name promised what it lacked.
  it("renders a block heading in card.text as a real <h2>, not literal source", () => {
    renderCard({ kind: "implement", text: "## Heading\n\n**bold**", commands: [] });
    expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument();
    expect(screen.queryByText(/## Heading/)).not.toBeInTheDocument();
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

  it("expands card.detailFull in place when Show more is clicked (a non-blocker card's detail — a blocker's own detail toggle is covered separately below)", async () => {
    const user = userEvent.setup();
    renderCard({ kind: "review", text: "", commands: [], status: "ok", detail: "PASS line one\nline two…", detailFull: "PASS line one\nline two\nline three\nline four\nline five" });
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
  it("renders a plain, non-interactive chip when the label already shows the full command", async () => {
    const user = userEvent.setup();
    renderCard({ kind: "implement", text: "", commands: ["Bash: npm test"] });
    await user.click(screen.getByRole("button", { name: "1 command" }));
    expect(screen.queryByRole("button", { name: /Bash: npm test/ })).not.toBeInTheDocument();
    expect(screen.getByText("Bash: npm test")).toBeInTheDocument();
  });

  it("renders the chip as a clickable button and reveals the full command on click when commandFullText has an entry", async () => {
    const user = userEvent.setup();
    const label = "Bash: npm run build -- --flag xxxxxxxxxx…";
    const full = "Bash: npm run build -- --flag xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    renderCard({ kind: "implement", text: "", commands: [label], commandFullText: { [label]: full } });
    await user.click(screen.getByRole("button", { name: "1 command" }));
    const chip = screen.getByRole("button", { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    expect(chip).toHaveAttribute("aria-expanded", "false");
    await user.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(full)).toBeInTheDocument();
  });
});

describe("FeedCard — commands are collapsed behind a summary line by default (reported: every tool call rendered as its own always-open box)", () => {
  it("shows a count toggle and no chips until clicked; clicking again hides them", async () => {
    const user = userEvent.setup();
    renderCard({ kind: "implement", text: "", commands: ["Read: a.ts", "Bash: npm run build", "Write: b.ts"] });
    const toggle = screen.getByRole("button", { name: "3 commands" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Read: a.ts")).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Hide commands" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Read: a.ts")).toBeInTheDocument();
    expect(screen.getByText("Bash: npm run build")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide commands" }));
    expect(screen.queryByText("Read: a.ts")).not.toBeInTheDocument();
  });

  // 54th-round catch (glm, low, test), ANSWERED: the `/command/i` matcher is
  // deliberately BROAD - it must also catch a "Show details (N commands)"
  // toggle leaking onto a non-blocker card, not only the "N commands" one.
  // Narrowing it to an exact name would shrink what the test can notice.
  it("renders no toggle at all when the card has no commands", () => {
    renderCard({ kind: "implement", text: "Some narration.", commands: [] });
    expect(screen.queryByRole("button", { name: /command/i })).not.toBeInTheDocument();
  });
});

describe("FeedCard — card.explanation renders as markdown (reported: a turn's own table/headers showed as raw markdown source)", () => {
  it("renders a markdown table from card.explanation as an actual <table>, not raw pipe/dash text", () => {
    const { container } = renderCard({
      kind: "implement",
      text: "",
      commands: [],
      explanation: "## Wave 1\n\n| # | Title |\n|---|---|\n| 01 | Do the thing |",
    });
    expect(container.querySelector(".mc-feed-explanation table")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Wave 1" })).toBeInTheDocument();
    expect(screen.queryByText(/\|---\|---\|/)).not.toBeInTheDocument();
  });
});

// iterate-2026-09-26-mission-tab-subrunner — item 3's primary UI surface.
describe("FeedCard — subrunner card rendering", () => {
  it("running: shows the pulsing-dot indicator, no report link", () => {
    renderCard({ kind: "subrunner", text: "Investigate the auth bug", commands: [], subrunnerId: "t1", subrunnerStatus: "running" });
    expect(screen.getByText("Running…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View subrunner report" })).not.toBeInTheDocument();
  });

  it("resolved with a click handler: renders the report-link button and calls back with the card's subrunnerId", async () => {
    const user = userEvent.setup();
    const onSubrunnerClick = vi.fn();
    renderCard({ kind: "subrunner", text: "Investigate the auth bug", commands: [], subrunnerId: "agent-42", subrunnerStatus: "done", subrunnerReport: "Fixed it." }, onSubrunnerClick);
    const link = screen.getByRole("button", { name: "View subrunner report" });
    await user.click(link);
    expect(onSubrunnerClick).toHaveBeenCalledWith("agent-42");
  });

  it("resolved with no click handler wired: falls back to rendering the report inline", () => {
    renderCard({ kind: "subrunner", text: "Investigate the auth bug", commands: [], subrunnerId: "agent-42", subrunnerStatus: "done", subrunnerReport: "Fixed it." });
    expect(screen.queryByRole("button", { name: "View subrunner report" })).not.toBeInTheDocument();
    expect(screen.getByText("Fixed it.")).toBeInTheDocument();
  });
});
