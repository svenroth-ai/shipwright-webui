import { afterEach, describe, expect, it, vi } from "vitest";

import { inlineCssResources, inlineHtmlAssets, MAX_IMPORT_DEPTH } from "./htmlInlineAssets";
import { resolveAssetPath } from "./htmlMarkupScan";
import { createResourceLoader, isAssetPath, type ResourceLoader } from "./htmlResourceLoader";

/** A loader over a path -> text map; every asset path "loads" as `data:<path>` unless listed as refused. */
function fakeLoader(css: Record<string, string> = {}, refused: string[] = []) {
  const calls: string[] = [];
  const claimed = new Set<string>();
  const loader: ResourceLoader = {
    claimImport: (p) => (claimed.has(p) ? false : (claimed.add(p), true)),
    releaseImport: (p) => void claimed.delete(p),
    spend: () => true,
    dispose: () => undefined,
    text: async (p) => {
      if (css[p] === undefined) throw new Error("missing " + p);
      return css[p];
    },
    dataUri: async (p) => {
      calls.push(p);
      return refused.includes(p) || !isAssetPath(p) ? null : `data:x/${p}`;
    },
  };
  return { loader, calls };
}

// @covers FR-01.02
describe("inlineHtmlAssets — tags", () => {
  it("embeds a relative <img src> and leaves absolute / data / protocol-relative ones alone", async () => {
    const { loader, calls } = fakeLoader();
    const html =
      '<img src="shot.png"><img src="https://x.test/a.png"><img src="data:image/png;base64,AA"><img src="//cdn.test/a.png"><img src="#x">';
    const out = await inlineHtmlAssets(html, "d/index.html", loader);
    expect(out).toContain('<img src="data:x/d/shot.png">');
    expect(out).toContain('src="https://x.test/a.png"');
    expect(out).toContain('src="data:image/png;base64,AA"');
    expect(out).toContain('src="//cdn.test/a.png"');
    expect(calls).toEqual(["d/shot.png"]);
  });

  it("maps every srcset candidate and keeps its descriptor; <source srcset> in a picture too", async () => {
    const { loader } = fakeLoader();
    const out = await inlineHtmlAssets(
      '<picture><source srcset="a.webp 1x, b.webp 2x" type="image/webp"><img src="c.png" srcset="c.png, c2.png 2x, https://x.test/c3.png 3x"></picture>',
      "d/i.html",
      loader,
    );
    expect(out).toContain('srcset="data:x/d/a.webp 1x, data:x/d/b.webp 2x"');
    expect(out).toContain('srcset="data:x/d/c.png, data:x/d/c2.png 2x, https://x.test/c3.png 3x"');
  });

  it("maps <video poster> but never a video / audio source or an <a> link", async () => {
    const { loader, calls } = fakeLoader();
    const out = await inlineHtmlAssets(
      '<video poster="p.jpg" src="v.mp4"><source src="v.webm"></video><audio src="a.mp3"></audio><a href="shot.png">x</a>',
      "d/i.html",
      loader,
    );
    expect(out).toContain('poster="data:x/d/p.jpg"');
    expect(out).toContain('src="v.mp4"');
    expect(out).toContain('<source src="v.webm">');
    expect(out).toContain('src="a.mp3"');
    expect(out).toContain('href="shot.png"');
    expect(calls).toEqual(["d/p.jpg"]);
  });

  it("only touches real tags: comments, scripts, textareas and data-src lookalikes stay as authored", async () => {
    const { loader, calls } = fakeLoader();
    const html =
      '<!-- <img src="c.png"> --><script>var s=\'<img src="s.png">\'</script><textarea><img src="t.png"></textarea><img data-src="lazy.png" alt="">';
    expect(await inlineHtmlAssets(html, "d/i.html", loader)).toBe(html);
    expect(calls).toEqual([]);
  });

  it("requests a repeated reference once and never asks for hidden folders, scripts or other types", async () => {
    const { loader, calls } = fakeLoader();
    const out = await inlineHtmlAssets(
      '<img src="a.png"><img src="a.png"><img src=".git/x.png"><img src="d/.secret/y.png"><img src="s.js"><img src="data.svgz">',
      "i.html",
      loader,
    );
    expect(calls).toEqual(["a.png"]);
    expect(out).toContain('src=".git/x.png"');
    expect(out).toContain('src="s.js"');
  });

  it("rewrites srcset by the HTML grammar: commas inside data URIs and untouched candidates stay byte-exact", async () => {
    const { loader } = fakeLoader();
    const out = await inlineHtmlAssets(
      '<img srcset="data:image/png;base64,AAAA 1x,a.png 2x,https://x.test/z.png,  b.png">',
      "d/i.html",
      loader,
    );
    expect(out).toBe('<img srcset="data:image/png;base64,AAAA 1x,data:x/d/a.png 2x,https://x.test/z.png,  data:x/d/b.png">');
  });

  it("reads attributes with quoting respected: a src-looking text inside another value is not an attribute", async () => {
    const { loader, calls } = fakeLoader();
    const html = `<img alt=" src=x.png" title='srcset=y.png 2x' data-x=src=z.png>`;
    expect(await inlineHtmlAssets(html, "i.html", loader)).toBe(html);
    expect(calls).toEqual([]);
    expect(await inlineHtmlAssets("<img alt=' x ' src = 'a.png' >", "i.html", loader)).toBe(`<img alt=' x ' src = 'data:x/a.png' >`);
    expect(await inlineHtmlAssets("<img src=a.png>", "i.html", loader)).toBe('<img src="data:x/a.png">');
  });

  it("stays fast on hostile markup: unterminated tags and quotes do not scan the rest of the document", async () => {
    const { loader } = fakeLoader();
    for (const unit of ["<img ", "<img src=a.png ", '<img alt="', "<source srcset='"]) {
      const html = unit.repeat(200_000 / unit.length * 5);
      const t0 = performance.now();
      await inlineHtmlAssets(html, "i.html", loader);
      expect(performance.now() - t0, unit).toBeLessThan(2000);
    }
  });

  it("keeps the original reference when the loader refuses the file", async () => {
    const { loader } = fakeLoader({}, ["d/gone.png"]);
    expect(await inlineHtmlAssets('<img src="gone.png">', "d/i.html", loader)).toBe('<img src="gone.png">');
  });
});

