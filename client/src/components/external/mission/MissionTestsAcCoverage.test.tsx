/*
 * MissionTestsAcCoverage.test.tsx — the per-AC regrouping of the Tests
 * artifact's rows (triage card placed 2026-09-06, unblocked 2026-09-08 by
 * campaign req3-06-mechanics-webui's w3/w5).
 *
 * The one invariant that matters: `tagged: false` — the real-repo shape
 * today (0/33 requirements carry `ac_id`) — must render an explicit "not
 * yet tagged" note, never an empty table and never "0 tests".
 *
 * @covers FR-01.66
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { MissionTestsAcCoverage } from "./MissionTestsAcCoverage";

describe("MissionTestsAcCoverage", () => {
  it("shows an explicit 'not yet tagged' note when nothing carries an ac_id — the real-repo default", () => {
    render(<MissionTestsAcCoverage acCoverage={{ tagged: false, groups: [] }} manifestStatus="ok" />);
    expect(screen.getByTestId("artifact-tests-ac-absent")).toHaveTextContent(/not yet tagged/i);
    expect(screen.queryByTestId("artifact-tests-ac-groups")).not.toBeInTheDocument();
  });

  it("groups files under their (AC, requirement) heading", () => {
    render(
      <MissionTestsAcCoverage
        acCoverage={{
          tagged: true,
          groups: [
            {
              frId: "FR-01.11",
              acId: "AC07",
              files: [
                { path: "server/src/example.test.ts", kind: "added" },
                { path: "server/src/other.test.ts", kind: "modified" },
              ],
            },
          ],
        }}
        manifestStatus="ok"
      />,
    );
    expect(screen.queryByTestId("artifact-tests-ac-absent")).not.toBeInTheDocument();
    const group = screen.getByTestId("artifact-tests-ac-group");
    expect(group).toHaveTextContent("AC07 — FR-01.11");
    const files = screen.getAllByTestId("artifact-tests-ac-group-file");
    expect(files).toHaveLength(2);
    expect(files[0]).toHaveTextContent("server/src/example.test.ts");
    expect(files[0]).toHaveTextContent("added");
    expect(files[1]).toHaveTextContent("changed");
  });

  it("renders TWO groups for the same FR when its files tag different ACs, without cross-contamination", () => {
    render(
      <MissionTestsAcCoverage
        acCoverage={{
          tagged: true,
          groups: [
            { frId: "FR-01.11", acId: "AC07", files: [{ path: "a.test.ts", kind: "added" }] },
            { frId: "FR-01.11", acId: "AC09", files: [{ path: "b.test.ts", kind: "removed" }] },
          ],
        }}
        manifestStatus="ok"
      />,
    );
    const groups = screen.getAllByTestId("artifact-tests-ac-group");
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveTextContent("AC07 — FR-01.11");
    expect(groups[0]).not.toHaveTextContent("b.test.ts");
    expect(groups[1]).toHaveTextContent("AC09 — FR-01.11");
    expect(groups[1]).not.toHaveTextContent("a.test.ts");
  });

  it("renders nothing when the traceability manifest itself is unavailable — 'not yet tagged' would be a false certainty there", () => {
    const { container } = render(
      <MissionTestsAcCoverage acCoverage={{ tagged: false, groups: [] }} manifestStatus="unavailable" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
