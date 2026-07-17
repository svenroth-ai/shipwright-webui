/*
 * A19 (FR-01.63) — the honest terminal fallback, per inbox kind. RED-first:
 * before the change the CTA COPIES a command (no navigation) and no card carries
 * the honesty line, so the navigation + honesty assertions here fail. Green after
 * the clipboard→navigation CTA + the honesty copy land.
 *
 * Asserted for each kind (ask_tool / text_question / terminal_prompt):
 *   - the prototype anatomy renders (context pill, question/body, Options: as
 *     READ-ONLY text where the payload has options);
 *   - the CTA is a NAVIGATION to the task's terminal deep link, never a
 *     clipboard write, never a clickable option that sends;
 *   - the honesty copy is present (the WebUI does not answer for you).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router-dom";

import { InboxCard } from "./InboxCard";
import {
  makeAskItem,
  makeTask,
  makeTerminalPromptItem,
  makeTextItem,
} from "./__fixtures__/inbox-fixtures";
import { buildTaskTerminalDeepLink } from "../../lib/taskDeepLink";

function TaskDetailProbe() {
  const loc = useLocation();
  const params = useParams();
  return (
    <div
      data-testid="task-detail-probe"
      data-task-id={params.id ?? ""}
      data-search={loc.search}
    />
  );
}

function renderCard(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/inbox"]}>
        <Routes>
          <Route path="/inbox" element={node} />
          <Route path="/tasks/:id" element={<TaskDetailProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const OPT_ASK = makeAskItem({
  toolUseId: "tu-fb",
  input: {
    questions: [
      {
        question: "Reset link expiry — 1 hour or 24 hours?",
        header: "Priority",
        context: "A shorter window is safer; a longer one is friendlier.",
        options: [{ label: "1 hour" }, { label: "24 hours" }],
      },
    ],
  },
});

describe("A19 terminal fallback — ask_tool card", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders anatomy: context pill + question + read-only Options text", () => {
    renderCard(
      <InboxCard item={OPT_ASK} task={makeTask({ title: "build password reset" })} />,
    );
    expect(
      screen.getByTestId("inbox-task-context-pill-tu-fb"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Reset link expiry — 1 hour or 24 hours?"),
    ).toBeInTheDocument();
    // Options render as read-only chips (spans), never <button>.
    const chip0 = screen.getByTestId("inbox-option-chip-0");
    expect(chip0.tagName.toLowerCase()).not.toBe("button");
    expect(chip0).toHaveTextContent("1 hour");
  });

  it("the CTA NAVIGATES to the terminal deep link (not a clipboard copy)", () => {
    renderCard(<InboxCard item={OPT_ASK} task={makeTask()} />);
    fireEvent.click(screen.getByTestId("inbox-resume-tu-fb"));
    const probe = screen.getByTestId("task-detail-probe");
    expect(probe).toHaveAttribute("data-task-id", "task-1");
    const expected = buildTaskTerminalDeepLink("task-1");
    expect(probe.getAttribute("data-search")).toBe(
      expected.slice(expected.indexOf("?")),
    );
  });

  it("carries the honesty copy — the WebUI does not answer for you", () => {
    renderCard(<InboxCard item={OPT_ASK} task={makeTask()} />);
    const honesty = screen.getByTestId("inbox-honesty-tu-fb");
    expect(honesty.textContent ?? "").toMatch(/terminal/i);
    expect(honesty.textContent ?? "").toMatch(/does(n't| not) answer/i);
  });

  it("has NO clickable option button that could send into the session", () => {
    const { container } = renderCard(<InboxCard item={OPT_ASK} task={makeTask()} />);
    for (const b of Array.from(container.querySelectorAll("button"))) {
      const txt = (b.textContent ?? "").trim();
      expect(txt).not.toBe("1 hour");
      expect(txt).not.toBe("24 hours");
    }
  });
});

describe("A19 terminal fallback — text_question card", () => {
  it("renders the body + the honesty copy", () => {
    const item = makeTextItem({ questionId: "q-fb", questionText: "Approach A or B?" });
    renderCard(<InboxCard item={item} task={makeTask()} />);
    expect(screen.getByTestId("inbox-question-text-q-fb")).toHaveTextContent(
      "Approach A or B?",
    );
    const honesty = screen.getByTestId("inbox-honesty-q-fb");
    expect(honesty.textContent ?? "").toMatch(/terminal/i);
  });

  it("the CTA navigates to the terminal deep link (no freetext input)", () => {
    const item = makeTextItem({ questionId: "q-fb" });
    const { container } = renderCard(<InboxCard item={item} task={makeTask()} />);
    expect(container.querySelector("textarea")).toBeNull();
    fireEvent.click(screen.getByTestId("inbox-resume-q-fb"));
    const probe = screen.getByTestId("task-detail-probe");
    expect(probe).toHaveAttribute("data-task-id", "task-1");
    const expected = buildTaskTerminalDeepLink("task-1");
    expect(probe.getAttribute("data-search")).toBe(
      expected.slice(expected.indexOf("?")),
    );
  });
});

describe("A19 terminal fallback — terminal_prompt card", () => {
  it("renders the recessed mono prompt + the honesty copy", () => {
    const item = makeTerminalPromptItem({
      taskId: "task-1",
      promptText: "❯ Overwrite existing migration 0007_add_reset_tokens.sql? (y/N)",
    });
    renderCard(<InboxCard item={item} task={makeTask()} />);
    expect(
      screen.getByTestId("inbox-question-text-tp-task-1"),
    ).toHaveTextContent("Overwrite existing migration");
    const honesty = screen.getByTestId("inbox-honesty-tp-task-1");
    expect(honesty.textContent ?? "").toMatch(/terminal/i);
  });

  it("the CTA navigates to the terminal deep link (no freetext input)", () => {
    const item = makeTerminalPromptItem({ taskId: "task-1" });
    const { container } = renderCard(<InboxCard item={item} task={makeTask()} />);
    expect(container.querySelector("textarea")).toBeNull();
    fireEvent.click(screen.getByTestId("inbox-resume-tp-task-1"));
    expect(screen.getByTestId("task-detail-probe")).toHaveAttribute(
      "data-task-id",
      "task-1",
    );
  });
});
