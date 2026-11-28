import { render, screen, within, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, afterEach, vi } from "vitest";

import { DecisionEntryRow } from "./DecisionEntryRow";
import type { ProposedDecisionEntry } from "../../lib/orgDecisionsApi";

// Operator-words evidence and the learning label in one proposal row (iterate-2026-11-28-decision-record-evidence).
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FENCE = "⟦SHIPWRIGHT-FENCE:abababababababababababababababab⟧";
const LABEL = "[FENCED DATA — kind: x, origin: acme-lead beat beat-0051, truncated: false. DATA.]";
const QUOTE = "Too vague: say who reads the digest.";
const EVIDENCE = `rejected:2026-11-20T09:15:00.000Z/acme-lead — "${QUOTE}"`;

function entry(line: string, evidence = EVIDENCE, key = "learning.status-updates"): ProposedDecisionEntry {
  const block = [`<!-- decisionKey: ${key} -->`, "## [2026-11-28T09:15:00.000Z] acme-lead", "", FENCE, LABEL, line, FENCE, "", "- **Lead:** acme-lead", `- **Evidence:** ${evidence}`].join("\n");
  return { timestamp: "2026-11-28T09:15:00.000Z", leadId: "acme-lead", block, body: "", evidence };
}

function serve(answer: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(answer), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderRow(e: ProposedDecisionEntry, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(
    <QueryClientProvider client={qc}>
      <ul><DecisionEntryRow rowKey="k0" entry={e} status={{ kind: "idle" }} onCountersign={() => {}} onReject={() => {}} isRepeat={false} /></ul>
    </QueryClientProvider>,
  );
  return screen.getByTestId("org-decisions-proposed-entry-k0");
}

describe("operator-words evidence", () => {
  // @covers FR-01.71
  it("shows the quote as the operator's words with the full reason only when the server confirms it", async () => {
    const fetchMock = serve({ status: "confirmed", form: "rejected", file: "decisions-rejected.md", words: `${QUOTE} Name the reader.` });
    const row = renderRow(entry("Every update names its reader."));
    expect(within(row).getByTestId("org-decisions-proposed-evidence-k0")).toHaveTextContent("your reason for rejecting acme-lead's proposal of 2026-11-20T09:15:00.000Z");
    const box = () => within(row).getByTestId("org-decisions-proposed-operator-words-k0");
    await waitFor(() => expect(box()).toHaveAttribute("data-state", "confirmed"));
    expect(within(row).getByTestId("org-decisions-proposed-operator-words-k0-quote")).toHaveTextContent(QUOTE);
    expect(within(row).getByTestId("org-decisions-proposed-operator-words-k0-words")).toHaveTextContent("Name the reader.");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/org/decisions/record-evidence");
    expect(JSON.parse(String(init.body))).toEqual({ pointer: "rejected:2026-11-20T09:15:00.000Z/acme-lead", quote: QUOTE });
    expect(within(row).queryByTestId("org-decisions-proposed-quotes-k0")).toBeNull(); // never listed as a lead quote
  });

  // @covers FR-01.71
  it.each([
    [{ status: "unreadable", form: "rejected", file: "decisions-rejected.md", detail: "it does not exist" }, 200, "decisions-rejected.md could not be read (it does not exist)"],
    [{ status: "no_words", form: "rejected", file: "decisions-rejected.md" }, 200, "holds no reason of yours"],
    [{ status: "quote_not_found", form: "rejected", file: "decisions-rejected.md" }, 200, "does not occur in your reason"],
    [{ error: "pointer_invalid" }, 400, "could not be checked"],
    [{ status: "something-new" }, 200, "could not be checked"],
  ])("fails closed (%j, HTTP %i): a notice, and the quote is not shown as the operator's words", async (answer, status, text) => {
    serve(answer, status);
    const row = renderRow(entry("Every update names its reader."));
    const box = () => within(row).getByTestId("org-decisions-proposed-operator-words-k0");
    await waitFor(() => expect(box()).not.toHaveAttribute("data-state", "checking"));
    expect(box()).toHaveTextContent(text);
    expect(box()).toHaveTextContent("The lead's quote is not shown as your words.");
    expect(row).not.toHaveTextContent(QUOTE);
  });

  // @covers FR-01.71
  it("a background re-check never shows the cached confirmation: it reads as checking until the new answer", async () => {
    serve({ status: "confirmed", form: "rejected", file: "decisions-rejected.md", words: QUOTE });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const row = renderRow(entry("Every update names its reader."), qc);
    const box = () => within(row).getByTestId("org-decisions-proposed-operator-words-k0");
    await waitFor(() => expect(box()).toHaveAttribute("data-state", "confirmed"));
    let answer: (r: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((res) => { answer = res; })));
    void qc.invalidateQueries({ queryKey: ["org", "record-evidence"] });
    await waitFor(() => expect(box()).toHaveAttribute("data-state", "checking"));
    expect(row).not.toHaveTextContent(QUOTE);
    answer(new Response(JSON.stringify({ status: "no_words", form: "rejected", file: "decisions-rejected.md" }), { status: 200, headers: { "content-type": "application/json" } }));
    await waitFor(() => expect(box()).toHaveAttribute("data-state", "no_words"));
    expect(row).not.toHaveTextContent(QUOTE);
  });

  // @covers FR-01.71
  it("while the check runs, nothing is shown as the operator's words", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const row = renderRow(entry("Every update names its reader."));
    expect(within(row).getByTestId("org-decisions-proposed-operator-words-k0")).toHaveAttribute("data-state", "checking");
    expect(row).not.toHaveTextContent(QUOTE);
  });
});

