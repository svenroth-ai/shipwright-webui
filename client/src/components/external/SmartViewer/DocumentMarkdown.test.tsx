/*
 * DocumentMarkdown specs — iterate-2026-05-30-smartviewer-render-ux.
 * Covers the four file-preview rendering fixes (AC4/6/7/8), the dep-free
 * frontmatter preprocess (incl. the thematic-break false-positive guard), the
 * clobber-aware anchor resolution, and the security contract (rehype-sanitize
 * strips <script> + on* even though rehype-raw is enabled).
 */

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

import {
  DocumentMarkdown,
  frontmatterToCodeFence,
  findAnchorTarget,
  isInternalDocLink,
} from "./DocumentMarkdown";

describe("frontmatterToCodeFence", () => {
  it("wraps a leading --- … --- block in a yaml fence and keeps the body", () => {
    const out = frontmatterToCodeFence("---\nfoo: bar\nn: 1\n---\n# Title\n");
    expect(out.startsWith("```yaml\nfoo: bar\nn: 1\n```")).toBe(true);
    expect(out).toContain("# Title");
  });

  it("tolerates CRLF line endings", () => {
    const out = frontmatterToCodeFence("---\r\nfoo: bar\r\n---\r\nbody");
    expect(out.startsWith("```yaml")).toBe(true);
    expect(out).toContain("foo: bar");
  });

  it("returns text unchanged when there is no leading frontmatter", () => {
    const t = "# Title\n\nsome --- mid-line\n";
    expect(frontmatterToCodeFence(t)).toBe(t);
  });

  it("returns text unchanged for an unterminated leading fence", () => {
    const t = "---\nfoo: bar\n# never closed";
    expect(frontmatterToCodeFence(t)).toBe(t);
  });

  it("does NOT treat a leading thematic break as frontmatter", () => {
    const hr = "---\n\nsome prose between rules\n\n---\n\nmore";
    expect(frontmatterToCodeFence(hr)).toBe(hr);
    expect(frontmatterToCodeFence("---\n---\nbody")).toBe("---\n---\nbody");
  });
});

describe("findAnchorTarget", () => {
  it("resolves both an unprefixed slug id and a user-content-prefixed raw-HTML id", () => {
    const c = document.createElement("div");
    c.innerHTML = '<a id="user-content-trg-1"></a><h2 id="heading">H</h2>';
    expect(findAnchorTarget(c, "trg-1")?.id).toBe("user-content-trg-1");
    expect(findAnchorTarget(c, "heading")?.id).toBe("heading");
    expect(findAnchorTarget(c, "nope")).toBeNull();
  });
});

describe("isInternalDocLink", () => {
  it("matches relative *.md links (with/without fragment), not #frag/http/non-md", () => {
    expect(isInternalDocLink("../spec.md#fr-0101")).toBe(true);
    expect(isInternalDocLink("other.markdown")).toBe(true);
    expect(isInternalDocLink("#frag")).toBe(false);
    expect(isInternalDocLink("https://github.com/x")).toBe(false);
    expect(isInternalDocLink("mailto:a@b.com")).toBe(false);
    expect(isInternalDocLink("logo.png")).toBe(false);
    expect(isInternalDocLink("../code.ts")).toBe(false);
  });
});

describe("DocumentMarkdown rendering", () => {
  it("AC4 — hides HTML comments (no visible <!-- text)", () => {
    const { container } = render(
      <DocumentMarkdown text={"# H\n\n<!-- secret comment -->\n\ntext"} />,
    );
    expect(container.textContent).not.toContain("secret comment");
    expect(container.textContent).not.toContain("<!--");
  });

  it("AC6 — renders leading frontmatter as a code block, not raw body text", () => {
    const { container } = render(
      <DocumentMarkdown text={"---\ncanon: true\nrun_id: x\n---\n# Real Heading\n"} />,
    );
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain("canon: true");
    expect(container.querySelector("h1")?.textContent).toContain("Real Heading");
  });

  it("AC7 — renders an inline <a id> anchor as a real element (clobber-prefixed), not literal text", () => {
    const { container } = render(
      <DocumentMarkdown text={'<a id="trg-786eab1f"></a>\n\n## Section'} />,
    );
    expect(
      container.querySelector('[id="user-content-trg-786eab1f"]'),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("<a id");
  });

  it("AC8 — rehype-slug stamps (unprefixed) heading ids — anchor-nav targets", () => {
    const { container } = render(<DocumentMarkdown text={"## My Section Heading\n"} />);
    const id = container.querySelector("h2")?.getAttribute("id");
    expect(id).toBeTruthy();
    expect(id!.startsWith("user-content-")).toBe(false);
  });

  it("security — sanitizer strips <script> and on* handlers (rehype-raw is gated)", () => {
    const { container } = render(
      <DocumentMarkdown
        text={'<script>window.__docmd_x=1</script>\n\n<a id="ok" onclick="evil()">link</a>'}
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    const a = container.querySelector('[id="user-content-ok"]');
    expect(a).not.toBeNull();
    expect(a!.getAttribute("onclick")).toBeNull();
    expect((window as unknown as { __docmd_x?: unknown }).__docmd_x).toBeUndefined();
  });

  it("AC8 — clicking a #fragment link is intercepted (preventDefault) once its target resolves", () => {
    Element.prototype.scrollIntoView = (() => {}) as never; // jsdom has no impl
    const { getByText } = render(
      <DocumentMarkdown text={'<a id="trg-1"></a>\n\n[jump](#trg-1)\n'} />,
    );
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    getByText("jump").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("AC8 cross-file — clicking a relative *.md link calls onDocLinkClick (not same-doc scroll)", () => {
    const onDocLinkClick = vi.fn();
    const { getByText } = render(
      <DocumentMarkdown text={"[FR-01.01](../spec.md#fr-0101)"} onDocLinkClick={onDocLinkClick} />,
    );
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    getByText("FR-01.01").dispatchEvent(ev);
    expect(onDocLinkClick).toHaveBeenCalledWith("../spec.md#fr-0101");
    expect(ev.defaultPrevented).toBe(true);
  });

  // @covers FR-01.35
  it("traceability RTM — a requirement deep link SCROLLS to its explicit `rtm-fr-` anchor (CP-2)", () => {
    // The regenerated schema-3 RTM links Verification-Timeline rows to
    // requirement rows via `[FR-01.66](#rtm-fr-0166)` against an explicit inline
    // `<a id="rtm-fr-0166"></a>` anchor. The sanitizer clobber-prefixes that id
    // to `user-content-rtm-fr-0166`; the SHORT `#rtm-fr-0166` link must still
    // resolve to it and scroll, or the deep link silently scrolls NOWHERE — the
    // exact failure mode CP-2 guards. This exercises the real anchor convention.
    const scrolled: HTMLElement[] = [];
    Element.prototype.scrollIntoView = function scroll(this: HTMLElement) {
      scrolled.push(this);
    } as never;
    const { getByText } = render(
      <DocumentMarkdown text={'<a id="rtm-fr-0166"></a>\n\n[FR-01.66](#rtm-fr-0166)\n'} />,
    );
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    getByText("FR-01.66").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0].id).toBe("user-content-rtm-fr-0166");
  });
});
