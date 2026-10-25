/**
 * @covers FR-01.75
 * Drift guard (CLAUDE.md DO-NOT #7: no cross-package imports, so shared rules are
 * verbatim mirrors guarded by a test that reads the other package's SOURCE).
 * The wizard's profile-name rule must equal the server's, which mirrors the
 * monorepo resolver's NAME_RE: a name the wizard sends that the monorepo refuses
 * would fail `/shipwright-run` at its first step.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { MAX_PROFILE_NAME_LENGTH, PROFILE_NAME_RE } from "../components/wizard/IntentWizard/contract";

const here = path.dirname(fileURLToPath(import.meta.url)); // client/src/test
const serverSource = readFileSync(path.join(here, "..", "..", "..", "server", "src", "core", "stack-profiles.ts"), "utf-8");

function constantValue(name: string): string {
  const marker = `export const ${name} = `;
  const start = serverSource.indexOf(marker);
  expect(start, `${name} is declared in the server`).toBeGreaterThanOrEqual(0);
  const from = start + marker.length;
  return serverSource.slice(from, serverSource.indexOf(";", from)).trim();
}

describe("profile-name rule: client mirror equals the server", () => {
  it("// @covers FR-01.75 the pattern is identical, source and flags", () => {
    expect(constantValue("PROFILE_NAME_RE")).toBe(`/${PROFILE_NAME_RE.source}/${PROFILE_NAME_RE.flags}`);
  });

  it("// @covers FR-01.75 the length cap is identical", () => {
    expect(Number(constantValue("MAX_PROFILE_NAME_LENGTH"))).toBe(MAX_PROFILE_NAME_LENGTH);
  });
});
