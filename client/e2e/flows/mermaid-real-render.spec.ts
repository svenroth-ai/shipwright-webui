/*
 * MERMAID — REAL LIBRARY, REAL SANITIZER, REAL BROWSER.
 * iterate-2026-07-29-mermaid-real-render-e2e.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `MermaidRenderer.test.tsx` stubs the library outright (`vi.mock("mermaid")`
 * returning a canned `<svg>` string), and until this spec there was no e2e
 * coverage either. That combination made the client suite STRUCTURALLY blind to
 * a rendering regression: mermaid draws through a sanitizer dependency
 * (DOMPurify), so a routine patch bump of EITHER package can change or break
 * diagram output while every existing test stays green. During the 2026-07-28
 * dependency triage a DOMPurify bump had to be verified by an ad-hoc probe,
 * because nothing committed to the repo could catch it. This is that probe,
 * made permanent.
 *
 * The unit test and this spec cover disjoint halves and both are load-bearing:
 * the unit test owns MermaidRenderer's WIRING (content-hash memo, StrictMode
 * double-mount, dispose) with a stub fast enough to run 100x; this spec owns
 * whether the real library and the real sanitizer actually PRODUCE a diagram.
 *
 * ── WHAT THIS DOES NOT COVER (read before trusting it) ──────────────────────
 * Scoped honestly after an adversarial review, rather than left implied:
 *
 *  1. FOUR diagram types, not all 21. Mermaid ships each type in its own lazily
 *     imported chunk, so each type is a separate failure surface. Four
 *     independent chunks beats one, but a bump that breaks (say) gantt or
 *     mindmap still passes here.
 *  2. The esbuild path, not the Vite path. The APP loads mermaid through
 *     Vite/Rollup lazy chunks (`import("mermaid")` in MermaidRenderer.tsx, then
 *     mermaid's own dynamic imports); this bundles everything into one IIFE.
 *     A Rollup-only failure — chunk-init order, circular-dep TDZ, hashed-chunk
 *     delivery — would surface for users as "Mermaid failed to render" with
 *     this gate green. `npm run build` in CI catches the build-time half of
 *     that class; the runtime half is genuinely uncovered.
 *  3. It cannot prove the securityLevel-GATED sanitize ran. Mermaid calls
 *     DOMPurify unconditionally for label text and additionally, only when the
 *     level is not "loose", for the finished SVG. Rendering these diagrams at
 *     "strict" and at "loose" was measured to produce near-identical output
 *     (same dimensions, same foreignObject and dominant-baseline counts, ~0.4%
 *     char delta), so no assertion here can distinguish the two. What the
 *     ADD_TAGS/ADD_ATTR assertions DO establish is that those options are
 *     honoured — a DOMPurify regression dropping either turns them red.
 *
 * ── Tagged @smoke on purpose ────────────────────────────────────────────────
 * `E2E smoke (gate)` greps exactly that tag, and a dependency bump lands as a
 * lockfile-only PR that touches no `client/src` file. A spec outside the gate
 * would reproduce the exact blindness this iterate exists to end.
 *
 * ── FALSIFIED (2026-07-29) ──────────────────────────────────────────────────
 * A probe that cannot fail proves nothing, so every assertion class here was
 * degraded and observed to go red:
 *
 *  A. Degrade the DRAWING — cut the flowchart to fewer nodes. Measured under
 *     this spec's own render ids: one node 10 889 chars / 161x70 px, two
 *     12 440 / 179x283, three 14 054 / 209x411, against the real 17 674 /
 *     436x515. The first attempt used an 8 000-char floor and PASSED on a
 *     one-node render: mermaid's injected CSS block alone is ~4.5 kB.
 *  B. Degrade the SANITIZER — swap DOMPurify for an identity passthrough (an
 *     esbuild resolve plugin). `<script` then survives `mermaid.render()`
 *     verbatim: rawHasScriptTag true, one script element in the DOM, against
 *     false / 0 with the real thing. NOTE: flipping `securityLevel` to "loose"
 *     does NOT falsify them — see limitation 3 above.
 *  C. Degrade the BUNDLE — inject a top-level throw. The load check reports
 *     `mermaid bundle did not evaluate; page errors: pageerror: …` instead of
 *     the `Cannot read properties of undefined` it used to die on.
 *  D. Degrade the SANITIZER COUNT — expect two packages. Fails naming the one
 *     real path, proving the metafile scan is wired to reality.
 *
 *  REMOVED as a result of B: an `expect(globalThis.__pwned).toBeNull()` line.
 *  Assigning to `innerHTML` never executes an inserted <script> (HTML spec), so
 *  it stayed green even with the sanitizer stubbed out. An assertion that cannot
 *  fail is not coverage, and reads as security proof it does not provide.
 */

