/*
 * LeadRegisterFinding.test.tsx — iterate spec FR-04.41 component tests:
 * open/fault/unknown/clear rendering, the release button's happy path
 * (query invalidation, no crash), and a visible error on a refused release.
 * Asserts RENDERED text throughout, never internal state.
 */
import type { ReactNode } from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, afterEach } from "vitest";

import { LeadRegisterFinding } from "./LeadRegisterFinding";
import { releaseBeatRegisterEntry } from "../../lib/orgRegisterApi";
import { ApiError } from "../../lib/externalApi";
import type { LeadRegisterView, BeatRegisterEntryView } from "../../lib/orgApi";

vi.mock("../../lib/orgRegisterApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/orgRegisterApi")>();
  return { ...actual, releaseBeatRegisterEntry: vi.fn() };
});

const mockedRelease = vi.mocked(releaseBeatRegisterEntry);

const OPEN_ENTRY: BeatRegisterEntryView = {
  sessionId: "22222222-2222-2222-2222-222222222222",
  beatId: "beat-1",
  leadId: "acme-lead",
  pid: 4242,
  startedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  closedAt: null,
};

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { Wrapper, qc };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("LeadRegisterFinding", () => {
  it("renders nothing for a clear register", () => {
    const { Wrapper } = makeWrapper();
    const register: LeadRegisterView = { leadId: "acme-lead", status: "clear" };
    const { container } = render(
      <Wrapper>
        <LeadRegisterFinding leadId="acme-lead" register={register} />
      </Wrapper>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("an unknown register status reads as not-measured, with no release button", () => {
    const { Wrapper } = makeWrapper();
    const register: LeadRegisterView = { leadId: "acme-lead", status: "unknown" };
    render(
      <Wrapper>
        <LeadRegisterFinding leadId="acme-lead" register={register} />
      </Wrapper>,
    );
    expect(screen.getByTestId("lead-register-finding")).toHaveTextContent(/not measured/);
    expect(screen.queryByTestId("lead-register-release")).not.toBeInTheDocument();
  });

  it("a fault (duplicate session) names the session and offers no release button (server refuses it anyway)", () => {
    const { Wrapper } = makeWrapper();
    const register: LeadRegisterView = {
      leadId: "acme-lead",
      status: "fault",
      reason: "duplicate-session-id",
      sessionId: "33333333-3333-3333-3333-333333333333",
      entries: [OPEN_ENTRY, { ...OPEN_ENTRY, beatId: "beat-2", pid: 2 }],
    };
    render(
      <Wrapper>
        <LeadRegisterFinding leadId="acme-lead" register={register} />
      </Wrapper>,
    );
    const finding = screen.getByTestId("lead-register-finding");
    expect(finding).toHaveTextContent(/Duplicate/);
    expect(finding).toHaveTextContent(/33333333/);
    expect(screen.queryByTestId("lead-register-release")).not.toBeInTheDocument();
  });

  it("an open entry shows a finding naming the beat and a working Release button", async () => {
    vi.stubGlobal("prompt", vi.fn(() => "confirmed dead, restarting"));
    mockedRelease.mockResolvedValue({ ok: true, recovered: true, residualLockWarning: "..." });
    const { Wrapper, qc } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const register: LeadRegisterView = { leadId: "acme-lead", status: "open", entry: OPEN_ENTRY };
    render(
      <Wrapper>
        <LeadRegisterFinding leadId="acme-lead" register={register} />
      </Wrapper>,
    );
    const finding = screen.getByTestId("lead-register-finding");
    expect(finding).toHaveTextContent(/beat-1/);

    fireEvent.click(screen.getByTestId("lead-register-release"));
    await waitFor(() => expect(mockedRelease).toHaveBeenCalledWith(
      "acme-lead",
      OPEN_ENTRY.sessionId,
      "confirmed dead, restarting",
    ));
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(screen.queryByTestId("lead-register-release-error")).not.toBeInTheDocument();
  });

  it("cancelling the reason prompt makes no network call", () => {
    vi.stubGlobal("prompt", vi.fn(() => null));
    const { Wrapper } = makeWrapper();
    const register: LeadRegisterView = { leadId: "acme-lead", status: "open", entry: OPEN_ENTRY };
    render(
      <Wrapper>
        <LeadRegisterFinding leadId="acme-lead" register={register} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId("lead-register-release"));
    expect(mockedRelease).not.toHaveBeenCalled();
  });

  it("a whitespace-only reason makes no network call and surfaces a visible error (external-review fix, GLM — the trim/empty guard was implemented but untested)", () => {
    vi.stubGlobal("prompt", vi.fn(() => "   "));
    const { Wrapper } = makeWrapper();
    const register: LeadRegisterView = { leadId: "acme-lead", status: "open", entry: OPEN_ENTRY };
    render(
      <Wrapper>
        <LeadRegisterFinding leadId="acme-lead" register={register} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId("lead-register-release"));
    expect(mockedRelease).not.toHaveBeenCalled();
    expect(screen.getByTestId("lead-register-release-error")).toHaveTextContent(/reason is required/i);
  });

  it("an error clears when the register entry's identity changes (code-review fix — a stale error must not misattribute to a new entry)", async () => {
    vi.stubGlobal("prompt", vi.fn(() => "trying to release"));
    mockedRelease.mockResolvedValue({ ok: false, reason: "not-found", detail: "vanished" });
    const { Wrapper } = makeWrapper();
    const register: LeadRegisterView = { leadId: "acme-lead", status: "open", entry: OPEN_ENTRY };
    const { rerender } = render(
      <Wrapper>
        <LeadRegisterFinding leadId="acme-lead" register={register} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId("lead-register-release"));
    await screen.findByTestId("lead-register-release-error");

    const nextEntry: BeatRegisterEntryView = { ...OPEN_ENTRY, sessionId: "44444444-4444-4444-4444-444444444444" };
    const nextRegister: LeadRegisterView = { leadId: "acme-lead", status: "open", entry: nextEntry };
    rerender(
      <Wrapper>
        <LeadRegisterFinding leadId="acme-lead" register={nextRegister} />
      </Wrapper>,
    );
    expect(screen.queryByTestId("lead-register-release-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("lead-register-release")).not.toBeDisabled();
  });

  it("a refused release (not-found) surfaces the error visibly, button re-enabled, AND still invalidates the roster (external-review fix — the finding may be stale either way)", async () => {
    vi.stubGlobal("prompt", vi.fn(() => "trying to release"));
    mockedRelease.mockResolvedValue({ ok: false, reason: "not-found", detail: "vanished" });
    const { Wrapper, qc } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const register: LeadRegisterView = { leadId: "acme-lead", status: "open", entry: OPEN_ENTRY };
    render(
      <Wrapper>
        <LeadRegisterFinding leadId="acme-lead" register={register} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId("lead-register-release"));
    const errorEl = await screen.findByTestId("lead-register-release-error");
    expect(errorEl).toHaveTextContent(/vanished/);
    expect(screen.getByTestId("lead-register-release")).not.toBeDisabled();
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it("a thrown ApiError (e.g. symlink_forbidden, beat_register_locked) surfaces its code visibly, button re-enabled, and still invalidates the roster (code-review fix)", async () => {
    vi.stubGlobal("prompt", vi.fn(() => "trying to release"));
    mockedRelease.mockRejectedValue(new ApiError("beat_register_locked", 409, {}));
    const { Wrapper, qc } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const register: LeadRegisterView = { leadId: "acme-lead", status: "open", entry: OPEN_ENTRY };
    render(
      <Wrapper>
        <LeadRegisterFinding leadId="acme-lead" register={register} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId("lead-register-release"));
    const errorEl = await screen.findByTestId("lead-register-release-error");
    expect(errorEl).toHaveTextContent(/beat_register_locked/);
    expect(screen.getByTestId("lead-register-release")).not.toBeDisabled();
    expect(invalidateSpy).toHaveBeenCalled();
  });
});
