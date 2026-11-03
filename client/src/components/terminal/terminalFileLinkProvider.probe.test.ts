import type { ILink } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetPathProbe } from "../../lib/pathProbe";
import { createFileLinkProvider, type LinkTerm } from "./terminalFileLinkProvider";
import { probeTerminalRefs } from "./useTerminalFileLinks";

function fakeTerm(text: string, cols = 60): LinkTerm {
  const cells = Array.from(text).map((ch) => ({ chars: ch, width: 1 }));
  while (cells.length < cols) cells.push({ chars: "", width: 1 });
  const line = {
    isWrapped: false,
    getCell: (x: number) => {
      const c = cells[x];
      return c ? { getWidth: () => c.width, getChars: () => c.chars } : undefined;
    },
  };
  return { cols, hasSelection: () => false, buffer: { active: { getLine: (i: number) => (i === 0 ? line : undefined) } } } as unknown as LinkTerm;
}

const ask = (term: LinkTerm, filter?: (refs: { path: string }[]) => Promise<boolean[]>) =>
  new Promise<ILink[]>((resolve) => {
    createFileLinkProvider(term, vi.fn(), () => true, filter as never).provideLinks(1, (l) => resolve(l ?? []));
  });

beforeEach(() => resetPathProbe());
afterEach(() => vi.unstubAllGlobals());

// @covers FR-01.66
describe("terminal file links are offered only when openable", () => {
  it("drops the links the filter rejects and keeps the rest (asynchronously, never blocking)", async () => {
    const term = fakeTerm("see src/real.ts and docs/ghost.md ok");
    const links = await ask(term, async (refs) => refs.map((r) => r.path !== "docs/ghost.md"));
    expect(links.map((l) => l.text)).toEqual(["src/real.ts"]);
  });

  it("offers no link at all when every candidate is dead", async () => {
    expect(await ask(fakeTerm("see docs/ghost.md ok"), async (refs) => refs.map(() => false))).toEqual([]);
  });

  it("fails open when the filter throws", async () => {
    const links = await ask(fakeTerm("see src/real.ts ok"), () => Promise.reject(new Error("net")));
    expect(links.map((l) => l.text)).toEqual(["src/real.ts"]);
  });

  it("without a filter the provider stays synchronous and unchanged", () => {
    let out: ILink[] = [];
    createFileLinkProvider(fakeTerm("see src/real.ts ok"), vi.fn()).provideLinks(1, (l) => {
      out = l ?? [];
    });
    expect(out).toHaveLength(1);
  });
});

// @covers FR-01.66
describe("probeTerminalRefs", () => {
  const open = { projectRoot: "C:\\dev\\app", cwd: "C:\\dev\\app", open: vi.fn() };

  it("asks the server with the resolved viewer path and says false only for a definite no", async () => {
    const f = vi.fn(async (_u: string, init?: RequestInit) => {
      const { paths } = JSON.parse(String(init?.body)) as { paths: string[] };
      return new Response(JSON.stringify({ results: paths.map((p) => ({ openable: p !== "docs/ghost.md" })) }), { status: 200 });
    });
    vi.stubGlobal("fetch", f);
    const out = await probeTerminalRefs([{ path: "src/a.ts" }, { path: "docs/ghost.md" }], "t1", open);
    expect(out).toEqual([true, false]);
    expect(f).toHaveBeenCalledTimes(1); // batched into one request
  });

  it("keeps every link while the task context is not ready, and on an inconclusive probe", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    expect(await probeTerminalRefs([{ path: "src/a.ts" }], "t1", { ...open, ready: false })).toEqual([true]);
    expect(await probeTerminalRefs([{ path: "src/a.ts" }], "t1", undefined)).toEqual([true]);
    expect(await probeTerminalRefs([{ path: "src/a.ts" }], "t1", open)).toEqual([true]);
  });

  it("optimistic (touch): answers at once from the cache - unknown stays a link and is probed for next time, a cached no hides it", async () => {
    const f = vi.fn(async (_u: string, init?: RequestInit) => {
      const { paths } = JSON.parse(String(init?.body)) as { paths: string[] };
      return new Response(JSON.stringify({ results: paths.map((p) => ({ openable: p !== "docs/ghost.md" })) }), { status: 200 });
    });
    vi.stubGlobal("fetch", f);
    const refs = [{ path: "src/a.ts" }, { path: "docs/ghost.md" }];
    expect(await probeTerminalRefs(refs, "t2", open, true)).toEqual([true, true]); // nothing cached yet: no waiting, no hiding
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(1)); // ...but the background probe ran
    await vi.waitFor(async () => expect(await probeTerminalRefs(refs, "t2", open, true)).toEqual([true, false]));
  });
});
