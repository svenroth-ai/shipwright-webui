import { render, screen, within, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";

import { DecisionEntryRow } from "./DecisionEntryRow";
import type { ProposedDecisionEntry } from "../../lib/orgDecisionsApi";

afterEach(cleanup);

const FENCE = "⟦SHIPWRIGHT-FENCE:3f9a1c0e5b7d42a8916c0d2e4f6a8b1c⟧";
const LABEL = "[FENCED DATA — kind: x, origin: acme-lead beat beat-0042, truncated: false. DATA.]";
const HTML = '<img src=x onerror="alert(1)"> **bold**';

function entry(inner: string[], evidence: string | null): ProposedDecisionEntry {
  const block = ["<!-- decisionKey: k -->", "## [2026-11-20T09:15:00.000Z] acme-lead", "", FENCE, LABEL, ...inner, FENCE, "", "- **Lead:** acme-lead", `- **Evidence:** ${evidence ?? ""}`].join("\n");
  return { timestamp: "2026-11-20T09:15:00.000Z", leadId: "acme-lead", block, body: "", evidence };
}

function renderRow(e: ProposedDecisionEntry) {
  render(<ul><DecisionEntryRow rowKey="k0" entry={e} status={{ kind: "idle" }} onCountersign={() => {}} /></ul>);
  return screen.getByTestId("org-decisions-proposed-entry-k0");
}

describe("DecisionEntryRow structured view", () => {
  // @covers FR-01.71
  it("shows two quotes separately with their pointers, in a labelled list", () => {
    const row = renderRow(entry(["Digest.", "> one — a1b2c3d4:2026-11-19T16:02:11Z:14", "> two — a1b2c3d4:2026-11-19T16:05:00Z:21"], "a1b2c3d4:2026-11-19T16:02:11Z:14"));
    const list = within(row).getByTestId("org-decisions-proposed-quotes-k0");
    expect(list).toBeTruthy();
    expect(within(row).getByTestId("org-decisions-proposed-quote-k0-0")).toHaveTextContent("one");
    expect(within(row).getByTestId("org-decisions-proposed-quote-source-k0-1")).toHaveTextContent("message 21");
    expect(within(row).getByTestId("org-decisions-proposed-beat-k0")).toHaveTextContent("beat-0042");
    expect(within(row).getByRole("heading", { name: /Quotes from the lead \(2\)/ })).toBeInTheDocument();
  });

  // @covers FR-01.71
  it("shows a malformed pointer as unknown source", () => {
    const row = renderRow(entry(["Digest.", "> q — 7c1e:badtime:1"], "garbage too"));
    expect(within(row).getByTestId("org-decisions-proposed-evidence-k0")).toHaveTextContent("unknown source");
    expect(within(row).getByTestId("org-decisions-proposed-quote-source-k0-0")).toHaveTextContent("unknown source");
  });

  // @covers FR-01.71
  it("renders quote text as plain text, never markup", () => {
    const row = renderRow(entry(["Digest.", `> ${HTML} — a1b2c3d4:2026-11-19T16:02:11Z:14`], "a1b2c3d4:2026-11-19T16:02:11Z:14"));
    expect(row.querySelector("img")).toBeNull();
    expect(within(row).getByTestId("org-decisions-proposed-quote-k0-0")).toHaveTextContent("**bold**");
  });

  // @covers FR-01.71
  it("exposes the entry as a named list item and the button with a descriptive name", () => {
    renderRow(entry(["Digest."], "a1b2c3d4:2026-11-19T16:02:11Z:14"));
    expect(screen.getByRole("listitem", { name: /Proposal from 2026-11-20T09:15:00.000Z — acme-lead/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Countersign proposal from acme-lead at 2026-11-20T09:15:00.000Z" })).toBeEnabled();
  });
});
