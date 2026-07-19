/*
 * mission-typography-invariant.test.ts — S3 AC3 (visual hierarchy), as a fence.
 *
 * jsdom cannot see layout, so these assert the STYLESHEET rather than a rendered
 * box. That is the right granularity for the three rules that are load-bearing
 * and were each broken (or absent) before S3:
 *
 *   1. `.rn-k` / `.rn-r` must be BLOCK. They were spans with no display rule, so
 *      the artifact label and its receipt ran together on one line and the
 *      `.rn-r { margin-top }` beside them did nothing at all — margin-block has
 *      no effect on a non-replaced inline box. That is the whole label-vs-value
 *      hierarchy §8 asks for.
 *   2. `.mc-left > *` must not shrink (DO-NOT #24). `.record` scrolls and
 *      `.mc-left` makes it a column flex container; without this, a child is
 *      squeezed under its content, clipped, and the panel silently stops
 *      scrolling — the content becomes unreachable with no error.
 *   3. The refinement must add NO animation. `prefers-reduced-motion: reduce` is
 *      the primary user's everyday state, so a typography pass is exactly where
 *      a decorative transition must not sneak in.
 *
 * @covers FR-01.66
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS_PATH = path.resolve(__dirname, "../styles/mission-record.css");
const css = readFileSync(CSS_PATH, "utf-8");

/** Comments carry prose about motion; only DECLARATIONS may be asserted on. */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * The S3 block's DECLARATIONS only.
 *
 * The slice starts inside the banner comment, so the leading partial comment is
 * cut at its terminator BEFORE stripping — otherwise the unmatched `*​/` leaves
 * the banner prose in the text, and prose about motion would satisfy a search
 * for motion.
 */
const s3Block = stripComments(
  css
    .slice(css.indexOf("S3 typography refinement"), css.indexOf("Slice-2 detail bodies"))
    .replace(/^[\s\S]*?\*\//, ""),
);

/**
 * EVERY declaration block whose selector mentions `selector`, concatenated.
 *
 * Concatenated rather than first-match because the cascade is cumulative: the
 * S3 rules deliberately sit alongside the original `.rec-node .rn-k` rule
 * instead of rewriting it, and a first-match helper would have read only the
 * older one and reported a passing rule as missing.
 */
function ruleFor(selector: string): string {
  const needle = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`([^\\n{}]*${needle}[^\\n{}]*)\\{([^}]*)\\}`, "g");
  const body = stripComments(css);
  let out = "";
  for (const m of body.matchAll(re)) out += m[2];
  return out;
}

describe("mission rail — label/value hierarchy", () => {
  it("renders the artifact label and its receipt as BLOCKS, not inline", () => {
    expect(ruleFor(".rn-k")).toMatch(/display:\s*block/);
    expect(ruleFor(".rn-r")).toMatch(/display:\s*block/);
  });

  it("lets a long receipt or note WRAP instead of overflowing the 248px rail", () => {
    expect(ruleFor(".rec-node .rn-r")).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("gives an inert (non-clickable) node a non-pointer cursor", () => {
    expect(ruleFor(".rec-node.is-inert")).toMatch(/cursor:\s*default/);
  });
});

describe("DO-NOT #24 — the scrolling column-flex panel keeps its children's minimum size", () => {
  it("`.mc-left` children do not shrink", () => {
    expect(s3Block).toMatch(/\.mc-left\s*>\s*\*\s*\{[^}]*flex-shrink:\s*0/);
  });

  it("and `.mc-left` is in fact the column-flex + scrolling combination this guards", () => {
    // If either half of the premise ever changes, this fence should be revisited
    // rather than silently continuing to assert something irrelevant.
    expect(ruleFor(".mc-left")).toMatch(/flex-direction:\s*column/);
    expect(ruleFor(".record ")).toMatch(/overflow-y:\s*auto/);
  });
});

describe("the typography pass introduces no motion", () => {
  it("adds no animation, transition or transform", () => {
    expect(s3Block).not.toMatch(/\banimation\b/);
    expect(s3Block).not.toMatch(/\btransition\b/);
    expect(s3Block).not.toMatch(/\btransform\b/);
  });

  it("hides no content by default (nothing is opacity:0 or visibility:hidden)", () => {
    // Content is NEVER hidden by default and revealed by an animation. The one
    // `:empty` rule is exempt: it collapses a container that has no content at
    // all, which is the opposite of hiding content that exists.
    const withoutEmptyRule = s3Block.replace(/\.a-detail:empty\s*\{[^}]*\}/g, "");
    expect(withoutEmptyRule).not.toMatch(/opacity:\s*0\b/);
    expect(withoutEmptyRule).not.toMatch(/visibility:\s*hidden/);
    expect(withoutEmptyRule).not.toMatch(/display:\s*none/);
  });
});

describe("detail bodies are styled at all (S1 left these hooks empty on purpose)", () => {
  it.each([".a-meta", ".a-rows", ".a-note"])("%s has a rule in the S3 block", (sel) => {
    expect(s3Block).toContain(sel);
  });

  it("marks the current campaign row by WEIGHT, not colour alone", () => {
    const rule = /\.a-rows li\[data-active="true"\]\s*\{([^}]*)\}/.exec(s3Block)?.[1];
    expect(rule).toMatch(/font-weight:\s*600/);
  });

  it("collapses the two-column fact grid on narrow screens", () => {
    const narrow = css.slice(css.lastIndexOf("@media (max-width: 1023px)"));
    expect(narrow).toMatch(/a-meta[^}]*grid-template-columns:\s*1fr/);
  });
});
