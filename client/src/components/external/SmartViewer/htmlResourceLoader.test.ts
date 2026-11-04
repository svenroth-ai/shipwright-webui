import { afterEach, describe, expect, it, vi } from "vitest";

import { inlineCssResources, inlineHtmlAssets } from "./htmlInlineAssets";
import { fakeLoader } from "./htmlInlineAssets.fakeLoader";
import { resolveAssetPath } from "./htmlMarkupScan";
import { createResourceLoader } from "./htmlResourceLoader";

// @covers FR-01.02
describe("resolveAssetPath", () => {
  it("resolves against a project-relative page and clamps at the project root", () => {
    expect(resolveAssetPath("a/b/p.html", "s.png")).toBe("a/b/s.png");
    expect(resolveAssetPath("a/b/p.html", "../s.png")).toBe("a/s.png");
    expect(resolveAssetPath("a/p.html", "../../../s.png")).toBe("s.png");
    expect(resolveAssetPath("a/p.html", "s.png?v=2#x")).toBe("a/s.png");
  });

  it("resolves against an absolute (outside) page, keeping the drive and clamping at the root", () => {
    expect(resolveAssetPath("C:\\w\\report\\vergleich.html", "shot.png")).toBe("C:/w/report/shot.png");
    expect(resolveAssetPath("C:/w/report/v.html", "../img/a%20b.png")).toBe("C:/w/img/a b.png");
    expect(resolveAssetPath("C:/w/v.html", "../../../../x.png")).toBe("C:/x.png");
    expect(resolveAssetPath("/home/u/v.html", "./sub/s.png")).toBe("/home/u/sub/s.png");
  });
});

// @covers FR-01.02
describe("createResourceLoader", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const png = () => new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-type": "image/png" } });

  it("returns a data URI, requests a file once, and never fetches non-asset or hidden paths", async () => {
    const f = vi.fn(async () => png());
    vi.stubGlobal("fetch", f);
    const l = createResourceLoader((p) => `/f?path=${p}`);
    expect(await l.dataUri("a.png")).toMatch(/^data:image\/png;base64,/);
    await l.dataUri("a.png");
    expect(await l.dataUri("s.js")).toBeNull();
    expect(await l.dataUri(".git/a.png")).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("stylesheet requests share the queue, the timeout and dispose() with images", async () => {
    let active = 0;
    let peak = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: RequestInit) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r, rej) => {
          const t = setTimeout(r, 5);
          init.signal?.addEventListener("abort", () => (clearTimeout(t), rej(new Error("aborted"))));
        });
        active--;
        return new Response("a{}");
      }),
    );
    const l = createResourceLoader((p) => p, { maxInFlight: 2 });
    await Promise.all(["1", "2", "3", "4", "5"].map((n) => l.text(`${n}.css`)));
    expect(peak).toBe(2);
    l.dispose();
    await expect(l.text("late.css")).rejects.toThrow();
  });

  it("limits requests in flight, refuses a declared oversize before reading, and claims each @import once", async () => {
    let active = 0;
    let peak = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return png();
      }),
    );
    const l = createResourceLoader((p) => p, { maxInFlight: 2 });
    await Promise.all(["1", "2", "3", "4", "5"].map((n) => l.dataUri(`${n}.png`)));
    expect(peak).toBe(2);

    const big = vi.fn(async () => new Response(new Uint8Array(4), { headers: { "content-type": "image/png", "content-length": "999999999" } }));
    vi.stubGlobal("fetch", big);
    expect(await createResourceLoader((p) => p, { maxBytes: 10 }).dataUri("big.png")).toBeNull();

    const imp = createResourceLoader((p) => p, { maxImports: 2 });
    expect([imp.claimImport("a.css"), imp.claimImport("a.css"), imp.claimImport("b.css"), imp.claimImport("c.css")]).toEqual([true, false, true, false]);
  });

  it("books every substitution against an output budget, so a file referenced many times stops being inlined", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => png()));
    const loader = createResourceLoader((p) => p, { maxInlineChars: 200 });
    const html = Array.from({ length: 50 }, () => '<img src="a.png">').join("");
    const out = await inlineHtmlAssets(html, "i.html", loader);
    const inlinedCount = (out.match(/src="data:/g) ?? []).length;
    expect(inlinedCount).toBeGreaterThan(0);
    expect(inlinedCount).toBeLessThan(50);
    expect(out.length).toBeLessThan(html.length + 400);
  });

  it("dispose() aborts in-flight requests, resolves queued ones to null and refuses new work", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(new Error("aborted"))))),
    );
    const l = createResourceLoader((p) => p, { maxInFlight: 1, timeoutMs: 60_000 });
    const pending = [l.dataUri("1.png"), l.dataUri("2.png"), l.dataUri("3.png")];
    await Promise.resolve();
    l.dispose();
    expect(await Promise.all(pending)).toEqual([null, null, null]);
    expect(await l.dataUri("4.png")).toBeNull();
    expect(l.claimImport("x.css")).toBe(false);
  });

  it("gives an @import claim back when the stylesheet cannot be read", async () => {
    const f = fakeLoader({});
    const out = await inlineCssResources('@import "gone.css";', "p.css", f.loader);
    expect(out).toBe('@import "gone.css";');
    expect(f.loader.claimImport("gone.css")).toBe(true); // released, not burned
  });

  it("stops at the file-count and total-size bounds and treats errors as null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => png()));
    const count = createResourceLoader((p) => p, { maxAssets: 2 });
    expect(await count.dataUri("1.png")).not.toBeNull();
    expect(await count.dataUri("2.png")).not.toBeNull();
    expect(await count.dataUri("3.png")).toBeNull();

    const size = createResourceLoader((p) => p, { maxBytes: 6 });
    expect(await size.dataUri("1.png")).not.toBeNull();
    expect(await size.dataUri("2.png")).toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    expect(await createResourceLoader((p) => p).dataUri("x.png")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("net"))));
    expect(await createResourceLoader((p) => p).dataUri("x.png")).toBeNull();
  });

  it("gives up on a stalled request instead of holding the page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(new Error("aborted"))))),
    );
    expect(await createResourceLoader((p) => p, { timeoutMs: 20 }).dataUri("slow.png")).toBeNull();
  });
});
