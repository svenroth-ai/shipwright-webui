/*
 * The prototype's `__fcDemo` / `__fcBroken` readiness DEMO toggle is a demo
 * affordance — it lets both the ready and not-ready states be seen in the
 * clickable mockup. It MUST NOT ship: a switch that fakes the not-ready state is
 * exactly the "assume success" hazard the real gate exists to kill.
 *
 * This asserts the shipped IntentWizard source carries no such toggle.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DIR = path.dirname(fileURLToPath(import.meta.url));

/** Every shipped .ts/.tsx in the IntentWizard folder except this guard + tests. */
function sourceFiles(): string[] {
  return readdirSync(DIR)
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => !/\.test\.(ts|tsx)$/.test(f))
    .map((f) => path.join(DIR, f));
}

// Strip block + whole-line `//` comments so a documented mention of the toggle
// (e.g. ReadinessGate's "there is deliberately NO __fcDemo") is not miscounted —
// what must not ship is the TOGGLE, not a note that explains its absence.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("no demo affordance ships", () => {
  it("the IntentWizard build contains no __fcDemo / __fcBroken toggle", () => {
    const offenders: string[] = [];
    for (const f of sourceFiles()) {
      const text = stripComments(readFileSync(f, "utf8"));
      if (/__fcDemo|__fcBroken|fcBroken/.test(text)) {
        offenders.push(path.basename(f));
      }
    }
    expect(offenders, `demo toggle leaked into: ${offenders.join(", ")}`).toEqual([]);
  });
});
