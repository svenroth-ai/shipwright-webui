/*
 * ON-PHOTO LEGIBILITY FENCE (iterate-2026-07-17-onphoto-legibility-fix).
 *
 * The board CAMPAIGNS rail label, the inbox project group header + subtitle,
 * and the triage group headers ride BARE on the deck-golden photo (below the
 * 300px scrim band). They must therefore use the Weather-Deck ink tokens that
 * FLIP WHITE under `.on-photo` (`--ink` / `--muted`), NOT the legacy `--color-*`
 * aliases — which are computed at `:root` and do NOT flip (see the note in
 * `styles/type-scale.css`), so they stayed dark → invisible on the rigging /
 * low-contrast on the sky (Sven live-UI feedback).
 *
 * AC1 — this asserts each of those labels now uses the flipping token, not the
 *        bare alias (a class/token fence; jsdom can't measure real contrast, so
 *        the real proof is the regenerated visual baseline the orchestrator
 *        eyeballs).
 * AC4 — no `text-shadow` is (re)introduced on ANY of the touched surfaces
 *        (Sven rejected per-glyph shadows, #265 — the fix is the flipping token
 *        + solid/glass grounds, never a shadow).
 *
 * Prove it bites: revert any of those labels to `--color-text` / `--color-muted`,
 * or add a `text-shadow`, and this test goes RED.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Strip block comments (incl. JSX `{/* … *​/}`) + whole-line `//` so our own
 *  explanatory comments (which name the legacy tokens) never false-match. */
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function read(rel: string): string {
  return strip(readFileSync(path.join(SRC, rel), "utf8"));
}

const TOUCHED = [
  "components/external/CampaignsLane.tsx",
  "components/external/BoardStatusFilter.tsx",
  "components/external/TaskBoardColumns.tsx",
  "pages/inbox/InboxProjectSection.tsx",
  "pages/InboxPage.tsx",
  "pages/TriagePage.tsx",
  "components/triage/PerProjectTriageSection.tsx",
  "components/triage/DeferredTriageSection.tsx",
];

describe("on-photo legibility — AC1 flipping-token fence", () => {
  it("board CAMPAIGNS label uses the flipping --muted token, not the legacy alias", () => {
    const src = read("components/external/CampaignsLane.tsx");
    expect(src).toContain("tracking-wide text-[var(--muted)]");
    expect(src).not.toMatch(/text-\[var\(--color-muted/);
    expect(src).not.toMatch(/hover:text-\[var\(--color-text/);
  });

  it("inbox project group header uses --ink / --muted, not --color-text / --color-muted", () => {
    const src = read("pages/inbox/InboxProjectSection.tsx");
    expect(src).toContain('color: "var(--ink)"');
    expect(src).toContain('color: "var(--muted)"');
    expect(src).not.toContain('color: "var(--color-text)"');
    expect(src).not.toContain('color: "var(--color-muted)"');
  });

  it("triage group + project headers use --ink / --muted, not the legacy text aliases", () => {
    // Moved to PerProjectTriageSection.tsx (iterate-2026-08-05-triage-
    // deferred-envelope extraction) — TriagePage.tsx itself no longer
    // renders these headers directly.
    const src = read("components/triage/PerProjectTriageSection.tsx");
    expect(src).toMatch(/text-\[var\(--ink\)\]/);
    expect(src).toMatch(/text-\[var\(--muted\)\]/);
    expect(src).not.toMatch(/text-\[var\(--color-text\)\]/);
    expect(src).not.toMatch(/text-\[var\(--color-muted\)\]/);
  });

  it("Deferred section's heading + hidden-count hint (bare on-photo) use the flipping tokens — but its in-card item detail (opaque surface) may keep --color-muted (iterate-2026-08-08-triage-filters-sort-parked, AC7)", () => {
    const src = read("components/triage/DeferredTriageSection.tsx");
    // The <h3> and the AC7 hint ride bare on the photo, like the group/project
    // headers above — must use the flipping tokens.
    expect(src).toMatch(/text-\[var\(--ink\)\]/);
    expect(src).toContain('data-testid="triage-deferred-hidden-count"');
    // A real fence, not just a presence check (code-reviewer finding #7).
    // No exact-string pin on the full className here (re-review finding
    // NEW-7 — a harmless addition like `mt-1` would redden this for no
    // legibility reason, and it's redundant with the regex fence below,
    // which already fails closed on the load-bearing property):
    // this file legitimately keeps --color-muted / --color-text for the id
    // + revisit-date + title spans (they sit inside the opaque
    // bg-[var(--color-surface)] item buttons), so a whole-file ban would be
    // a false positive. Instead, isolate the specific hidden-count-hint
    // element by its unique testid and assert THAT element's className
    // never regresses to the legacy alias — a future edit that swaps
    // `--muted` back to `--color-muted` on this one line goes RED even
    // though the file still contains `--color-muted` elsewhere.
    const hintElement = src.match(
      /<p\s+className="([^"]*)"\s+data-testid="triage-deferred-hidden-count"/,
    );
    expect(hintElement).not.toBeNull();
    expect(hintElement?.[1]).not.toMatch(/--color-muted/);
  });
});

describe("on-photo legibility — grade-result band pill resets to solid-surface tokens (iterate-2026-08-26-grade-pill-contrast)", () => {
  // The GRADE door's head (ring + headline + band pill) rides BARE on the
  // scene photo, like the surfaces above — it is not wrapped in a `.iw-card`.
  // The pill draws `background: var(--inset)` / `color: var(--body)` inline.
  // `--inset` is never in rule 1's bare-chrome flip list, so it stays the
  // light default even under `.on-photo`; `--body` DOES flip to
  // `rgba(255,255,255,.9)` there. Without a class rule 2's solid-surface
  // reset targets, that pairing is white text on a light pill — invisible.
  // `.pill` is that hook (on-photo.css rule 2's selector list, and the class
  // `type-scale.css` names for exactly this: "grade pills").
  it("GradeResult's band pill carries a class the .on-photo solid-surface reset targets", () => {
    const src = read("components/wizard/IntentWizard/GradeResult.tsx");
    const band = src.match(/<span\s+className="([^"]*)"\s+data-testid="wizard-grade-band"/);
    expect(band, "wizard-grade-band span must carry a className before its data-testid").not.toBeNull();

    const onPhotoCss = readFileSync(path.join(SRC, "styles/on-photo.css"), "utf8");
    const resetRule = onPhotoCss.match(/\.on-photo\s+:is\(([^)]*)\)\s*\{[^}]*--body:/);
    expect(resetRule, "on-photo.css rule-2 solid-surface reset (targets --body) not found").not.toBeNull();
    const resetSelectors = (resetRule?.[1] ?? "").split(",").map((s) => s.trim().replace(/^\./, ""));

    const bandClasses = (band?.[1] ?? "").split(/\s+/).filter(Boolean);
    expect(
      bandClasses.some((c) => resetSelectors.includes(c)),
      `wizard-grade-band classes [${bandClasses.join(", ")}] must include one of the .on-photo reset selectors, else --body flips white while --inset stays light`,
    ).toBe(true);
  });
});

