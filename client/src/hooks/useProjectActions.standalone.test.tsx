/**
 * Standalone view: without the user's own actions.json only plain Claude is
 * offered; with one, exactly the configured actions.
 * @covers FR-01.51
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";

import { server } from "../test/mocks/server";
import { setStandaloneViewEnabled } from "../lib/standaloneView";
import { useProjectActions } from "./useProjectActions";

const act = (id: string) => ({ id, label: id, kind: "external_launch", description: id });

function respond(fromUser: boolean, ids: string[]) {
  server.use(
    http.get("/api/external/projects/:id/actions", () =>
      HttpResponse.json({
        actions: ids.map(act),
        phases: [],
        defaults: { autonomy: "guided" },
        preview: { enabled: false, command: null, port: null, ready_path: null, ready_timeout_seconds: null },
        diagnostics: [],
        fromUser,
      }),
    ),
  );
}

function ids(standalone: boolean) {
  setStandaloneViewEnabled(standalone);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useProjectActions("p1"), { wrapper });
}

afterEach(() => setStandaloneViewEnabled(false));

describe("useProjectActions in Standalone view", () => {
  // @covers FR-01.51
  it("bundled default catalog collapses to plain Claude only", async () => {
    respond(false, ["new-plain", "new-iterate", "new-task"]);
    const { result } = ids(true);
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.actions.map((a) => a.id)).toEqual(["new-plain"]);
  });

  // @covers FR-01.51
  it("a user actions.json is shown exactly as configured", async () => {
    respond(true, ["new-plain", "my-custom"]);
    const { result } = ids(true);
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.actions.map((a) => a.id)).toEqual(["new-plain", "my-custom"]);
  });

  // @covers FR-01.51
  it("outside Standalone the bundled catalog stays complete", async () => {
    respond(false, ["new-plain", "new-iterate"]);
    const { result } = ids(false);
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.actions).toHaveLength(2);
  });
});
