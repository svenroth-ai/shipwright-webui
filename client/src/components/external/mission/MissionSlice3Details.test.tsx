/*
 * MissionSlice3Details.test.tsx — S3 AC1/AC3 on the render side.
 *
 * What these pin, beyond "it renders":
 *   - an unrecorded test count reads "not recorded", NEVER "0 of 0 passed";
 *   - the ACTIVE unit's own commit/branch are shown, never a sibling's;
 *   - the basis for calling a unit active is VISIBLE, not implied;
 *   - recorded output paths render as text, never as links (AC3).
 *
 * @covers FR-01.66
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  CampaignProgressDetail,
  PhaseDetail,
  SubIterateDetail,
} from "./MissionSlice3Details";
import type { ArtifactDescriptor } from "../../../lib/missionContextApi";

type Of<K extends ArtifactDescriptor["kind"]> = Extract<ArtifactDescriptor, { kind: K }>;

function phase(over: Partial<Of<"phase">["detail"]> = {}): Of<"phase"> {
  return {
    kind: "phase",
    label: "Phase",
    state: "available",
    summary: "Build for 02-ui — running now.",
    receipt: "Build · 02-ui",
    detail: {
      type: "phase",
      runId: "run-a1b2c3d4",
      phase: "build",
      splitId: "02-ui",
      status: "in_progress",
      slashCommand: "/shipwright-build",
      title: "Run-a1b2 / build / 02-ui",
      description: null,
      startedAt: "2026-04-25T10:00:00.000Z",
      completedAt: null,
      executionCount: 1,
      errors: [],
      outputs: [],
      ...over,
    },
  } as Of<"phase">;
}

function subIterate(over: Partial<Of<"sub_iterate">["detail"]> = {}): Of<"sub_iterate"> {
  return {
    kind: "sub_iterate",
    label: "Current unit",
    state: "available",
    summary: "S2 — tests is running now.",
    receipt: "S2",
    detail: {
      type: "sub_iterate",
      id: "S2",
      title: "tests",
      status: "in_progress",
      selectedBy: "in_progress",
      documentId: null,
      documentTitle: null,
      commit: null,
      branch: "iterate/S2",
      testsPassed: null,
      testsTotal: null,
      ...over,
    },
  } as Of<"sub_iterate">;
}

describe("PhaseDetail", () => {
  it("translates the status enum into words", () => {
    render(<PhaseDetail artifact={phase()} />);
    expect(screen.getByTestId("artifact-phase-status")).toHaveTextContent("running now");
    expect(screen.queryByText("in_progress")).toBeNull();
  });

  it("shows the split as a readable 'Part', and the pipeline run id", () => {
    render(<PhaseDetail artifact={phase()} />);
    expect(screen.getByTestId("artifact-phase-meta")).toHaveTextContent("02-ui");
    expect(screen.getByTestId("artifact-phase-meta")).toHaveTextContent("run-a1b2c3d4");
  });

  it("lists what went wrong for a failed phase", () => {
    render(<PhaseDetail artifact={phase({ status: "failed", errors: ["typecheck failed"] })} />);
    expect(screen.getByTestId("artifact-phase-errors")).toHaveTextContent("typecheck failed");
  });

  it("AC3 — recorded outputs render as TEXT, never as links", () => {
    render(<PhaseDetail artifact={phase({ outputs: ["planning/requirements.md"] })} />);
    const list = screen.getByTestId("artifact-phase-outputs");
    expect(list).toHaveTextContent("planning/requirements.md");
    expect(list.querySelectorAll("a")).toHaveLength(0);
  });

  it("hides the attempts row for a single, ordinary run", () => {
    render(<PhaseDetail artifact={phase({ executionCount: 1 })} />);
    expect(screen.getByTestId("artifact-phase-meta")).not.toHaveTextContent("Attempts");
  });

  it("surfaces a RE-run — a phase executed more than once is worth knowing", () => {
    render(<PhaseDetail artifact={phase({ executionCount: 3 })} />);
    expect(screen.getByTestId("artifact-phase-meta")).toHaveTextContent("Attempts");
  });

  it("says so plainly when there is no detail at all", () => {
    render(<PhaseDetail artifact={{ ...phase(), detail: null }} />);
    expect(screen.getByText(/no pipeline step details/i)).toBeInTheDocument();
  });
});

describe("CampaignProgressDetail", () => {
  const artifact: Of<"campaign_progress"> = {
    kind: "campaign_progress",
    label: "Campaign progress",
    state: "available",
    summary: "1 of 2 units complete. Currently on S2.",
    receipt: "1/2 complete",
    detail: {
      type: "campaign_progress",
      slug: "2026-07-18-mission-artifacts",
      lifecycle: "active",
      branchStrategy: "serial",
      done: 1,
      total: 2,
      rows: [
        { id: "S1", title: "resolver", status: "complete", active: false },
        { id: "S2", title: "tests", status: "in_progress", active: true },
      ],
    },
  };

  it("lists every unit with a plain-language status", () => {
    render(<CampaignProgressDetail artifact={artifact} />);
    const rows = screen.getByTestId("artifact-campaign-rows");
    expect(rows).toHaveTextContent("S1 — resolver");
    expect(rows).toHaveTextContent("complete");
    expect(rows).toHaveTextContent("running now");
  });

  it("marks exactly one row as current", () => {
    render(<CampaignProgressDetail artifact={artifact} />);
    const active = screen
      .getByTestId("artifact-campaign-rows")
      .querySelectorAll('[data-active="true"]');
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent("S2");
  });

  it("explains `serial` rather than showing the raw keyword", () => {
    render(<CampaignProgressDetail artifact={artifact} />);
    expect(screen.getByTestId("artifact-campaign-meta")).toHaveTextContent("one after another");
  });
});

describe("SubIterateDetail", () => {
  const doc = (id: string) => <span data-testid="doc">{id}</span>;

  it("states WHY this unit is the current one", () => {
    render(<SubIterateDetail artifact={subIterate()} renderDocument={doc} />);
    expect(screen.getByTestId("artifact-sub-basis")).toHaveTextContent("running now");
  });

  it("explains a first_incomplete pick differently from a running one", () => {
    render(
      <SubIterateDetail artifact={subIterate({ selectedBy: "first_incomplete", status: "pending" })} renderDocument={doc} />,
    );
    expect(screen.getByTestId("artifact-sub-basis")).toHaveTextContent("first unit that has not finished");
  });

  it("an UNRECORDED test count reads 'not recorded' — never 0 of 0", () => {
    render(<SubIterateDetail artifact={subIterate()} renderDocument={doc} />);
    const tests = screen.getByTestId("artifact-sub-tests");
    expect(tests).toHaveTextContent("not recorded");
    expect(tests).not.toHaveTextContent("0 of 0");
  });

  it("shows a real recorded count when there is one", () => {
    render(
      <SubIterateDetail artifact={subIterate({ testsPassed: 5107, testsTotal: 5108 })} renderDocument={doc} />,
    );
    expect(screen.getByTestId("artifact-sub-tests")).toHaveTextContent("5107 of 5108 passed");
  });

  it("shows a genuine zero-pass result rather than swallowing it", () => {
    // 0 of 12 is a REAL, alarming result. Only null means "not recorded".
    render(
      <SubIterateDetail artifact={subIterate({ testsPassed: 0, testsTotal: 12 })} renderDocument={doc} />,
    );
    expect(screen.getByTestId("artifact-sub-tests")).toHaveTextContent("0 of 12 passed");
  });

  it("shows the ACTIVE unit's own branch and commit", () => {
    render(
      <SubIterateDetail artifact={subIterate({ commit: "0f9a9788ffff", branch: "iterate/S2" })} renderDocument={doc} />,
    );
    const meta = screen.getByTestId("artifact-sub-meta");
    expect(meta).toHaveTextContent("iterate/S2");
    expect(meta).toHaveTextContent("0f9a9788ffff");
  });

  it("omits the commit row entirely for a unit that has not committed", () => {
    render(<SubIterateDetail artifact={subIterate({ commit: null })} renderDocument={doc} />);
    expect(screen.getByTestId("artifact-sub-meta")).not.toHaveTextContent("Commit");
  });

  it("renders the unit's own document when it has one", () => {
    render(<SubIterateDetail artifact={subIterate({ documentId: "sub-doc-id" })} renderDocument={doc} />);
    expect(screen.getByTestId("doc")).toHaveTextContent("sub-doc-id");
  });

  it("says so honestly when the unit has no brief on disk — no dead link", () => {
    render(<SubIterateDetail artifact={subIterate()} renderDocument={doc} />);
    expect(screen.getByText(/no written brief on disk/i)).toBeInTheDocument();
    expect(screen.queryByTestId("doc")).toBeNull();
  });
});
