/*
 * VerdictStep.test.tsx — code-review fix: no test previously exercised the
 * verdict/finish step's render branches (committed / verdict_stale /
 * lead_exists / locked / daemon_config_missing / error / notConfigured /
 * ranOk===false) or the auto-retry-on-verdict_stale effect. Both hooks are
 * mocked directly (OrgPage.test.tsx's idiom for hook-driven components),
 * not through react-query — the point is VerdictStep's own branching.
 */
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

import { VerdictStep } from "./VerdictStep";
import { useLeadwrightVerdict } from "./useLeadwrightVerdict";
import { useLeadwrightCommit } from "./useLeadwrightCommit";
import type { LeadSetupAnswers } from "./types";
import { EMPTY_AUTHORITY_BANDS } from "./types";

vi.mock("./useLeadwrightVerdict");
vi.mock("./useLeadwrightCommit");

const mockedVerdict = vi.mocked(useLeadwrightVerdict);
const mockedCommit = vi.mocked(useLeadwrightCommit);

const COMPLETE_ANSWERS: LeadSetupAnswers = {
  name: "Acme Lead",
  leadId: "acme-lead",
  domain: "billing",
  projectId: "p1",
  projectName: "Project One",
  projectPath: "/abs/p1",
  actionId: "/x",
  slashCommand: "/content-orchestrator",
  cadenceKey: "hourly",
  wakeOnAnswer: false,
  budgetUsd: "50",
  pauseAt: "0.85",
  hardStopAt: "0.95",
  authorityBands: { ...EMPTY_AUTHORITY_BANDS, "Decide alone": "Ship routine content." },
  maxConcurrentTasks: "2",
  model: "balanced",
  escalationTarget: "po-sven",
};

