/*
 * leadQuestionApi.test.ts — FR-04.17/18: `answerLeadQuestion` PATCHes
 * `poFeedback` with the PO's text plus an appended timestamp marker
 * (trap: leadwright's reading side treats an answer with no timestamp
 * as a named error).
 */
import { describe, it, expect, vi, afterEach } from "vitest";

import { answerLeadQuestion } from "./leadQuestionApi";
import type { ExternalTask } from "./externalApi";

describe("answerLeadQuestion", () => {
  afterEach(() => vi.restoreAllMocks());

  it("PATCHes poFeedback with the PO's text plus an ISO timestamp marker", async () => {
    const task = { taskId: "t1" } as unknown as ExternalTask;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ task }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await answerLeadQuestion("t1", "Yes, go ahead.");
    expect(out).toEqual(task);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/external/tasks/t1",
      expect.objectContaining({ method: "PATCH" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.poFeedback).toMatch(/^Yes, go ahead\.\n\n<!-- answered-at:.+-->$/);
    const tsMatch = /<!-- answered-at:([^ ]+) -->/.exec(body.poFeedback as string);
    expect(tsMatch).not.toBeNull();
    expect(new Date(tsMatch![1]).toISOString()).toBe(tsMatch![1]);
  });

  it("trims the PO's answer text before appending the timestamp", async () => {
    const task = { taskId: "t1" } as unknown as ExternalTask;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ task }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await answerLeadQuestion("t1", "  spaced out  ");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.poFeedback.startsWith("spaced out\n\n")).toBe(true);
  });
});
