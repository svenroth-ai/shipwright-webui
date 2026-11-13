/*
 * event-log-files.test.ts — every working-tree event reader sees the drops
 * layout (events-drop-files, issue 978, S1): a run that exists ONLY as a drop,
 * archive files, quarantine ignored, per-file status, cache/rev invalidation,
 * absence vs unavailability, and the no-folder regression.
 *
 * @covers FR-01.47
 */

import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readCampaignEvents } from "./campaign-events.js";
import { eventLogFingerprint, eventLogRevPaths, readAssembledEventLog } from "./event-log-files.js";
import { readEventLog } from "./event-log-reader.js";
import { readRunData } from "./run-data-join.js";
import { _clearEventIndexCache, findWorkCompleted } from "./mission-context/iterate-record.js";

const roots: string[] = [];
afterEach(() => {
  _clearEventIndexCache();
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "evf-"));
  roots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text, "utf-8");
  }
  return root;
}

const wc = (runId: string, extra: Record<string, unknown> = {}) =>
  `${JSON.stringify({ id: `id-${runId}`, type: "work_completed", adr_id: runId, ts: "2026-11-01T10:00:00Z", commit: "", ...extra })}\n`;
const D = ".shipwright/events/drops";

// @covers FR-01.47
describe("readers see a run that exists only as a drop file", () => {
  it("events route, runs route, campaigns, Mission lookup", () => {
    const root = tree({
      "shipwright_events.jsonl": wc("iterate-2026-10-01-old"),
      [`${D}/iterate-2026-11-01-new--0a1b2c3d--11111111.jsonl`]: wc("iterate-2026-11-01-new", { campaign: "2026-11-01-c", sub_iterate_id: "S1" }),
      ".shipwright/events/archive/fold-aaaaaaaaaaaa.jsonl": wc("iterate-2026-09-01-archived"),
    });
    expect(new Set(readEventLog(root).runs.map((r) => r.runId))).toEqual(
      new Set(["iterate-2026-11-01-new", "iterate-2026-10-01-old", "iterate-2026-09-01-archived"]));
    expect(readRunData(root).runs.map((r) => r.runId)).toContain("iterate-2026-11-01-new");
    expect(readCampaignEvents(root).get("2026-11-01-c")?.has("S1")).toBe(true);
    expect(findWorkCompleted(root, "iterate-2026-11-01-new").status).toBe("found");
    expect(findWorkCompleted(root, "iterate-2026-09-01-archived").status).toBe("found");
  });

  it("works with NO legacy file at all (drops only)", () => {
    const root = tree({ [`${D}/r--0a1b2c3d--11111111.jsonl`]: wc("iterate-2026-11-02-r") });
    expect(readEventLog(root).runCount).toBe(1);
    expect(findWorkCompleted(root, "iterate-2026-11-02-r").status).toBe("found");
  });

  it("never reads quarantine, the writer's .tmp files, non-jsonl names or sub-folders", () => {
    const root = tree({
      ".shipwright/events/quarantine/x--0a1b2c3d--11111111.jsonl": wc("iterate-q"),
      [`${D}/.r--0a1b2c3d--11111111.jsonl.tmp`]: wc("iterate-hidden"),
      [`${D}/notes.md`]: wc("iterate-md"),
      [`${D}/.keep`]: "",
      [`${D}/nested/y--0a1b2c3d--11111111.jsonl`]: wc("iterate-nested"),
    });
    const log = readAssembledEventLog(root)!;
    expect(log.files).toEqual([]);
    expect(readEventLog(root).runCount).toBe(0);
    expect(findWorkCompleted(root, "iterate-q").status).toBe("absent");
  });
});

