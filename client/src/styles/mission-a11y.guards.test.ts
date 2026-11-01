/*
 * MISSION ACCESSIBILITY GUARDS - campaign mission-desktop-style-v2, V9 (mockup Boards 10 + 12).
 *
 * Stylesheet fences (jsdom cannot see layout, so these assert the CSS itself), for the Mission
 * family: mission-*.css plus the Files & Terminal / tree / viewer sheets V5-V8 added.
 *   1. No text below 12px - not in a literal, not in a shared `--fs-*` scale token.
 *   2. Only the RUNNING dot animates; every other motion is gated to `no-preference`; under
 *      `prefers-reduced-motion: reduce` the running dot is still (final state complete).
 *   3. A visible focus ring: no `:focus-visible` rule removes the outline without a ring, and
 *      every Mission `--focus` token is a 3px teal ring.
 *   4. Touch: the controls the mockup names are 44px on a coarse pointer / phone.
 *
 * @covers FR-01.66
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const FAMILY = [
  ...readdirSync(dir).filter((f) => /^mission-.*\.css$/.test(f)),
  "files-terminal.css",
  "folder-tree.css",
  "smart-viewer-code.css",
].sort();
const MISSION = FAMILY.filter((f) => f.startsWith("mission-"));
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const src = (f: string) => strip(readFileSync(path.join(dir, f), "utf8"));

/** Top-level rules as {prelude, body}; at-rule bodies are returned whole (nested rules inside). */
function rules(css: string): Array<{ prelude: string; body: string }> {
  const out: Array<{ prelude: string; body: string }> = [];
  let depth = 0;
  let start = 0;
  let bodyStart = -1;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      if (depth === 0) bodyStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        out.push({ prelude: css.slice(start, bodyStart).trim(), body: css.slice(bodyStart + 1, i) });
        start = i + 1;
      }
    }
  }
  return out;
}

/** Every plain rule, flattened out of @media; `media` is the enclosing condition ('' = none). */
function flat(css: string): Array<{ media: string; selector: string; body: string }> {
  const out: Array<{ media: string; selector: string; body: string }> = [];
  for (const r of rules(css)) {
    if (r.prelude.startsWith("@media")) {
      for (const inner of rules(r.body)) out.push({ media: r.prelude, selector: inner.prelude, body: inner.body });
    } else if (!r.prelude.startsWith("@")) {
      out.push({ media: "", selector: r.prelude, body: r.body });
    }
  }
  return out;
}

describe("1. nothing below 12px", () => {
  it.each(FAMILY)("%s declares no font-size under 12px", (f) => {
    const bad: string[] = [];
    for (const m of src(f).matchAll(/font-size:\s*([\d.]+)(px|rem)/g)) {
      const px = Number(m[1]) * (m[2] === "rem" ? 16 : 1);
      if (px < 12) bad.push(`${m[1]}${m[2]}`);
    }
    // `font:` shorthand carries a size too.
    for (const m of src(f).matchAll(/[;{\s]font:\s*(?:[\w-]+\s+)*([\d.]+)(px|rem)/g)) {
      const px = Number(m[1]) * (m[2] === "rem" ? 16 : 1);
      if (px < 12) bad.push(`font: ${m[1]}${m[2]}`);
    }
    expect(bad, `${f}: sub-12px text`).toEqual([]);
  });

  it("every shared --fs-* scale token is at least 12px", () => {
    const seen: string[] = [];
    for (const f of MISSION) {
      for (const m of src(f).matchAll(/--fs-[a-z]+:\s*([\d.]+)px/g)) {
        seen.push(m[0]);
        expect(Number(m[1]), `${f}: ${m[0]}`).toBeGreaterThanOrEqual(12);
      }
    }
    expect(seen.length).toBeGreaterThan(0);
  });
});

const MOTION = /\b(?:animation|transition)(?:-name)?\s*:(?!\s*(?:none|0s?|0ms)\s*(?:;|$))[^;}]+/g;
/** The only elements allowed to animate on their own: a status dot that means "running". */
const RUNNING_DOTS = [".ag-dot", ".mc-feed-subrunner-dot"];