describe("on-photo legibility — New-Project plan card phase list resets to solid-surface tokens (iterate-2026-09-19-fix-wizard-plan-card-white-text)", () => {
  // The New-Project wizard's "Here's what I understood." plan card renders a
  // white phase list (Project/Design/Plan/.../Deploy) with a per-phase
  // description in `--ink`. Like GradeResult's band pill above, this rides
  // inside `.on-photo`, which flips `--ink` to #fff (rule 1) and only resets
  // it back to dark-on-white (rule 2) for classes in on-photo.css's reset
  // list. Root cause: the phase-list container was a bare inline-styled
  // <div> — not in that list — so --ink stayed white on its own white
  // (`var(--card)`) background: invisible text (Sven screenshot report,
  // 2026-09-19). Fix: give it `.iw-card`, the exact class its sibling
  // envVarsRequired block already uses for the identical background/border/
  // radius/shadow (NewPathPlanCard.tsx).
  // Order-independent: matches the whole opening <div ...> tag for the
  // testid, then extracts className/style from within it, so attribute
  // reordering (or an attribute inserted between className and
  // data-testid) can't produce a misleading null-match RED (code-review
  // finding, iterate-2026-09-19).
  function findPlanPhasesTag(src: string): string {
    const tag = src.match(/<div\b[^>]*data-testid="wizard-plan-phases"[^>]*>/);
    expect(tag, "wizard-plan-phases opening tag not found").not.toBeNull();
    return tag?.[0] ?? "";
  }

  it("wizard-plan-phases container carries a class the .on-photo solid-surface reset targets", () => {
    const src = read("components/wizard/IntentWizard/NewPathPlanCard.tsx");
    const tag = findPlanPhasesTag(src);
    const classAttr = tag.match(/className="([^"]*)"/);
    expect(classAttr, "wizard-plan-phases container must carry a className").not.toBeNull();

    const onPhotoCss = readFileSync(path.join(SRC, "styles/on-photo.css"), "utf8");
    const resetRule = onPhotoCss.match(/\.on-photo\s+:is\(([^)]*)\)\s*\{[^}]*--ink:/);
    expect(resetRule, "on-photo.css rule-2 solid-surface reset (targets --ink) not found").not.toBeNull();
    const resetSelectors = (resetRule?.[1] ?? "").split(",").map((s) => s.trim().replace(/^\./, ""));

    const containerClasses = (classAttr?.[1] ?? "").split(/\s+/).filter(Boolean);
    expect(
      containerClasses.some((c) => resetSelectors.includes(c)),
      `wizard-plan-phases classes [${containerClasses.join(", ")}] must include one of the .on-photo reset selectors, else --ink flips white while the card background stays white`,
    ).toBe(true);
  });

  // External plan review finding (iterate-2026-09-19, glm, low severity): a
  // class-membership fence alone doesn't stop a FUTURE edit from re-adding an
  // opaque inline background directly on this container while keeping
  // `iw-card` — which would silently reintroduce white-on-white while this
  // test stayed green. Pin the "solid surfaces come from the whitelisted
  // class, not inline background/shadow overrides" rule directly.
  it("wizard-plan-phases container sets no inline background/boxShadow (must come from the .on-photo-reset class, not an inline override)", () => {
    const src = read("components/wizard/IntentWizard/NewPathPlanCard.tsx");
    const tag = findPlanPhasesTag(src);
    // Widened per code-review finding (iterate-2026-09-19): the original
    // /background\s*:/ pattern did not match the `backgroundColor` inline-
    // style key, which is the more idiomatic React spelling and would have
    // reintroduced the exact white-on-white defect this fence guards
    // against while staying green.
    expect(tag).not.toMatch(/background(Color|Image)?\s*:/i);
    expect(tag).not.toMatch(/boxShadow\s*:/);
  });
});

describe("on-photo legibility — AC4 no text-shadow on the touched surfaces", () => {
  for (const rel of TOUCHED) {
    it(`${rel} introduces no text-shadow`, () => {
      const src = read(rel);
      expect(src).not.toMatch(/text-shadow/i);
      expect(src).not.toMatch(/textShadow/);
    });
  }
});
