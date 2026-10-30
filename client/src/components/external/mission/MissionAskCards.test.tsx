/** M5 — answered AskUserQuestion cards inside FeedCard, plus the chat-style entry contract. */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { FeedCard } from "./MissionActivityFeedCard";
import { MissionActivityFeed } from "./MissionActivityFeed";
import type { ActivityCard } from "../../../lib/missionActivityFeed";
import type { ExternalTask } from "../../../lib/externalApi";

vi.mock("../../../hooks/useLaunchTask", () => ({ useLaunchTask: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
const TASK = { taskId: "t", projectId: "p1" } as unknown as ExternalTask;

const answeredCard = (items: NonNullable<ActivityCard["question"]>["items"]): ActivityCard => ({
  kind: "user-input", text: "The requested user input was received and work could continue.", commands: [],
  question: { text: "Which platform?", options: ["Web App"], resolved: true, items },
});

describe("answered AskUserQuestion cards", () => {
  // @covers FR-01.66
  it("renders one card per question, options with descriptions, only the chosen one marked", () => {
    render(<FeedCard task={TASK} commitArtifact={null} card={answeredCard([
      { question: "Which platform?", header: "Platform", multiSelect: false, options: [{ label: "Web App", description: "Browser" }, { label: "Mobile App" }], answer: "Web App", chosen: "Web App" },
      { question: "Which stack?", multiSelect: false, options: [{ label: "React" }], answer: "Svelte", other: true },
    ])} />);
    const cards = screen.getAllByTestId("mission-ask-card");
    expect(cards).toHaveLength(2);
    const opts = within(cards[0]).getAllByTestId("mission-ask-option");
    expect(opts.map((o) => o.getAttribute("data-chosen"))).toEqual(["true", null]);
    expect(within(cards[0]).getByText("Browser")).toBeInTheDocument();
    expect(within(opts[0]).getByText("(selected)")).toBeInTheDocument();
    expect(within(cards[1]).getByTestId("mission-ask-other")).toHaveTextContent("Svelte");
    expect(screen.queryByText(/requested user input was received/)).not.toBeInTheDocument();
  });

  // @covers FR-01.66
  it("shows a multiSelect answer as raw text; options are marked only when the parts are unambiguous labels", () => {
    const { rerender } = render(<FeedCard task={TASK} commitArtifact={null} card={answeredCard([
      { question: "Features?", multiSelect: true, options: [{ label: "Tags" }, { label: "Due" }], answer: "Tags, wat" },
    ])} />);
    expect(screen.getByTestId("mission-ask-multi-answer")).toHaveTextContent("Tags, wat");
    expect(screen.queryAllByTestId("mission-ask-option").some((o) => o.hasAttribute("data-chosen"))).toBe(false);
    rerender(<FeedCard task={TASK} commitArtifact={null} card={answeredCard([
      { question: "Features?", multiSelect: true, options: [{ label: "Tags" }, { label: "Due" }], answer: "Tags, Due", chosenAll: ["Tags", "Due"] },
    ])} />);
    expect(screen.getAllByTestId("mission-ask-option").map((o) => o.getAttribute("data-chosen"))).toEqual(["true", "true"]);
  });

  // @covers FR-01.66
  it("keeps the terminal CTA prompt for a genuinely pending question", () => {
    render(<FeedCard task={TASK} commitArtifact={null} card={{ kind: "user-input", text: "x", commands: [], question: { text: "Pending one?", options: ["A"], resolved: false } }} />);
    expect(screen.getByText("Pending one?")).toBeInTheDocument();
    expect(screen.queryByTestId("mission-ask-cards")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /answer/i })).toBeInTheDocument();
  });
});

describe("chat-style feed entries", () => {
  // @covers FR-01.66
  it("renders no avatar/timeline node and tags each entry with its kind (user = right-aligned bubble via CSS)", () => {
    const { container } = render(<MissionActivityFeed task={TASK} commitArtifact={null} feed={{ outcome: "o", cards: [
      { kind: "user", text: "Hello", commands: [] },
      { kind: "implement", text: "Working on it.", commands: ["Read: a.ts"] },
    ] }} />);
    expect(container.querySelector(".mc-feed-node")).toBeNull();
    expect(container.querySelector('.mc-feed-entry[data-entry-kind="user"] .mc-feed-card')).toHaveTextContent("Hello");
    expect(container.querySelector('.mc-feed-entry[data-entry-kind="implement"]')).not.toBeNull();
    expect(container.querySelector("textarea, input, [data-testid^='chat-']")).toBeNull();
  });
});
