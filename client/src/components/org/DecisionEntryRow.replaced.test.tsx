import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

import { DecisionEntryRow } from "./DecisionEntryRow";

afterEach(cleanup);

const NONCE = "3f9a1c0e5b7d42a8916c0d2e4f6a8b1c";
const TS = "2026-11-20T09:15:00.000Z";
const fenced = (line: string) => ({
  timestamp: TS,
  leadId: "acme-lead",
  block:
    `<!-- decisionKey: k1 -->\n## Proposed ${TS} — k1\n\n⟦SHIPWRIGHT-FENCE:${NONCE}⟧\n[FENCED DATA — origin: acme-lead beat b1, x]\n${line}\n⟦SHIPWRIGHT-FENCE:${NONCE}⟧\n\n- **Lead:** acme-lead\n- **Evidence:** card 1\n`,
  body: "",
  evidence: "card 1",
});
const ONE = fenced("Version one.");
const TWO = fenced("Version two.");
const ROW = `${TS}|acme-lead|0`;
const ui = (entry: ReturnType<typeof fenced>) => (
  <DecisionEntryRow rowKey={ROW} entry={entry} status={{ kind: "idle" }} onCountersign={vi.fn()} onReject={vi.fn()} isRepeat={false} />
);

describe("an open edit that a refetch replaced (limits closeout)", () => {
  // @covers FR-01.71
  it("stays flagged when the version comes back (A -> B -> A) until the operator edits again", () => {
    const { rerender } = render(ui(ONE));
    fireEvent.click(screen.getByTestId(`org-decisions-proposed-edit-${ROW}`));
    fireEvent.change(screen.getByLabelText("Line for the decisions log"), { target: { value: "My wording." } });
    rerender(ui(TWO));
    expect(screen.getByTestId(`org-decisions-proposed-changed-${ROW}`)).toHaveTextContent("Your open edit was replaced");
    rerender(ui(ONE)); // back to the version the operator had opened: the marker is gone, the draft was reset
    expect(screen.queryByTestId(`org-decisions-proposed-changed-${ROW}`)).toBeNull();
    expect(screen.getByTestId(`org-decisions-proposed-edit-replaced-${ROW}`)).toBeInTheDocument();
    expect((screen.getByLabelText("Line for the decisions log") as HTMLTextAreaElement).value).toBe("Version one.");
    fireEvent.change(screen.getByLabelText("Line for the decisions log"), { target: { value: "New wording." } });
    expect(screen.queryByTestId(`org-decisions-proposed-edit-replaced-${ROW}`)).toBeNull();
  });
});