// @covers FR-01.02
describe("inlineHtmlAssets — <style> blocks and CSS", () => {
  it("inlines url() of images in a <style> block, relative to the page; other urls stay", async () => {
    const { loader } = fakeLoader();
    const out = await inlineHtmlAssets(
      '<style>.a{background:url(bg.png)} .b{background:url("../x/b.jpg")} .c{background:url(https://x.test/c.png)} .d{fill:url(#g)} .e{background:url(page.html)}</style>',
      "d/i.html",
      loader,
    );
    expect(out).toContain('url("data:x/d/bg.png")');
    expect(out).toContain('url("data:x/x/b.jpg")');
    expect(out).toContain("url(https://x.test/c.png)");
    expect(out).toContain("url(#g)");
    expect(out).toContain("url(page.html)");
  });

  it("does not look inside a <style> that sits in a comment", async () => {
    const { loader, calls } = fakeLoader();
    const html = "<!-- <style>.a{background:url(bg.png)}</style> -->";
    expect(await inlineHtmlAssets(html, "i.html", loader)).toBe(html);
    expect(calls).toEqual([]);
  });

  it("inlines @import (with the imported file's own base path) and bounds depth and cycles", async () => {
    const { loader } = fakeLoader({
      "css/a.css": '@import "b.css"; .a{background:url(i.png)}',
      "css/b.css": ".b{background:url(j.png)}",
    });
    const out = await inlineCssResources('@import url("css/a.css"); .p{}', "page.html", loader);
    expect(out).toContain('.b{background:url("data:x/css/j.png")}');
    expect(out).toContain('.a{background:url("data:x/css/i.png")}');
    expect(out).not.toContain("@import");

    const cyc = fakeLoader({ "a.css": '@import "b.css";.a{}', "b.css": '@import "a.css";.b{}' });
    const cycOut = await inlineCssResources('@import "a.css";', "p.css", cyc.loader);
    expect(cycOut).toContain(".a{}");
    expect(cycOut).toContain(".b{}");
    expect(MAX_IMPORT_DEPTH).toBeGreaterThan(0);
  });

  it("fetches a repeated / diamond @import tree once per file but keeps every occurrence in place", async () => {
    const fan = (target: string) => Array.from({ length: 10 }, () => `@import "${target}";`).join("");
    const files: Record<string, string> = { "b.css": fan("c.css") + ".b{}", "c.css": fan("d.css") + ".c{}", "d.css": ".d{}" };
    const textCalls: string[] = [];
    const f = fakeLoader(files);
    const counted: ResourceLoader = { ...f.loader, text: async (p) => (textCalls.push(p), f.loader.text(p)) };
    const out = await inlineCssResources(fan("b.css"), "p.css", counted);
    expect(textCalls.sort()).toEqual(["b.css", "c.css", "d.css"]); // one request per distinct file
    expect(out).not.toContain("@import");
    expect(out.match(/\.d\{\}/g)).toHaveLength(1000);
  });

  it("keeps the cascade order of a repeated import: a then b then a again", async () => {
    const { loader } = fakeLoader({ "a.css": ".x{color:red}", "b.css": ".x{color:blue}" });
    const out = await inlineCssResources('@import "a.css";@import "b.css";@import "a.css";', "p.css", loader);
    expect(out).toBe(".x{color:red}.x{color:blue}.x{color:red}");
  });

  it("an import tree cannot exceed the page's output budget", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string) => new Response(u.includes("big") ? "x".repeat(900) : '@import "big.css";'.repeat(20))));
    const loader = createResourceLoader((p) => `/f?path=${p}`, { maxInlineChars: 5000 });
    const out = await inlineCssResources('@import "big.css";'.repeat(100), "p.css", loader);
    expect(out.length).toBeLessThan(5000 + 100 * 18 + 200); // at most the budget of inlined text plus the authored overflow lines
    expect(out).toContain("@import"); // the overflow stays as authored
  });

  it("keeps a #fragment on an embedded image / css url (SVG symbols)", async () => {
    const { loader } = fakeLoader();
    expect(await inlineHtmlAssets('<img src="i.svg#check">', "d/p.html", loader)).toBe('<img src="data:x/d/i.svg#check">');
    expect(await inlineCssResources(".a{background:url(i.svg#check)}", "d/p.css", loader)).toBe('.a{background:url("data:x/d/i.svg#check")}');
  });

  it("processes a <style> whose open tag carries a > inside an attribute value", async () => {
    const { loader } = fakeLoader();
    const out = await inlineHtmlAssets('<style media="(min-width:1px)" title="a>b">.a{background:url(x.png)}</style>', "d/p.html", loader);
    expect(out).toBe('<style media="(min-width:1px)" title="a>b">.a{background:url("data:x/d/x.png")}</style>');
  });

  it("leaves @import with a media tail, a non-css target, a hidden folder or an absolute URL as authored", async () => {
    const { loader } = fakeLoader({ "a.css": ".a{}", ".h/a.css": ".h{}" });
    const css =
      '@import "a.css" screen; @import "data.txt"; @import ".h/a.css"; @import url(https://x.test/a.css); @import "//x.test/a.css";';
    expect(await inlineCssResources(css, "p.css", loader)).toBe(css);
  });

  it("escapes </style in an imported stylesheet so it cannot end the block early", async () => {
    const { loader } = fakeLoader({ "x.css": 'a::after{content:"</style><script>1</script>"}' });
    const out = await inlineHtmlAssets('<style>@import "x.css";</style>', "i.html", loader);
    expect(out.match(/<\/style/gi)).toHaveLength(1);
    expect(out).toContain("<\\/style><script>1");
  });
});

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
