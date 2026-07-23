/*
 * Meta-test — the create-CTA primary-button RATCHET.
 *
 * iterate-2026-07-21-all-projects-new-button-parity. The standard itself lives
 * in client/src/styles/buttons.css; read its header for the contract (fixed
 * geometry, not just a colour: same height, same min-width, same radius —
 * PageHead right-aligns the actions cluster, so equal geometry ⇒ equal
 * position).
 *
 * Why a ratchet. The SAME defect has now been reported three times:
 *   round 1 (2026-07-17) — "New task" / "Create Project" / Ship's Log each
 *     re-implemented a different teal;
 *   round 2 (2026-07-17) — the unified standard was still too light and
 *     inconsistent in size + position;
 *   round 3 (2026-07-21) — the All-Projects "New" trigger had been missed by
 *     both passes and still hand-rolled `bg-[var(--color-primary)] px-4 py-2`.
 * Rounds 1+2 were fixed with per-component edits, which is exactly why round 3
 * survived: a per-component assertion only protects components that already
 * exist and were remembered. The failure mode is a create button that is NEW,
 * or simply overlooked, re-typing the primary look by hand. Only a source scan
 * over the whole family catches that.
 *
 * `bg-[var(--color-primary)]` is not a cosmetic near-miss: inside the board
 * header `.chrome-dark-controls` re-points --color-primary at #35B8A4, the
 * brighter teal buttons.css records as RETIRED (it failed against the Resume
 * CTA / modal Launch reference). A hand-rolled create button therefore lands on
 * the retired colour by construction.
 *
 * Division of labour — this file guards the FAMILY (registry drift + no local
 * re-implementation); that the canonical class sits on the trigger ELEMENT is
 * asserted by the component render tests (ProjectCreateCascade.test.tsx,
 * ProjectCreatePhoneMenu.test.tsx, CreateMenuSplitButton.test.tsx,
 * pages/ProjectsPage.test.tsx). Neither half is sufficient alone.
 *
 * Registry-driven SSoT: BOTH drift directions are enforced below — forward
 * (every registry entry resolves to a file) and reverse (every file rendering a
 * create-CTA trigger has a registry entry). Same shape as
 * modal-scroll-body-invariant.test.ts / doc-sync.test.ts.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The canonical classes from styles/buttons.css. */
const CANONICAL = ["btn-primary", "btn-primary-split"];

/** Every component that renders a board/page "New" or "Create" CTA. */
const CREATE_CTA_FILES = [
  "components/external/CreateMenuSplitButton.tsx",
  "components/external/ProjectCreateCascade.tsx",
  "components/external/ProjectCreatePhoneMenu.tsx",
  "pages/ProjectsPage.tsx",
  // Ship's Log grew a `.btn-primary` "New ▾" launcher
  // (iterate-2026-07-23-intent-launcher-front-door).
  "pages/ShipsLogPage.tsx",
];

/**
 * A create-CTA trigger, identified by its testid: a create-ish name ending in
 * the role it plays (button / trigger / primary / caret). Deliberately keyed on
 * the testid rather than on the styling, so a NEW create button is caught by
 * the reverse check BEFORE it has any styling to judge.
 */
const TRIGGER_TESTID =
  /data-testid="[^"]*create[^"]*(?:button|trigger|primary|caret)"/;

/** A locally re-implemented primary background — the exact round-3 defect. */
const HAND_ROLLED_PRIMARY_BG =
  /bg-\[var\(--color-primary\)\]|background:\s*var\(--color-primary\)|#35[Bb]8[Aa]4/;

/** `className="…"`, `className={`…`}`, `className={"…"}` — literal forms only. */
const CLASS_ATTR = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/gs;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!full.endsWith(".tsx")) return [];
    if (full.endsWith(".test.tsx")) return [];
    return [full];
  });
}

function classNames(src: string): string[] {
  const out: string[] = [];
  for (const m of stripComments(src).matchAll(CLASS_ATTR)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return out;
}

describe("create-CTA primary-button standard", () => {
  // Forward drift: a registry entry that no longer resolves means the file was
  // renamed or split and the guard silently stopped covering it.
  it("every registry entry resolves to a file on disk", () => {
    for (const rel of CREATE_CTA_FILES) {
      expect(existsSync(path.join(SRC, rel)), `missing: ${rel}`).toBe(true);
    }
  });

  // Reverse drift: the round-3 failure mode. A create button that exists but is
  // not in the registry is exactly what escaped rounds 1 and 2.
  it("every file rendering a create-CTA trigger is in the registry", () => {
    const registered = new Set(
      CREATE_CTA_FILES.map((rel) => path.join(SRC, rel)),
    );
    const unregistered = sourceFiles(SRC).filter(
      (f) => TRIGGER_TESTID.test(stripComments(readFileSync(f, "utf8"))) &&
        !registered.has(f),
    );
    expect(
      unregistered.map((f) => path.relative(SRC, f)),
      "new create CTA found — add it to CREATE_CTA_FILES and put it on .btn-primary",
    ).toEqual([]);
  });

  it("each create CTA references the canonical button class", () => {
    for (const rel of CREATE_CTA_FILES) {
      const src = stripComments(readFileSync(path.join(SRC, rel), "utf8"));
      expect(
        CANONICAL.some((c) => src.includes(c)),
        `${rel} renders a create CTA but never references .btn-primary`,
      ).toBe(true);
    }
  });

  it("no create CTA re-implements the primary background locally", () => {
    for (const rel of CREATE_CTA_FILES) {
      const src = readFileSync(path.join(SRC, rel), "utf8");
      const offenders = classNames(src).filter((c) =>
        HAND_ROLLED_PRIMARY_BG.test(c),
      );
      expect(
        offenders,
        `${rel} hand-rolls the primary background — use .btn-primary ` +
          `(--color-primary resolves to the RETIRED #35B8A4 under ` +
          `.chrome-dark-controls)`,
      ).toEqual([]);
    }
  });
});