function verdictState(overrides: Partial<ReturnType<typeof useLeadwrightVerdict>> = {}) {
  return {
    loading: false,
    error: false,
    notConfigured: false,
    ranOk: true,
    ok: true,
    reason: null,
    proposalDigest: "digest-1",
    findings: [],
    refetch: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useLeadwrightVerdict>;
}

function commitState(overrides: Partial<ReturnType<typeof useLeadwrightCommit>> = {}) {
  return {
    data: undefined,
    isPending: false,
    mutate: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useLeadwrightCommit>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderStep(answers: LeadSetupAnswers = COMPLETE_ANSWERS) {
  return render(<VerdictStep answers={answers} dispatch={vi.fn()} />);
}

describe("VerdictStep", () => {
  it("blocks Finish and shows the leadwright-unreachable state when not configured", () => {
    mockedVerdict.mockReturnValue(verdictState({ notConfigured: true, ranOk: null, proposalDigest: null }));
    mockedCommit.mockReturnValue(commitState());
    renderStep();
    expect(screen.getByTestId("lead-wizard-leadwright-unreachable")).toBeInTheDocument();
    expect(screen.getByTestId("lead-wizard-finish")).toBeDisabled();
  });

  it("shows the verdict-could-not-run reason and blocks Finish when ranOk is false", () => {
    mockedVerdict.mockReturnValue(verdictState({ ranOk: false, reason: "leadwright checkout is stale" }));
    mockedCommit.mockReturnValue(commitState());
    renderStep();
    expect(screen.getByTestId("lead-wizard-verdict-ran-not-ok")).toHaveTextContent("leadwright checkout is stale");
    expect(screen.getByTestId("lead-wizard-finish")).toBeDisabled();
  });

  it("enables Finish once the verdict ran ok and every path is absolute", () => {
    mockedVerdict.mockReturnValue(verdictState());
    mockedCommit.mockReturnValue(commitState());
    renderStep();
    expect(screen.getByTestId("lead-wizard-finish")).not.toBeDisabled();
  });

  it("blocks Finish on a RED verdict (transport ran, but PreflightResult.ok is false) — external-review fix", () => {
    mockedVerdict.mockReturnValue(
      verdictState({
        ok: false,
        findings: [{ key: "a", layer: "MUSS", satisfied: false, message: "domain must be set" }],
      }),
    );
    mockedCommit.mockReturnValue(commitState());
    renderStep();
    expect(screen.getByTestId("lead-wizard-verdict-not-ok")).toBeInTheDocument();
    expect(screen.getByTestId("lead-wizard-finish")).toBeDisabled();
  });

  it("groups findings by layer under their labelled section", () => {
    mockedVerdict.mockReturnValue(
      verdictState({
        findings: [
          { key: "a", layer: "MUSS", satisfied: false, message: "domain must be set" },
          { key: "b", layer: "advisory", satisfied: true, message: "consider a tighter cadence" },
        ],
      }),
    );
    mockedCommit.mockReturnValue(commitState());
    renderStep();
    expect(screen.getByTestId("lead-wizard-findings-MUSS")).toHaveTextContent("domain must be set");
    expect(screen.getByTestId("lead-wizard-findings-advisory")).toHaveTextContent("consider a tighter cadence");
    expect(screen.queryByTestId("lead-wizard-findings-KANN")).toBeNull();
  });

  it("shows the non-dismissable restart notice and swaps to the done view on committed", () => {
    mockedVerdict.mockReturnValue(verdictState());
    mockedCommit.mockReturnValue(
      commitState({
        data: { kind: "committed", leadId: "acme-lead", restartRequired: true, restartNotice: "restart the daemon" },
      }),
    );
    renderStep();
    expect(screen.getByTestId("lead-wizard-restart-notice")).toHaveTextContent("restart the daemon");
    expect(screen.queryByTestId("lead-wizard-finish")).toBeNull();
  });

  it("shows the lead_exists message without touching the auto-retry path", () => {
    mockedVerdict.mockReturnValue(verdictState());
    mockedCommit.mockReturnValue(commitState({ data: { kind: "lead_exists" } }));
    renderStep();
    expect(screen.getByTestId("lead-wizard-lead-exists")).toBeInTheDocument();
  });

  it("shows the server's own red re-verification message on kind:verdict_not_ok — external-review fix (security)", () => {
    mockedVerdict.mockReturnValue(verdictState());
    mockedCommit.mockReturnValue(
      commitState({
        data: { kind: "verdict_not_ok", findings: [{ key: "domain", layer: "MUSS", satisfied: false, message: "domain must be set" }] },
      }),
    );
    renderStep();
    expect(screen.getByTestId("lead-wizard-commit-verdict-not-ok")).toBeInTheDocument();
  });

  it("shows the locked message on a transient lock conflict", () => {
    mockedVerdict.mockReturnValue(verdictState());
    mockedCommit.mockReturnValue(commitState({ data: { kind: "locked" } }));
    renderStep();
    expect(screen.getByTestId("lead-wizard-commit-locked")).toBeInTheDocument();
  });

  it("shows the daemon-config fragment to copy by hand when daemon-config.json is missing", () => {
    mockedVerdict.mockReturnValue(verdictState());
    mockedCommit.mockReturnValue(
      commitState({ data: { kind: "daemon_config_missing", fragment: '{"leadProjectRoots":{}}' } }),
    );
    renderStep();
    expect(screen.getByTestId("lead-wizard-daemon-config-missing")).toHaveTextContent('{"leadProjectRoots":{}}');
  });

  it("shows a generic error message on kind:error", () => {
    mockedVerdict.mockReturnValue(verdictState());
    mockedCommit.mockReturnValue(
      commitState({ data: { kind: "error", error: { message: "boom" } as never } }),
    );
    renderStep();
    expect(screen.getByTestId("lead-wizard-commit-error")).toBeInTheDocument();
  });

  it("clicking Finish calls commit.mutate with the proposal, charter content and proposal digest", () => {
    mockedVerdict.mockReturnValue(verdictState());
    const mutate = vi.fn();
    mockedCommit.mockReturnValue(commitState({ mutate }));
    renderStep();
    fireEvent.click(screen.getByTestId("lead-wizard-finish"));
    expect(mutate).toHaveBeenCalledTimes(1);
    const arg = mutate.mock.calls[0][0];
    expect(arg.expectedProposalDigest).toBe("digest-1");
    expect(arg.proposal.leadId).toBe("acme-lead");
  });

  it("dispatches back", () => {
    mockedVerdict.mockReturnValue(verdictState());
    mockedCommit.mockReturnValue(commitState());
    const dispatch = vi.fn();
    render(<VerdictStep answers={COMPLETE_ANSWERS} dispatch={dispatch} />);
    fireEvent.click(screen.getByTestId("lead-wizard-back"));
    expect(dispatch).toHaveBeenCalledWith({ t: "back" });
  });

  it("auto-retries the verdict exactly once on verdict_stale, not again on a second stale result", async () => {
    const refetch = vi.fn();
    mockedVerdict.mockReturnValue(verdictState({ refetch }));
    mockedCommit.mockReturnValue(commitState({ data: { kind: "verdict_stale" } }));
    const { rerender } = renderStep();

    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("lead-wizard-verdict-stale")).toBeInTheDocument();

    // A second verdict_stale (e.g. re-render with the same mutation data)
    // must NOT trigger a second refetch — the autoRetried flag only resets
    // once commitResult.kind leaves "verdict_stale".
    rerender(<VerdictStep answers={COMPLETE_ANSWERS} dispatch={vi.fn()} />);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
