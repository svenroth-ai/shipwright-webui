/*
 * useGradeReport hook tests (A09b, FR-01.53 — AC5/AC6).
 *
 * RED on pre-A09b main (the module does not exist), green after. Drives the
 * hook over MSW so every mapping from a server grade OUTCOME to the wizard's
 * GradeReportState is asserted — and the honesty invariant that nothing is
 * fetched until the caller enables it (a bare /wizard/grade spawns no grade).
 */

import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import React from "react";

import { useGradeReport } from "./useGradeReport";
import { GRADE_REPORT } from "./stubData";
import { server } from "../../../test/mocks/server";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

function mockGrade(outcome: unknown, status = 200) {
  server.use(http.post("/api/wizard/grade", () => HttpResponse.json(outcome as object, { status })));
}

describe("useGradeReport — enablement gate", () => {
  it("is idle and fetches NOTHING when disabled or target is null", async () => {
    let hit = false;
    server.use(http.post("/api/wizard/grade", () => {
      hit = true;
      return HttpResponse.json({ status: "report-ready", model: GRADE_REPORT });
    }));
    const { result } = renderHook(
      () => useGradeReport(null, { isRemote: false, enabled: true }),
      { wrapper: wrapper() },
    );
    expect(result.current.state).toBe("idle");
    // And a target with enabled:false is equally inert.
    renderHook(() => useGradeReport("C:/repo", { isRemote: false, enabled: false }), {
      wrapper: wrapper(),
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(hit).toBe(false);
  });
});

describe("useGradeReport — outcome → state mapping", () => {
  it("report-ready + a valid model → report-ready with the shape-guarded model", async () => {
    mockGrade({ status: "report-ready", model: GRADE_REPORT });
    const { result } = renderHook(
      () => useGradeReport("C:/repo", { isRemote: false, enabled: true }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.state).toBe("report-ready"));
    expect(result.current.model?.grade).toBe(GRADE_REPORT.grade);
  });

  it("report-ready but a bad shape → shape-unrecognised (the guard refuses it)", async () => {
    mockGrade({ status: "report-ready", model: { schema_version: "1.0", grade: "A" } });
    const { result } = renderHook(
      () => useGradeReport("C:/repo", { isRemote: false, enabled: true }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.state).toBe("shape-unrecognised"));
    expect(result.current.model).toBeNull();
  });

  it("engine-unavailable → carries the reason + repair command", async () => {
    mockGrade({
      status: "engine-unavailable",
      reason: "The grade engine isn't installed.",
      repairCommand: "npx @svenroth-ai/shipwright@latest",
    });
    const { result } = renderHook(
      () => useGradeReport("https://github.com/a/b", { isRemote: true, enabled: true }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.state).toBe("engine-unavailable"));
    expect(result.current.repairCommand).toContain("npx");
  });

  it("grade-failed → carries the honest reason, no model", async () => {
    mockGrade({ status: "grade-failed", reason: "path does not exist" });
    const { result } = renderHook(
      () => useGradeReport("C:/ghost", { isRemote: false, enabled: true }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.state).toBe("grade-failed"));
    expect(result.current.reason).toContain("path does not exist");
    expect(result.current.model).toBeNull();
  });

  it("a network failure → grade-failed (an honest failure, never a fabricated card)", async () => {
    server.use(http.post("/api/wizard/grade", () => HttpResponse.error()));
    const { result } = renderHook(
      () => useGradeReport("C:/repo", { isRemote: false, enabled: true }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.state).toBe("grade-failed"));
  });
});
