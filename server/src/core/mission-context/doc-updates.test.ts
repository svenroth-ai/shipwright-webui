/*
 * doc-updates.test.ts — a run's documentation updates in the Decisions artifact
 * (events-drop-files, issue 978, unit S5b): folded + pending, folded wins, the
 * conflict count, learnings left out, unreadable never reads as "none", and no
 * `.md` file ever renders as an ADR.
 *
 * @covers FR-01.66
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildDecisionsArtifact } from "./artifacts-decisions.js";
import { readRunDecisionRecord } from "./decisions.js";
import { readRunDocUpdates, runBulletFiles } from "./doc-updates.js";
import { FOUND } from "./slice2-test-fixtures.js";

const RUN = "iterate-2026-11-07-docs";
const AGENT = [".shipwright", "agent_docs"];
const BULLETS = [...AGENT, "decision-drops", "bullets"];

let root = "";
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

function project(): string {
  root = mkdtempSync(path.join(tmpdir(), "docupd-"));
  mkdirSync(path.join(root, ...BULLETS), { recursive: true });
  return root;
}
function bullet(r: string, target: string, nonce: string, text: string, key = RUN): void {
  writeFileSync(path.join(r, ...BULLETS, `${target}--${key}--0a1b2c3d--${nonce}.md`), `${text}\n`);
}
function doc(r: string, name: string, text: string): void {
  writeFileSync(path.join(r, ...AGENT, name), text);
}

// @covers FR-01.66
describe("readRunDocUpdates", () => {
  it("reads folded entries and pending bullets of this run only", () => {
    const r = project();
    doc(r, "architecture.md", `# A\n## Architecture Updates\n- **${RUN}** folded line\n- **iterate-2026-01-01-other** not ours\n`);
    bullet(r, "conventions", "11111111", `- **${RUN}** pending line`);
    bullet(r, "architecture", "22222222", "- **iterate-2026-01-01-other** other run", "iterate-2026-01-01-other");
    const out = readRunDocUpdates(r, RUN);
    expect(out.entries).toEqual([
      { target: "architecture", doc: "architecture.md", text: `- **${RUN}** folded line`, state: "folded" },
      { target: "conventions", doc: "conventions.md", text: `- **${RUN}** pending line`, state: "pending" },
    ]);
    expect(out).toMatchObject({ conflicts: 0, malformed: 0, sawUnreadable: false });
  });

  it("folded wins over a pending bullet with the same anchor; a differing text is a conflict", () => {
    const r = project();
    doc(r, "architecture.md", `## Architecture Updates\n- **${RUN}** the folded text\n`);
    bullet(r, "architecture", "11111111", `- **${RUN}** the folded text`);
    bullet(r, "architecture", "22222222", `- **${RUN}** a different text`);
    const out = readRunDocUpdates(r, RUN);
    expect(out.entries.map((e) => e.state)).toEqual(["folded"]);
    expect(out.conflicts).toBe(1);
  });

  it("leaves learnings out and counts this run's malformed bullet files", () => {
    const r = project();
    bullet(r, "learnings", "11111111", `- **${RUN}** a learning`);
    bullet(r, "architecture", "22222222", "- one\n- two");
    const out = readRunDocUpdates(r, RUN);
    expect(out.entries).toEqual([]);
    expect(out.malformed).toBe(1);
    expect(runBulletFiles(r, RUN)).toHaveLength(2);
  });

  it("a doc that exists but cannot be read is unreadable, not empty", () => {
    const r = project();
    mkdirSync(path.join(r, ...AGENT, "conventions.md")); // a folder where the doc should be
    expect(readRunDocUpdates(r, RUN).sawUnreadable).toBe(true);
  });

  it("the legacy layout (no bullets folder, no docs) reads as none, cleanly", () => {
    root = mkdtempSync(path.join(tmpdir(), "docupd-"));
    expect(readRunDocUpdates(root, RUN)).toEqual({ entries: [], conflicts: 0, malformed: 0, sawUnreadable: false });
  });
});

// @covers FR-01.66
describe("Decisions artifact with documentation updates", () => {
  it("a run whose only record is a pending doc update is available, with a plain summary", () => {
    const r = project();
    bullet(r, "architecture", "11111111", `- **${RUN}** pending line`);
    const a = buildDecisionsArtifact(readRunDecisionRecord(r, RUN), FOUND, readRunDocUpdates(r, RUN));
    expect(a.state).toBe("available");
    expect(a.summary).toBe("1 documentation update. Not yet published in a release.");
    expect(a.detail?.entries).toEqual([]);
    expect(a.detail?.docUpdates).toHaveLength(1);
  });

  it("an unreadable doc with no ADR is unavailable, never 'no decisions'", () => {
    const r = project();
    mkdirSync(path.join(r, ...AGENT, "architecture.md"));
    const a = buildDecisionsArtifact(readRunDecisionRecord(r, RUN), FOUND, readRunDocUpdates(r, RUN));
    expect(a.state).toBe("unavailable");
  });

  it("no .md file — a root-level one or a bullet — is ever shown as an ADR", () => {
    const r = project();
    writeFileSync(path.join(r, ...AGENT, "decision-drops", `${RUN}_001.md`), "# looks like a decision\n");
    bullet(r, "architecture", "11111111", `- **${RUN}** a bullet`);
    const rec = readRunDecisionRecord(r, RUN);
    expect(rec.entries).toEqual([]);
    expect(rec.malformedCount).toBe(0);
  });

  it("a run WITH an ADR still discloses doc updates it could not read", () => {
    const r = project();
    writeFileSync(path.join(r, ...AGENT, "decision-drops", `${RUN}_001.json`),
      JSON.stringify({ run_id: RUN, date: "2026-11-07", title: "A decision", decision: "Do it." }));
    mkdirSync(path.join(r, ...AGENT, "conventions.md"));
    const a = buildDecisionsArtifact(readRunDecisionRecord(r, RUN), FOUND, readRunDocUpdates(r, RUN));
    expect(a.state).toBe("available");
    expect(a.summary).toContain("Its documentation updates could not all be read.");
  });

  it("conflicts alone still surface (never hidden as no decisions)", () => {
    const docs = { entries: [], conflicts: 2, malformed: 0, sawUnreadable: false };
    const a = buildDecisionsArtifact(readRunDecisionRecord(project(), RUN), FOUND, docs);
    expect(a.state).toBe("available");
    expect(a.detail?.docUpdateConflicts).toBe(2);
  });
});