import { test, expect } from "@playwright/test";
import { mermaidBundle, type MermaidGlobal } from "../helpers/mermaid-bundle";
import { DIAGRAM_CASES } from "../helpers/mermaid-diagrams";
import { flushPageEvents, watchForErrors } from "../helpers/page-errors";

/**
 * The securityLevel this spec renders under.
 *
 * Kept honest by a MECHANICAL guard, not by a comment: a synthetic harness that
 * drifts from the component it stands in for tests nothing. That guard is
 * `client/src/test/mermaid-security-level.test.ts`, which reads BOTH this file
 * and `MermaidRenderer.tsx` and pins them equal. It lives with the other
 * meta-tests (vitest) rather than here, so it also runs in the fast
 * `Client (type + lint + test)` gate instead of only behind the container job.
 *
 * If you change this literal, change the component — or the meta-test fails.
 */
const APP_SECURITY_LEVEL = "strict";

test.describe("@smoke mermaid renders with the real library and sanitizer", () => {
  let errors: string[];
  let dompurifyPackages: string[];
  let bundleWarnings: string[];

  test.beforeEach(async ({ page }) => {
    errors = watchForErrors(page);
    // A blank document of our own — this spec deliberately exercises no app
    // route, so nothing but mermaid can be responsible for a failure.
    await page.setContent(
      "<!doctype html><html><body><div id='host'></div></body></html>",
    );

    const bundle = await mermaidBundle();
    dompurifyPackages = bundle.dompurifyPackages;
    bundleWarnings = bundle.warnings;
    await page.addScriptTag({ content: bundle.code });

    // addScriptTag RESOLVES even when the inline script throws at evaluation
    // time: a top-level throw goes to window.onerror, not script.onerror. Left
    // unchecked, the next line detonates as "Cannot read properties of
    // undefined (reading 'initialize')" while the real cause sits unread in
    // `errors` — the wrong error to hand someone debugging from CI artifacts.
    const loaded = await page.evaluate(
      () =>
        typeof (globalThis as unknown as MermaidGlobal).__mermaid?.initialize ===
        "function",
    );
    expect(
      loaded,
      `mermaid bundle did not evaluate; page errors: ${errors.join(" | ")}`,
    ).toBe(true);

    await page.evaluate((securityLevel) => {
      const mermaid = (globalThis as unknown as MermaidGlobal).__mermaid;
      mermaid.initialize({ startOnLoad: false, securityLevel });
    }, APP_SECURITY_LEVEL);
  });

  for (const diagram of DIAGRAM_CASES) {
    test(`renders a real ${diagram.name} diagram — ${diagram.why}`, async ({
      page,
    }) => {
      const out = await page.evaluate(async ([text, renderId]) => {
        const g = globalThis as unknown as MermaidGlobal;
        const { svg } = await g.__mermaid.render(renderId, text);
        const host = document.getElementById("host") as HTMLElement;
        host.innerHTML = svg;
        const el = host.querySelector("svg");

        // Report "no <svg>" as DATA, never as a null dereference. Letting the
        // next line throw would fail this test with a TypeError about
        // `cloneNode`, burying the finding that actually matters.
        if (!el) return { svgPresent: false as const, svgChars: svg.length };

        // Mermaid injects a <style> block INSIDE the svg. Dropping it from a
        // clone before reading text is what stops a label from "passing"
        // because the same word happened to appear in a CSS selector.
        const clone = el.cloneNode(true) as SVGSVGElement;
        clone.querySelectorAll("style").forEach((s) => s.remove());

        const box = el.getBoundingClientRect();
        return {
          svgPresent: true as const,
          svgChars: svg.length,
          rawHasScriptTag: /<script/i.test(svg),
          domScriptCount: host.querySelectorAll("script").length,
          labelText: clone.textContent ?? "",
          width: box.width,
          height: box.height,
          foreignObjects: host.querySelectorAll("foreignObject").length,
          dominantBaseline: (svg.match(/dominant-baseline/g) ?? []).length,
        };
      }, [diagram.source, `mermaid-${diagram.name}`] as const);

      // 1. An <svg> exists at all, and it is a real drawing rather than a stub.
      expect(out.svgPresent, "mermaid.render() produced an <svg>").toBe(true);
      // Unreachable — the assertion above already threw. Present so TypeScript
      // narrows the union the evaluate() callback returns.
      if (!out.svgPresent) return;
      expect(
        out.svgChars,
        `rendered SVG length (measured ${diagram.measuredChars})`,
      ).toBeGreaterThan(diagram.minChars);

      // 2. It occupies real space. A collapsed or errored render measures 0.
      expect(
        out.width,
        `rendered SVG width px (measured ${diagram.measuredWidth})`,
      ).toBeGreaterThan(diagram.minWidth);
      expect(
        out.height,
        `rendered SVG height px (measured ${diagram.measuredHeight})`,
      ).toBeGreaterThan(diagram.minHeight);

      // 3. Every label the source declared actually got drawn.
      for (const label of diagram.labels) {
        expect(out.labelText, `label "${label}" is drawn`).toContain(label);
      }

      // 4. The DOMPurify options mermaid depends on are still honoured. Under
      // "strict" the finished SVG is sanitized, and these survive ONLY because
      // mermaid passes ADD_TAGS/ADD_ATTR — a regression there drops HTML labels
      // or mis-aligns diagram text while leaving text and geometry intact, so
      // nothing else in this file would notice.
      expect(
        out.foreignObjects,
        "<foreignObject> survivors (DOMPurify ADD_TAGS)",
      ).toBeGreaterThanOrEqual(diagram.minForeignObjects);
      expect(
        out.dominantBaseline,
        "dominant-baseline survivors (DOMPurify ADD_ATTR)",
      ).toBeGreaterThanOrEqual(diagram.minDominantBaseline);

      // 5. mermaid injects nothing executable of its own. NOTE: these inputs
      // carry NO script payload, so this pair CANNOT fail on a sanitizer
      // regression — the load-bearing pair lives in the sanitizer test below.
      expect(out.rawHasScriptTag, "raw SVG contains no <script").toBe(false);
      expect(out.domScriptCount, "script elements in the DOM").toBe(0);

      // 6. Nothing threw or logged on the way.
      await flushPageEvents(page);
      expect(errors, "console errors during render").toEqual([]);
    });
  }

  test("the sanitizer strips a script payload from a node label, inside render()", async ({
    page,
  }) => {
    const payload = [
      "graph TD",
      '  X["safe-label-token<script>globalThis.__pwned = 1</script>"] --> Y[Downstream]',
    ].join("\n");

    const out = await page.evaluate(async (text) => {
      const g = globalThis as unknown as MermaidGlobal;
      const { svg } = await g.__mermaid.render("mermaid-sanitize", text);
      const host = document.getElementById("host") as HTMLElement;
      host.innerHTML = svg;
      return {
        // Asserting on the RAW STRING is the whole point: if the tag were still
        // present here and only vanished after innerHTML, the credit would
        // belong to the browser's parser, not to mermaid's sanitizer.
        rawHasScriptTag: /<script/i.test(svg),
        domScriptCount: host.querySelectorAll("script").length,
        text: host.querySelector("svg")?.textContent ?? "",
      };
    }, payload);

    // Both of these were observed to FLIP (true / 1) with DOMPurify stubbed out
    // — see falsification B in the header.
    expect(out.rawHasScriptTag, "mermaid.render() output contains no <script").toBe(
      false,
    );
    expect(out.domScriptCount, "script elements in the DOM").toBe(0);

    // Over-stripping is a regression too — a sanitizer that ate the whole label
    // would satisfy every assertion above while silently breaking real diagrams.
    expect(out.text, "safe part of the label survives").toContain(
      "safe-label-token",
    );
    expect(out.text, "the sibling node still renders").toContain("Downstream");

    await flushPageEvents(page);
    expect(errors, "console errors during render").toEqual([]);
  });

  test("mermaid resolves exactly one DOMPurify, and esbuild reports no warnings", () => {
    // The bundle entry imports ONLY mermaid, so this count reflects mermaid's
    // own resolution and is load-bearing in both directions: 0 means it dropped
    // or vendored its sanitizer, 2 means a duplicate copy is in play and the
    // sanitizer under test is not necessarily the one mermaid calls. That
    // property is why `dompurify` is deliberately NOT a declared dependency of
    // this package — see the iterate record, finding S1-2.
    expect(
      dompurifyPackages,
      `exactly one DOMPurify package, got: ${dompurifyPackages.join(", ") || "(none)"}`,
    ).toHaveLength(1);

    // esbuild WARNS rather than throws when it cannot cleanly follow a dynamic
    // import — a harness watching a dependency must not swallow the bundler's
    // diagnostics about it.
    expect(bundleWarnings, "esbuild warnings while bundling mermaid").toEqual([]);
  });
});
