import { afterEach, describe, expect, it, vi } from "vitest";

import { isRefusedBySession } from "./sessionFileApi";

function reply(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe("isRefusedBySession", () => {
  afterEach(() => vi.unstubAllGlobals());

  // @covers FR-01.28
  it("is true for 403 path_not_evidenced", async () => {
    vi.stubGlobal("fetch", reply(403, { error: "path_not_evidenced" }));
    expect(await isRefusedBySession("t1", "/x/a.ts")).toBe(true);
  });

  // @covers FR-01.28
  it("is false for 403 with a truncated evidence window (could not check, not refused)", async () => {
    vi.stubGlobal("fetch", reply(403, { error: "path_not_evidenced", detail: "evidence_window_truncated" }));
    expect(await isRefusedBySession("t1", "/x/a.ts")).toBe(false);
  });

  // @covers FR-01.28
  it("is false for 200, 404, 500 and for a network failure (the Viewer reports those itself)", async () => {
    for (const s of [200, 404, 500]) {
      vi.stubGlobal("fetch", reply(s, { error: "x" }));
      expect(await isRefusedBySession("t1", "/x/a.ts"), String(s)).toBe(false);
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await isRefusedBySession("t1", "/x/a.ts")).toBe(false);
  });
});