describe("2. only the running dot animates, never under reduced motion", () => {
  it.each(MISSION)("%s: motion is gated or is a running dot", (f) => {
    const css = src(f);
    expect(css, `${f} must not define keyframes`).not.toMatch(/@keyframes/);
    const offenders: string[] = [];
    for (const r of flat(css)) {
      if (!MOTION.test(r.body)) continue;
      MOTION.lastIndex = 0;
      const gated = /prefers-reduced-motion:\s*no-preference/.test(r.media);
      const dot = RUNNING_DOTS.includes(r.selector) && r.media === "";
      if (!gated && !dot) offenders.push(r.selector);
    }
    expect(offenders, `${f}: ungated motion`).toEqual([]);
  });

  it.each(RUNNING_DOTS)("%s is still under prefers-reduced-motion: reduce", (sel) => {
    const reduced = MISSION.flatMap((f) => flat(src(f))).filter(
      (r) => /prefers-reduced-motion:\s*reduce/.test(r.media) && r.selector.split(",").map((s) => s.trim()).includes(sel),
    );
    expect(reduced.map((r) => r.body).join(" ")).toMatch(/animation:\s*none/);
  });

  it("the running dot has a base rule with no other animated sibling in the family", () => {
    const animated = MISSION.flatMap((f) => flat(src(f)))
      .filter((r) => r.media === "" && /animation\s*:(?!\s*none)/.test(r.body))
      .map((r) => r.selector)
      .sort();
    expect(animated).toEqual([...RUNNING_DOTS].sort());
  });
});

describe("3. a visible 3px teal focus ring", () => {
  it.each(FAMILY)("%s: :focus-visible never drops the outline without a ring", (f) => {
    const bad = flat(src(f))
      .filter((r) => r.selector.includes(":focus-visible") && /outline(?:-style)?\s*:\s*(?:none|0)\b/.test(r.body))
      .filter((r) => !/box-shadow\s*:/.test(r.body))
      .map((r) => r.selector);
    expect(bad, `${f}: focus ring removed`).toEqual([]);
  });

  it("every --focus token the Mission family sets is a 3px ring", () => {
    const seen: string[] = [];
    for (const f of FAMILY) {
      const css = src(f);
      for (const m of css.matchAll(/--focus:\s*([^;]+);/g)) {
        seen.push(m[1]);
        expect(m[1].trim(), `${f}: --focus`).toMatch(/^0 0 0 3px /);
      }
    }
    expect(seen.length).toBeGreaterThan(0);
  });
});

/** Does some rule matching `selector` set a 44px height inside a coarse-pointer / phone query? */
function touch44(selector: string): boolean {
  return FAMILY.flatMap((f) => flat(src(f))).some(
    (r) =>
      /pointer:\s*coarse|max-width:\s*(?:767|1023|640)px/.test(r.media) &&
      r.selector.split(",").map((s) => s.trim()).includes(selector) &&
      /(?:min-)?height:\s*44px/.test(r.body),
  );
}

describe("4. 44px touch targets on a coarse pointer", () => {
  it.each([
    ".mc-agents-chip",
    ".ag-icon-btn",
    ".ag-tab",
    ".tr-btn",
    ".mc-result-btn",
    "button.mc-handback-chip",
    ".sv-wrap-toggle",
    ".ft-node",
    ".ft-more",
    ".env-output",
    ".env-more",
    ".env-refresh",
    ".sv-outside-copy",
  ])("%s", (sel) => {
    expect(touch44(sel), `${sel} needs a 44px rule under @media (pointer: coarse) or the phone breakpoint`).toBe(true);
  });

  it("agent rows are 56px on the phone", () => {
    const row = flat(src("mission-agents.css")).find((r) => /max-width:\s*767px/.test(r.media) && r.selector === ".ag-row");
    expect(row?.body).toMatch(/min-height:\s*56px/);
  });
});

describe("5. a tablist is a real box", () => {
  it("no role=tablist element is styled display: contents (older Safari drops the role)", () => {
    const root = path.resolve(dir, "../components");
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx$/.test(e.name) && !/\.test\./.test(e.name)) {
          const t = readFileSync(p, "utf8");
          for (const m of t.matchAll(/role="tablist"[^>]*?(?=>)/gs)) {
            if (/className="[^"]*\bcontents\b/.test(m[0]) || /display:\s*"?contents/.test(m[0])) offenders.push(`${e.name}`);
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