// @covers FR-01.47
describe("symlinks and unlistable folders", () => {
  function canSymlink(): boolean {
    const probe = mkdtempSync(path.join(tmpdir(), "evf-ln-"));
    roots.push(probe);
    try {
      symlinkSync(path.join(probe, "nowhere"), path.join(probe, "link"));
      return true;
    } catch {
      return false; // Windows without the symlink privilege
    }
  }

  it.skipIf(!canSymlink())("never reads a symlinked drop file or a symlinked archive folder", () => {
    const outside = tree({ "real.jsonl": wc("iterate-2026-11-04-linked"), "arch/a.jsonl": wc("iterate-2026-11-04-archlink") });
    const root = tree({ [`${D}/.keep`]: "" });
    symlinkSync(path.join(outside, "real.jsonl"), path.join(root, D, "iterate-2026-11-04-linked--0a1b2c3d--11111111.jsonl"));
    symlinkSync(path.join(outside, "arch"), path.join(root, ".shipwright/events/archive"), "dir");
    expect(readAssembledEventLog(root)!.files).toEqual([]);
    expect(findWorkCompleted(root, "iterate-2026-11-04-linked").status).toBe("absent");
    expect(findWorkCompleted(root, "iterate-2026-11-04-archlink").status).toBe("absent");
  });
});

// @covers FR-01.47
describe("Python listing parity", () => {
  it("reads a dot-named *.jsonl drop, as Python's glob does", () => {
    const root = tree({ [`${D}/.r--0a1b2c3d--11111111.jsonl`]: wc("iterate-2026-11-03-dot") });
    expect(findWorkCompleted(root, "iterate-2026-11-03-dot").status).toBe("found");
  });

  it("campaign status ignores a drop-file amendment (campaign_status.py reads the raw log)", () => {
    const sub = { campaign: "c1", sub_iterate_id: "S1" };
    const root = tree({
      [`${D}/iterate-x--0a1b2c3d--11111111.jsonl`]: wc("iterate-x", sub),
      [`${D}/iterate-x--0a1b2c3d--22222222.jsonl`]:
        `${JSON.stringify({ id: "am1", type: "event_amended", amends: "id-iterate-x", fields: { commit: "abc1234" }, ts: "2026-11-01T11:00:00Z" })}\n`,
    });
    // Mission sees the attached commit (effective view); campaign status keeps the raw, empty one.
    expect(readCampaignEvents(root).get("c1")?.get("S1")).toEqual({ commit: "" });
    expect(readRunData(root).runs.find((r) => r.runId === "iterate-x")?.commit).toBe("abc1234");
  });
});

// @covers FR-01.47
describe("per-file status and amendments", () => {
  it("exposes per-file status ONLY when an archive/drop file was read", () => {
    const legacyOnly = tree({ "shipwright_events.jsonl": wc("iterate-a") });
    expect(readEventLog(legacyOnly)).not.toHaveProperty("files");
    expect(readEventLog(legacyOnly)).not.toHaveProperty("duplicateIds");
    const mixed = tree({ "shipwright_events.jsonl": wc("iterate-a"), [`${D}/b--0a1b2c3d--11111111.jsonl`]: "{torn" });
    const p = readEventLog(mixed);
    expect(p.files?.map((f) => [f.path, f.status])).toEqual([
      ["shipwright_events.jsonl", "ok"], [`${D}/b--0a1b2c3d--11111111.jsonl`, "corrupt"],
    ]);
    expect(p.skippedLines).toBe(1); // the drop's torn line counts like a torn legacy line
  });

  it("a drop amendment fills the run's commit; a legacy amendment still does not", () => {
    const am = (target: string) =>
      `${JSON.stringify({ id: `am-${target}`, type: "event_amended", amends: `id-${target}`, fields: { commit: "abc1234" }, ts: "2026-11-01T11:00:00Z" })}\n`;
    const drops = tree({ [`${D}/iterate-x--0a1b2c3d--11111111.jsonl`]: wc("iterate-x"), [`${D}/iterate-x--0a1b2c3d--22222222.jsonl`]: am("iterate-x") });
    expect(readEventLog(drops).runs[0]?.commit).toBe("abc1234");
    const found = findWorkCompleted(drops, "iterate-x");
    expect(found.status === "found" && found.run.commit).toBe("abc1234");
    const legacy = tree({ "shipwright_events.jsonl": wc("iterate-y") + am("iterate-y") });
    expect(readEventLog(legacy).runs[0]?.commit).toBe("");
  });
});

