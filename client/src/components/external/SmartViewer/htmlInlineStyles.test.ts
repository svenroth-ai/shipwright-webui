import { describe, expect, it, vi } from "vitest";

import { inlineLinkedStyles } from "./htmlInlineStyles";

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
    expect(fetchText).toHaveBeenCalledTimes(1);
    expect(fetchText).toHaveBeenCalledWith("b.css");
    expect(out).toBe("<style>a{}</style><style>a{}</style>");
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
});
