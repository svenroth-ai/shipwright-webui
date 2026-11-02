import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { peekProbe, probePath, resetPathProbe } from "./pathProbe";

const reply = (results: Array<{ openable: boolean }>, status = 200) =>
  new Response(JSON.stringify({ results }), { status, headers: { "content-type": "application/json" } });

beforeEach(() => resetPathProbe());
afterEach(() => vi.unstubAllGlobals());

// @covers FR-01.66
describe("pathProbe", () => {
  it("coalesces same-tick probes into ONE request and caches the answers per task", async () => {
    const f = vi.fn(async (_u: string, init?: RequestInit) => {
      const { paths } = JSON.parse(String(init?.body)) as { paths: string[] };
      return reply(paths.map((p) => ({ openable: p.startsWith("ok") })));
    });
    vi.stubGlobal("fetch", f);
    const [a, b, c] = await Promise.all([probePath("t1", "ok.md"), probePath("t1", "no.md"), probePath("t1", "ok.md")]);
    expect([a, b, c]).toEqual(["yes", "no", "yes"]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(f.mock.calls[0]![1]?.body)).paths).toEqual(["ok.md", "no.md"]);
    expect(String(f.mock.calls[0]![0])).toContain("/tasks/t1/session-file/probe");
    expect(peekProbe("t1", "ok.md")).toBe("yes");
    expect(peekProbe("t2", "ok.md")).toBeUndefined();
    await probePath("t1", "ok.md");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("splits more than 40 paths into several requests", async () => {
    const f = vi.fn(async (_u: string, init?: RequestInit) => reply((JSON.parse(String(init?.body)) as { paths: string[] }).paths.map(() => ({ openable: true }))));
    vi.stubGlobal("fetch", f);
    await Promise.all(Array.from({ length: 90 }, (_, i) => probePath("t1", `f${i}.md`)));
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("fails OPEN and caches nothing on 429, 500, network errors and malformed bodies", async () => {
    const makers: Array<() => Response> = [
      () => new Response("{}", { status: 429 }),
      () => new Response("x", { status: 500 }),
      () => reply([]),
      () => {
        throw new Error("net");
      },
    ];
    for (const make of makers) {
      resetPathProbe();
      vi.stubGlobal("fetch", vi.fn(async () => make()));
      expect(await probePath("t1", "a.md")).toBe("unknown");
      expect(peekProbe("t1", "a.md")).toBeUndefined();
    }
  });
});