// @covers FR-01.66
describe("Mission lookup: absence vs unavailability, cache invalidation", () => {
  it("a damaged drop of the RUN's key → unavailable; another run's → absent", () => {
    const root = tree({ [`${D}/iterate-mine--0a1b2c3d--11111111.jsonl`]: "{torn", [`${D}/iterate-other--0a1b2c3d--11111111.jsonl`]: wc("iterate-other") });
    expect(findWorkCompleted(root, "iterate-mine").status).toBe("unavailable");
    const other = tree({ [`${D}/iterate-other--0a1b2c3d--11111111.jsonl`]: "{torn", "shipwright_events.jsonl": "" });
    expect(findWorkCompleted(other, "iterate-mine").status).toBe("absent");
  });

  it("a damaged ARCHIVE file blocks every run's absence (a folded run lives only there)", () => {
    const root = tree({ ".shipwright/events/archive/fold-aaaaaaaaaaaa.jsonl": `${wc("iterate-2026-11-01-ok").trim()}\n{torn` });
    expect(findWorkCompleted(root, "iterate-2026-11-01-ok").status).toBe("found");
    expect(findWorkCompleted(root, "iterate-2026-11-02-gone").status).toBe("unavailable");
  });

  it("an EMPTY own drop blocks absence too (kill criterion 8)", () => {
    const root = tree({ [`${D}/iterate-mine--0a1b2c3d--11111111.jsonl`]: "\n" });
    expect(findWorkCompleted(root, "iterate-mine").status).toBe("unavailable");
  });

  it("the cached index, fingerprint and sourceRev paths move when a drop is ADDED or APPENDED", () => {
    const root = tree({ "shipwright_events.jsonl": wc("iterate-a") });
    expect(findWorkCompleted(root, "iterate-b").status).toBe("absent");
    const before = eventLogFingerprint(root);
    const drop = path.join(root, D, "iterate-b--0a1b2c3d--11111111.jsonl");
    mkdirSync(path.dirname(drop), { recursive: true });
    writeFileSync(drop, `${JSON.stringify({ type: "phase_started", ts: "2026-11-01T09:00:00Z" })}\n`, "utf-8");
    expect(eventLogFingerprint(root)).not.toBe(before);
    expect(eventLogRevPaths(root)).toContain(drop);
    expect(findWorkCompleted(root, "iterate-b").status).toBe("absent");
    appendFileSync(drop, wc("iterate-b"), "utf-8"); // an append moves no folder mtime
    expect(findWorkCompleted(root, "iterate-b").status).toBe("found");
  });

  it("no event file at all → absent with mtime 0 (unchanged)", () => {
    expect(findWorkCompleted(tree({}), "iterate-z")).toEqual({ status: "absent", mtimeMs: 0 });
  });
});

// @covers FR-01.47
describe("a project not migrated to .shipwright/events/ yet", () => {
  it("reads the pre-move root folders while the new folder is absent", () => {
    const root = tree({
      "shipwright_events.d/iterate-2026-11-05-old--0a1b2c3d--11111111.jsonl": wc("iterate-2026-11-05-old"),
      "shipwright_events.archive/fold-aaaaaaaaaaaa.jsonl": wc("iterate-2026-09-05-oldarch"),
    });
    expect(findWorkCompleted(root, "iterate-2026-11-05-old").status).toBe("found");
    expect(findWorkCompleted(root, "iterate-2026-09-05-oldarch").status).toBe("found");
  });

  it("prefers the new folder: the old one is not read once the new one exists", () => {
    const root = tree({
      [`${D}/iterate-2026-11-06-new--0a1b2c3d--11111111.jsonl`]: wc("iterate-2026-11-06-new"),
      "shipwright_events.d/iterate-2026-11-06-stale--0a1b2c3d--22222222.jsonl": wc("iterate-2026-11-06-stale"),
    });
    expect(findWorkCompleted(root, "iterate-2026-11-06-new").status).toBe("found");
    expect(findWorkCompleted(root, "iterate-2026-11-06-stale").status).toBe("absent");
  });
});
