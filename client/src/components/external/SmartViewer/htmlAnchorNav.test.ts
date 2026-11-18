/*
 * The in-frame script that makes `<a href="#section">` scroll inside the HTML preview instead of
 * opening a new tab (the srcdoc carries `<base target=_blank>`). Run in jsdom, as the frame would.
 * @covers FR-01.02
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

import { ANCHOR_NAV_SCRIPT } from "./htmlAnchorNav";
import { buildHtmlSrcDoc } from "./HtmlRenderer";

const scrolled: string[] = [];

beforeAll(() => {
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id || this.tagName.toLowerCase());
  };
  const code = ANCHOR_NAV_SCRIPT.replace(/^<script>/, "").replace(/<\/script>$/, "");
  new Function(code)();
});

beforeEach(() => {
  scrolled.length = 0;
  document.body.innerHTML = `
    <nav><a id="l1" href="#chapter-2">Two</a> <a id="l2" href="#kapitel%20x">X</a>
      <a id="l3" href="#">Top</a> <a id="l4" href="#nowhere">Gone</a>
      <a id="l5" href="https://example.com/">Ext</a> <a id="l6" href="#by-name">Name</a></nav>
    <h2 id="chapter-2">Chapter 2</h2><h2 id="kapitel x">Kapitel</h2><a name="by-name"></a>`;
});

function click(id: string, init: MouseEventInit = {}): MouseEvent {
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  document.getElementById(id)!.dispatchEvent(ev);
  return ev;
}

describe("in-page anchor navigation", () => {
  // @covers FR-01.02
  it("scrolls to the target and cancels the default new-tab navigation", () => {
    const ev = click("l1");
    expect(ev.defaultPrevented).toBe(true);
    expect(scrolled).toEqual(["chapter-2"]);
  });

  // @covers FR-01.02
  it("decodes percent-escapes, resolves name= anchors and bare # (top)", () => {
    click("l2");
    click("l6");
    click("l3");
    expect(scrolled).toEqual(["kapitel x", "a", "html"]);
  });

  // @covers FR-01.02
  it("lets a real id=top element win over the scroll-to-top fallback", () => {
    document.body.insertAdjacentHTML("beforeend", `<a id="tl" href="#top">t</a><section id="top">T</section>`);
    click("tl");
    expect(scrolled).toEqual(["top"]);
  });

  // @covers FR-01.02
  it("swallows a dead fragment (no new tab) without scrolling", () => {
    const ev = click("l4");
    expect(ev.defaultPrevented).toBe(true);
    expect(scrolled).toEqual([]);
  });

  // @covers FR-01.02
  it("leaves external links and modified clicks to the browser", () => {
    expect(click("l5").defaultPrevented).toBe(false);
    expect(click("l1", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(scrolled).toEqual([]);
  });

  // @covers FR-01.02
  it("yields to a page handler that already cancelled the click", () => {
    const handler = vi.fn((e: Event) => e.preventDefault());
    document.getElementById("l1")!.addEventListener("click", handler);
    click("l1");
    expect(handler).toHaveBeenCalled();
    expect(scrolled).toEqual([]);
  });
});

describe("buildHtmlSrcDoc", () => {
  // @covers FR-01.02
  it("carries the anchor script after the CSP and base, before author markup", () => {
    const doc = buildHtmlSrcDoc("<p>x</p>");
    expect(doc.indexOf("<base")).toBeLessThan(doc.indexOf("<script>"));
    expect(doc.indexOf("<script>")).toBeLessThan(doc.indexOf("<p>x</p>"));
  });

  // @covers FR-01.02
  it("keeps a leading doctype first (no quirks mode)", () => {
    expect(buildHtmlSrcDoc("<!DOCTYPE html><p>x</p>").startsWith("<!DOCTYPE html>")).toBe(true);
  });
});
