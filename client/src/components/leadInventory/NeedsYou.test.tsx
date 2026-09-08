import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { NeedsYou } from "./NeedsYou";
import type { OrgThreadCardView } from "../../lib/orgApi";

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("NeedsYou", () => {
  it("shows a card whose latest round is unanswered, with exactly one answer field and a link to Org, no thread/round affordance", () => {
    const cards: OrgThreadCardView[] = [
      {
        cardId: "task-1",
        cardTitle: "Follow-up card",
        rounds: [{ id: "task-1#1", question: "Which vendor?", askedAt: "2026-09-08T02:00:00Z" }],
      },
    ];
    renderWithRouter(<NeedsYou cards={cards} />);
    const card = screen.getByTestId("needs-you-card-task-1");
    expect(card).toHaveTextContent("Which vendor?");
    const answerFields = screen.getAllByTestId("needs-you-answer-field");
    expect(answerFields).toHaveLength(1);
    expect(screen.getByTestId("needs-you-org-link-task-1")).toHaveAttribute("href", "/org");
    expect(screen.queryByText(/round/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId(/thread/)).not.toBeInTheDocument();
  });

  it("omits a card whose latest round IS answered, even if an earlier round was open (AC-11)", () => {
    const cards: OrgThreadCardView[] = [
      {
        cardId: "task-2",
        cardTitle: "Resolved card",
        rounds: [
          { id: "task-2#1", question: "First?", askedAt: "2026-09-08T01:00:00Z", answer: "Answered", answeredAt: "2026-09-08T01:05:00Z" },
          { id: "task-2#2", question: "Second?", askedAt: "2026-09-08T02:00:00Z", answer: "Also answered", answeredAt: "2026-09-08T02:05:00Z" },
        ],
      },
    ];
    renderWithRouter(<NeedsYou cards={cards} />);
    expect(screen.queryByTestId("needs-you-card-task-2")).not.toBeInTheDocument();
    expect(screen.getByTestId("needs-you-empty")).toBeInTheDocument();
  });

  it("treats a whitespace-only answer as unanswered (mirrors OrgThread's isAnswered exactly)", () => {
    const cards: OrgThreadCardView[] = [
      {
        cardId: "task-3",
        cardTitle: "Whitespace card",
        rounds: [{ id: "task-3#1", question: "Q?", askedAt: "2026-09-08T01:00:00Z", answer: "   " }],
      },
    ];
    renderWithRouter(<NeedsYou cards={cards} />);
    expect(screen.getByTestId("needs-you-card-task-3")).toBeInTheDocument();
  });

  it("shows an empty state when there is nothing to show, and undefined cards is treated as none", () => {
    renderWithRouter(<NeedsYou cards={undefined} />);
    expect(screen.getByTestId("needs-you-empty")).toBeInTheDocument();
  });
});
