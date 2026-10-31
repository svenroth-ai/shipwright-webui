import { describe, expect, it, vi } from "vitest";

import { MAX_LINKS, inlineLinkedStyles, maskNonMarkup } from "./htmlInlineStyles";

// @covers FR-01.02
describe("inlineLinkedStyles", () => {
  it("inlines a relative stylesheet resolved against the html path", async () => {
    const fetchText = vi.fn().mockResolvedValue("body{color:red}");
    const out = await inlineLinkedStyles(
      '<head><link rel="stylesheet" href="mockup.css"></head>',
      "Spec/design/v2/index.html",
      fetchText,
    );
    expect(fetchText).toHaveBeenCalledWith("Spec/design/v2/mockup.css");
    expect(out).toBe("<head><style>body{color:red}</style></head>");
  });

  it("leaves absolute links, non-stylesheets and failed loads untouched", async () => {
    const fetchText = vi.fn().mockRejectedValue(new Error("nope"));
    const html =
      '<link rel="stylesheet" href="https://x.test/a.css"><link rel="icon" href="f.ico"><link rel=stylesheet href=gone.css>';
    expect(await inlineLinkedStyles(html, "a/index.html", fetchText)).toBe(html);
  });

  it("ignores data-href lookalikes and replaces repeated tags everywhere", async () => {
    const fetchText = vi.fn().mockResolvedValue("a{}");
    const tag = '<link data-href="x" rel="stylesheet" href="b.css">';
    const out = await inlineLinkedStyles(tag + tag, "index.html", fetchText);
    expect(fetchText).toHaveBeenCalledWith("b.css");
    expect(out).toBe("<style>a{}</style><style>a{}</style>");
  });

  it("never rewrites link-shaped text inside comments or raw-text elements", async () => {
    const fetchText = vi.fn().mockResolvedValue("a{}");
    const html =
      '<!-- <link rel="stylesheet" href="c.css"> -->' +
      `<script>var t = '<link rel="stylesheet" href="s.css">';</script>` +
      '<textarea><link rel="stylesheet" href="t.css"></textarea>' +
      '<link rel="stylesheet" href="real.css">';
    const out = await inlineLinkedStyles(html, "index.html", fetchText);
    expect(fetchText).toHaveBeenCalledTimes(1);
    expect(fetchText).toHaveBeenCalledWith("real.css");
    expect(out).toContain('<link rel="stylesheet" href="s.css">');
    expect(out).toContain('<!-- <link rel="stylesheet" href="c.css"> -->');
    expect(out.endsWith("<style>a{}</style>")).toBe(true);
  });

  it("keeps media, and leaves alternate / disabled stylesheets untouched", async () => {
    const fetchText = vi.fn().mockResolvedValue("a{}");
    const alt = '<link rel="alternate stylesheet" href="alt.css">';
    const dis = '<link rel="stylesheet" href="dis.css" disabled>';
    const out = await inlineLinkedStyles(
      '<link rel="stylesheet" media="print" href="p.css">' + alt + dis,
      "index.html",
      fetchText,
    );
    expect(fetchText).toHaveBeenCalledTimes(1);
    expect(out).toBe('<style media="print">a{}</style>' + alt + dis);
  });

  it("inlines at most MAX_LINKS stylesheets", async () => {
    const fetchText = vi.fn().mockResolvedValue("a{}");
    const html = Array.from({ length: MAX_LINKS + 5 }, (_, i) => `<link rel="stylesheet" href="s${i}.css">`).join("");
    const out = await inlineLinkedStyles(html, "index.html", fetchText);
    expect(fetchText).toHaveBeenCalledTimes(MAX_LINKS);
    expect(out.match(/<style>/g)).toHaveLength(MAX_LINKS);
    expect(out.match(/<link /g)).toHaveLength(5);
  });

  it("clamps traversal and root-absolute hrefs to the project root", async () => {
    const fetchText = vi.fn().mockResolvedValue("");
    await inlineLinkedStyles(
      '<link rel="stylesheet" href="../../../etc/x.css"><link rel="stylesheet" href="/css/y.css">',
      "a/index.html",
      fetchText,
    );
    const paths = fetchText.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(["etc/x.css", "css/y.css"]);
    expect(paths.some((p: string) => p.includes(".."))).toBe(false);
  });

  it("cannot be broken out of via </style in the css", async () => {
    const out = await inlineLinkedStyles(
      '<link rel="stylesheet" href="a.css">',
      "index.html",
      async () => "a{}</style><script>x</script>",
    );
    expect(out.match(/<\/style/gi)).toHaveLength(1);
  });
  it("only ever fetches .css files, never dotfiles or dot directories", async () => {
    const fetchText = vi.fn().mockResolvedValue("SECRET=1");
    const html = [".env", "data.json", ".git/x.css", "a/.hidden/y.css", "notes.txt"]
      .map((h) => `<link rel="stylesheet" href="${h}">`)
      .join("");
    const out = await inlineLinkedStyles(html, "index.html", fetchText);
    expect(fetchText).not.toHaveBeenCalled();
    expect(out).toBe(html);
  });

  it("is quote-aware: a '>' inside an attribute does not end the tag", async () => {
    const fetchText = vi.fn().mockResolvedValue("a{}");
    const out = await inlineLinkedStyles(
      '<link rel="stylesheet" href="a.css" media="(min-width:1px)>x">',
      "index.html",
      fetchText,
    );
    expect(out).toBe('<style media="(min-width:1px)>x">a{}</style>');
  });

  it("does not treat <style-guide> / <title-x> as raw-text openers", async () => {
    const fetchText = vi.fn().mockResolvedValue("a{}");
    const out = await inlineLinkedStyles(
      '<style-guide></style-guide><link rel="stylesheet" href="a.css">',
      "index.html",
      fetchText,
    );
    expect(fetchText).toHaveBeenCalledWith("a.css");
    expect(out).toContain("<style>a{}</style>");
  });

  it("an unclosed raw-text element masks the rest of the document", () => {
    const html = '<script>var x=1;<link rel="stylesheet" href="a.css">';
    expect(maskNonMarkup(html).includes("<link")).toBe(false);
    expect(maskNonMarkup(html)).toHaveLength(html.length);
  });

  it("stays linear on 1 MB of unclosed openers (no ReDoS)", () => {
    for (const unit of ["<style", "<!--", "<script>"]) {
      const html = unit.repeat(Math.floor(1_000_000 / unit.length));
      const t0 = performance.now();
      maskNonMarkup(html);
      expect(performance.now() - t0).toBeLessThan(1000);
    }
  });

  it("leaves the link in place when a stylesheet request stalls", async () => {
    const html = '<link rel="stylesheet" href="slow.css">';
    const out = await inlineLinkedStyles(html, "index.html", () => new Promise<string>(() => {}), 20);
    expect(out).toBe(html);
  });
});
