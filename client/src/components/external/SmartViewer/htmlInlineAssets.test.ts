import { describe, expect, it, vi } from "vitest";

import { inlineCssResources, inlineHtmlAssets, MAX_IMPORT_DEPTH } from "./htmlInlineAssets";
import { createResourceLoader, type ResourceLoader } from "./htmlResourceLoader";

import { fakeLoader } from "./htmlInlineAssets.fakeLoader";

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
