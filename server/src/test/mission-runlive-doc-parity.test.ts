/*
 * mission-runlive-doc-parity.test.ts — `runLive` is documented the same, and
 * accurately, on both sides of the hand-kept wire mirror
 * (iterate-2026-07-21-mission-recovery-memo-perf).
 *
 * The defect this pins (internal code review of PR #309, DOC): the client mirror
 * described `runLive` as "a validated pointer whose worktree git still
 * registers" — the condition BEFORE the external plan review added the terminal
 * one. The implementation is `chosen.isWorktree && events.status !== "found"`,
 * so a run that has recorded `work_completed` is not live even while its
 * worktree survives. A reader of the mirror would have concluded the opposite.
 *
 * `mission-context-types-sync.test.ts` cannot catch this: it compares the SHAPES
 * and deliberately strips comments first, so prose is invisible to it. Hence a
 * separate, deliberately narrow ratchet — and it is not a spell-check, because
 * clause 3 ties the prose to the expression that actually computes the field.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// server/src/test/ → repo root
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const SERVER_TYPES = "server/src/core/mission-context/types.ts";
const CLIENT_MIRROR = "client/src/lib/missionContextApi.ts";
const RESOLVER = "server/src/core/mission-context/resolver.ts";

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

/**
 * The doc block immediately preceding `runLive: boolean;`, NORMALIZED — comment
 * prefixes stripped and whitespace collapsed. Without that, the clause patterns
 * below would be matching against ` * ` and hard line wraps, and would break on
 * a reflow that changed nothing a reader cares about.
 */
function runLiveDoc(rel: string): string {
  const src = read(rel);
  const at = src.indexOf("runLive: boolean;");
  expect(at, `${rel} declares runLive`).toBeGreaterThan(-1);
  const open = src.lastIndexOf("/**", at);
  expect(open, `${rel} documents runLive`).toBeGreaterThan(-1);
  return src
    .slice(open, at)
    .replace(/^\s*\/?\*+\/?/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every clause a reader needs in order to predict the field's value. Checking
 * PRESENCE of `work_completed` alone was the first draft, and the external code
 * review was right that it is not parity: two materially different descriptions
 * would both pass. Comparing the prose verbatim is the other extreme — the two
 * files legitimately word things differently (one is the server contract, one is
 * a client-side mirror that also points at `missionArtifacts.ts`). So both are
 * held to the same CLAUSE SET.
 */
const REQUIRED_CLAUSES: [name: string, pattern: RegExp][] = [
  ["the pointer validated", /validated pointer|pointer validated/i],
  // Two alternatives, not one: the server says "git still registers its
  // worktree", the mirror "whose worktree git still registers". Both are the
  // same clause and neither file should have to adopt the other's sentence.
  ["git still registers the worktree", /still registers its worktree|worktree git still registers/i],
  ["the terminal work_completed condition", /work_completed/],
  ["what the client does with it", /pending/i],
];

describe("runLive — documentation parity between the server SoT and the client mirror", () => {
  it.each([
    ["server", SERVER_TYPES],
    ["client mirror", CLIENT_MIRROR],
  ])("the %s doc carries every clause of the rule", (_side, rel) => {
    const doc = runLiveDoc(rel);
    for (const [name, pattern] of REQUIRED_CLAUSES) {
      expect(doc, `${rel} states: ${name}`).toMatch(pattern);
    }
  });

  it("and the implementation really is that conjunction", () => {
    // Without this the two comments could agree with each other and both be
    // wrong — the failure mode the review actually found, one level up.
    const src = read(RESOLVER);
    expect(src).toMatch(/runLive:\s*chosen\.isWorktree\s*&&\s*events\.status\s*!==\s*"found"/);
  });
});