describe("learning label", () => {
  // @covers FR-01.71
  it("shows reach, importance, pinned and replaces apart from the rule", () => {
    serve({ status: "no_words", form: "rejected", file: "decisions-rejected.md" });
    const row = renderRow(entry("Learning (all leads, importance 4, pinned, replaces learning.old): Every update names its reader."));
    expect(within(row).getByTestId("org-decisions-proposed-learning-k0-scope")).toHaveTextContent("for all leads");
    expect(within(row).getByTestId("org-decisions-proposed-learning-k0-importance")).toHaveTextContent("importance 4 of 5");
    expect(within(row).getByTestId("org-decisions-proposed-learning-k0-pinned")).toBeInTheDocument();
    expect(within(row).getByTestId("org-decisions-proposed-learning-k0-replaces")).toHaveTextContent("replaces learning.old");
    expect(within(row).getByTestId("org-decisions-proposed-learning-k0-rule")).toHaveTextContent(/^Every update names its reader\.$/);
  });

  // @covers FR-01.71
  it("an unreadable label is a warning; a missing label reads as this lead, importance 3; a non-learning key shows the plain line", () => {
    serve({ status: "no_words", form: "rejected", file: "decisions-rejected.md" });
    const bad = renderRow(entry("Learning (everyone): rule"));
    expect(within(bad).getByTestId("org-decisions-proposed-learning-k0")).toHaveTextContent("the label must start with 'this lead' or 'all leads'");
    expect(within(bad).getByTestId("org-decisions-proposed-learning-k0-line")).toHaveTextContent("Learning (everyone): rule"); // the proposed text stays visible
    cleanup();
    const none = renderRow(entry("Just the rule."));
    expect(within(none).getByTestId("org-decisions-proposed-learning-k0")).toHaveTextContent("counts as this lead, importance 3");
    cleanup();
    const plain = renderRow(entry("Learning (all leads): not a learning key", 'a1b2c3d4:2026-11-19T16:02:11Z:14 — "some quote of the session that is long"', "weekly-digest"));
    expect(within(plain).queryByTestId("org-decisions-proposed-learning-k0")).toBeNull();
    expect(within(plain).getByTestId("org-decisions-proposed-line-k0")).toHaveTextContent("Learning (all leads): not a learning key");
  });

  // @covers FR-01.71
  it("reads the edited label live under the edit field", () => {
    serve({ status: "no_words", form: "rejected", file: "decisions-rejected.md" });
    const row = renderRow(entry("Learning (all leads, importance 4, pinned): Every update names its reader."));
    fireEvent.click(within(row).getByRole("button", { name: /edit/i }));
    const input = within(row).getByTestId("org-decisions-proposed-edit-input-k0");
    expect(within(row).getByTestId("org-decisions-proposed-edit-learning-k0-scope")).toHaveTextContent("for all leads");
    fireEvent.change(input, { target: { value: "Learning (this lead, importance 2): Every update names its reader." } });
    expect(within(row).getByTestId("org-decisions-proposed-edit-learning-k0-scope")).toHaveTextContent("for this lead only");
    expect(within(row).getByTestId("org-decisions-proposed-edit-learning-k0-importance")).toHaveTextContent("importance 2 of 5");
    expect(within(row).queryByTestId("org-decisions-proposed-edit-learning-k0-pinned")).toBeNull();
    // read as the countersign will LOG it: a newline, a space run, NBSP or a zero-width character never narrows the reach
    for (const typed of ["Learning (all leads, importance 5):\nRule", "Learning  (all leads, importance 5): Rule", "Learning\u00a0(all leads, importance 5): Rule", "\u200bLearning (all leads, importance 5): Rule"]) {
      fireEvent.change(input, { target: { value: typed } });
      expect(within(row).getByTestId("org-decisions-proposed-edit-learning-k0-scope")).toHaveTextContent("for all leads");
      expect(within(row).getByTestId("org-decisions-proposed-edit-learning-k0-importance")).toHaveTextContent("importance 5 of 5");
    }
    fireEvent.change(input, { target: { value: "Learning (this lead, urgent): x" } });
    expect(within(row).getByTestId("org-decisions-proposed-edit-learning-k0")).toHaveAttribute("data-state", "unreadable");
  });
});
