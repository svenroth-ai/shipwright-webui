/*
 * Boundary probes for the decision-drop format (ADR-024 / confidence
 * calibration).
 *
 * The producer is `write_decision_drop.py` — a PYTHON writer on Windows, feeding
 * a Node reader. That crossing is exactly where encoding assumptions go wrong,
 * and the real drops in this repository already contain em-dashes and other
 * non-ASCII, so this is not a hypothetical. These cases probe the crossing
 * rather than asserting confidence in it.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { readRunDrops } from "./decision-drops.js";

const RUN = "iterate-2026-07-19-example";
const DROPS = [".shipwright", "agent_docs", "decision-drops"];
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

function makeProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), "sw-probe-"));
  mkdirSync(path.join(root, ...DROPS), { recursive: true });
  return root;
}

function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    run_id: RUN,
    date: "2026-07-19",
    title: "A decision",
    decision: "Do the thing.",
    ...over,
  };
}

function write(root: string, name: string, raw: string | Buffer): void {
  writeFileSync(path.join(root, ...DROPS, name), raw);
}

describe("decision-drop boundary probes — the Python→Node crossing", () => {
  it("reads NON-ASCII content (em-dash, accents, CJK) intact", () => {
    const root = makeProject();
    try {
      const title = "Rückgängig — 決定 — café";
      write(root, `${RUN}_001.json`, Buffer.from(JSON.stringify(body({ title })), "utf-8"));
      const r = readRunDrops(root, RUN);
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      expect(r.entries).toHaveLength(1);
      // Absolute expectation — mojibake would still be "a string".
      expect(r.entries[0].title).toBe(title);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("survives a UTF-8 BOM rather than reporting the drop as malformed", () => {
    const root = makeProject();
    try {
      // A BOM makes `JSON.parse` throw on the very first character, which would
      // silently reclassify a perfectly good decision as unreadable.
      const raw = Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(JSON.stringify(body({ title: "BOM-prefixed" })), "utf-8"),
      ]);
      write(root, `${RUN}_001.json`, raw);
      const r = readRunDrops(root, RUN);
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      expect(r.entries).toHaveLength(1);
      expect(r.entries[0].title).toBe("BOM-prefixed");
      expect(r.malformed).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads a CRLF-formatted drop — Windows producers write them", () => {
    const root = makeProject();
    try {
      const pretty = JSON.stringify(body({ title: "CRLF" }), null, 2).replace(/\n/g, "\r\n");
      write(root, `${RUN}_001.json`, Buffer.from(pretty, "utf-8"));
      const r = readRunDrops(root, RUN);
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      expect(r.entries[0].title).toBe("CRLF");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps EMBEDDED newlines in a multi-paragraph field", () => {
    const root = makeProject();
    try {
      const decision = "First paragraph.\n\nSecond paragraph.\n- a bullet";
      write(root, `${RUN}_001.json`, Buffer.from(JSON.stringify(body({ decision })), "utf-8"));
      const r = readRunDrops(root, RUN);
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      expect(r.entries[0].markdown).toContain("Second paragraph.");
      expect(r.entries[0].markdown).toContain("- a bullet");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("treats an EMPTY-STRING field as absent rather than rendering a blank heading", () => {
    const root = makeProject();
    try {
      // The real drops carry `"commit": ""` — an empty value, not a missing key.
      write(root, `${RUN}_001.json`, Buffer.from(JSON.stringify(body({ commit: "", rejected: "" })), "utf-8"));
      const r = readRunDrops(root, RUN);
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      expect(r.entries[0].markdown).not.toContain("**Commit:**");
      expect(r.entries[0].markdown).not.toContain("Rejected alternatives");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores a non-JSON neighbour in the same directory", () => {
    const root = makeProject();
    try {
      write(root, `${RUN}_001.json`, Buffer.from(JSON.stringify(body()), "utf-8"));
      write(root, `${RUN}_notes.txt`, Buffer.from("scratch", "utf-8"));
      write(root, "README.md", Buffer.from("# drops", "utf-8"));
      const r = readRunDrops(root, RUN);
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      expect(r.entries).toHaveLength(1);
      // A neighbouring non-JSON file is not a damaged decision.
      expect(r.malformed).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("decision-drop bounds probes — round 2 (the caps, driven for real)", () => {
  it("a drop OVER the byte cap is malformed, not a crash and not silence", () => {
    const root = makeProject();
    try {
      // 600 KB > the 512 KB cap.
      write(root, `${RUN}_001.json`, Buffer.from(JSON.stringify(body({ decision: "x".repeat(600_000) })), "utf-8"));
      const r = readRunDrops(root, RUN);
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      expect(r.entries).toHaveLength(0);
      // Counted, so the artifact discloses it rather than reporting no decision.
      expect(r.malformed).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a JSON ARRAY or scalar is malformed, never coerced into an entry", () => {
    const root = makeProject();
    try {
      write(root, `${RUN}_001.json`, Buffer.from("[1,2,3]", "utf-8"));
      write(root, `${RUN}_002.json`, Buffer.from('"just a string"', "utf-8"));
      write(root, `${RUN}_003.json`, Buffer.from("null", "utf-8"));
      const r = readRunDrops(root, RUN);
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      expect(r.entries).toHaveLength(0);
      expect(r.malformed).toBe(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("an over-long FIELD is clipped, and the clip is visible in the body", () => {
    const root = makeProject();
    try {
      write(root, `${RUN}_001.json`, Buffer.from(JSON.stringify(body({ decision: "y".repeat(20_000) })), "utf-8"));
      const r = readRunDrops(root, RUN);
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      expect(r.entries).toHaveLength(1);
      // 16 KB field cap + the ellipsis marker — never a silent truncation.
      expect(r.entries[0].markdown).toContain("…");
      expect(r.entries[0].markdown.length).toBeLessThan(20_000);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("more drops than the ENTRY cap reports truncation rather than quietly capping", () => {
    const root = makeProject();
    try {
      for (let i = 1; i <= 25; i++) {
        const n = String(i).padStart(3, "0");
        write(root, `${RUN}_${n}.json`, Buffer.from(JSON.stringify(body({ title: `Decision ${n}` })), "utf-8"));
      }
      const r = readRunDrops(root, RUN);
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      expect(r.entries).toHaveLength(20);
      expect(r.truncated).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a DIRECTORY named like a drop is skipped, not read as one", () => {
    const root = makeProject();
    try {
      mkdirSync(path.join(root, ...DROPS, `${RUN}_001.json`), { recursive: true });
      write(root, `${RUN}_002.json`, Buffer.from(JSON.stringify(body({ title: "Real" })), "utf-8"));
      const r = readRunDrops(root, RUN);
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      expect(r.entries).toHaveLength(1);
      expect(r.entries[0].title).toBe("Real");
      // The directory is not a damaged decision — it is not a decision at all.
      expect(r.malformed).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("REAL drops on disk — every one of them, through the shipped reader", () => {
  it("parses EVERY real drop in this repository with zero malformed", () => {
    const dir = path.join(REPO_ROOT, ...DROPS);
    let names: string[];
    try {
      names = readdirSync(dir).filter((n) => n.endsWith(".json"));
    } catch {
      return; // gitignored — absent on a fresh clone
    }
    if (names.length === 0) return;

    // Derive each run_id from the file's own CONTENT, not by splitting the
    // filename — run ids contain hyphens and the `_NNN` suffix is the only
    // reliable separator.
    const runIds = new Set<string>();
    for (const n of names) {
      try {
        const o = JSON.parse(readFileSync(path.join(dir, n), "utf-8")) as { run_id?: unknown };
        if (typeof o.run_id === "string") runIds.add(o.run_id);
      } catch {
        /* a genuinely damaged drop is the reader's problem, asserted below */
      }
    }
    expect(runIds.size).toBeGreaterThan(0);

    let read = 0;
    for (const runId of runIds) {
      const r = readRunDrops(REPO_ROOT, runId);
      expect(r.status, `run ${runId} must be readable`).toBe("ok");
      if (r.status !== "ok") continue;
      expect(r.malformed, `run ${runId} had malformed drops`).toBe(0);
      expect(r.entries.length, `run ${runId} yielded no entry`).toBeGreaterThan(0);
      for (const e of r.entries) {
        // A rendered drop must carry its own title and its run id — an empty or
        // truncated body would still be "a string", so assert the content.
        expect(e.title.length).toBeGreaterThan(0);
        expect(e.markdown).toContain(runId);
      }
      read += r.entries.length;
    }
    // Every real drop on disk resolved to a rendered decision.
    expect(read).toBeGreaterThanOrEqual(runIds.size);
  });
});
