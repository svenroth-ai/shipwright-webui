import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  readLoopAttachments,
  campaignSlugFromSpecPath,
} from "./campaign-loop-state.js";

const NOW = Date.parse("2026-06-08T12:00:00.000Z");
const recent = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("campaign-loop-state: campaignSlugFromSpecPath", () => {
  it("extracts the slug from a Windows-backslash spec_path", () => {
    expect(
      campaignSlugFromSpecPath(
        ".shipwright\\planning\\iterate\\campaigns\\2026-06-08-foo\\sub-iterates\\D1-x.md",
      ),
    ).toBe("2026-06-08-foo");
  });

  it("extracts the slug from a POSIX spec_path", () => {
    expect(
      campaignSlugFromSpecPath(
        ".shipwright/planning/iterate/campaigns/2026-06-08-foo/sub-iterates/D1-x.md",
      ),
    ).toBe("2026-06-08-foo");
  });

  it("returns null when there is no campaigns/<slug> segment", () => {
    expect(campaignSlugFromSpecPath(".shipwright/planning/iterate/foo/D1.md")).toBeNull();
    expect(campaignSlugFromSpecPath("campaigns")).toBeNull(); // trailing, no slug
    expect(campaignSlugFromSpecPath("")).toBeNull();
  });
});

describe("campaign-loop-state: readLoopAttachments", () => {
  let workDir: string;
  let projectRoot: string;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), "campaign-loop-"));
    projectRoot = realpathSync(workDir);
    mkdirSync(path.join(projectRoot, ".shipwright"), { recursive: true });
    delete process.env.SHIPWRIGHT_CAMPAIGN_ATTACH_STALE_MS;
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
    delete process.env.SHIPWRIGHT_CAMPAIGN_ATTACH_STALE_MS;
  });

  function seed(state: unknown): void {
    writeFileSync(
      path.join(projectRoot, ".shipwright", "loop_state.json"),
      typeof state === "string" ? state : JSON.stringify(state, null, 2),
      "utf-8",
    );
  }

  function subIterateState(units: Array<Record<string, unknown>>) {
    return { loop_id: "sub_iterate-x", kind: "sub_iterate", units };
  }

  it("AC-1: returns the slug of a live in_progress sub_iterate unit (backslash path)", () => {
    seed(
      subIterateState([
        {
          id: "D1",
          status: "in_progress",
          spec_path:
            ".shipwright\\planning\\iterate\\campaigns\\2026-06-08-foo\\sub-iterates\\D1-x.md",
          started_at: recent(60_000),
        },
      ]),
    );
    expect([...readLoopAttachments(projectRoot, NOW)]).toEqual(["2026-06-08-foo"]);
  });

  it("AC-2: ∅ when the loop_state file is missing", () => {
    expect(readLoopAttachments(projectRoot, NOW).size).toBe(0);
  });

  it("AC-2: ∅ when the JSON is torn/garbage", () => {
    seed("{ this is not json");
    expect(readLoopAttachments(projectRoot, NOW).size).toBe(0);
  });

  it("AC-2: ∅ when kind is not sub_iterate (a /shipwright-build section loop)", () => {
    seed({
      loop_id: "section-x",
      kind: "section",
      units: [
        {
          id: "S1",
          status: "in_progress",
          spec_path:
            ".shipwright/planning/iterate/campaigns/2026-06-08-foo/sub-iterates/S1.md",
          started_at: recent(60_000),
        },
      ],
    });
    expect(readLoopAttachments(projectRoot, NOW).size).toBe(0);
  });

  it("AC-2: ∅ when no unit is in_progress (all pending/complete)", () => {
    seed(
      subIterateState([
        { id: "D1", status: "complete", spec_path: "campaigns/2026-06-08-foo/sub-iterates/D1.md" },
        { id: "D2", status: "pending", spec_path: "campaigns/2026-06-08-foo/sub-iterates/D2.md" },
      ]),
    );
    expect(readLoopAttachments(projectRoot, NOW).size).toBe(0);
  });

  it("AC-2: ∅ when the in_progress unit's started_at is older than the stale window", () => {
    seed(
      subIterateState([
        {
          id: "D1",
          status: "in_progress",
          spec_path: "campaigns/2026-06-08-foo/sub-iterates/D1.md",
          started_at: recent(7 * 60 * 60 * 1000), // 7h > 6h default
        },
      ]),
    );
    expect(readLoopAttachments(projectRoot, NOW).size).toBe(0);
  });

  it("treats an in_progress unit with a missing started_at as live (conservative)", () => {
    seed(
      subIterateState([
        { id: "D1", status: "in_progress", spec_path: "campaigns/2026-06-08-foo/sub-iterates/D1.md" },
      ]),
    );
    expect([...readLoopAttachments(projectRoot, NOW)]).toEqual(["2026-06-08-foo"]);
  });

  it("honors SHIPWRIGHT_CAMPAIGN_ATTACH_STALE_MS override", () => {
    process.env.SHIPWRIGHT_CAMPAIGN_ATTACH_STALE_MS = "1000"; // 1s window
    seed(
      subIterateState([
        {
          id: "D1",
          status: "in_progress",
          spec_path: "campaigns/2026-06-08-foo/sub-iterates/D1.md",
          started_at: recent(5_000), // 5s ago → now stale
        },
      ]),
    );
    expect(readLoopAttachments(projectRoot, NOW).size).toBe(0);
  });

  it("collects multiple slugs but skips units without a campaigns segment", () => {
    seed(
      subIterateState([
        {
          id: "D1",
          status: "in_progress",
          spec_path: "campaigns/2026-06-08-foo/sub-iterates/D1.md",
          started_at: recent(1000),
        },
        // not under a campaigns/ dir → ignored
        { id: "X", status: "in_progress", spec_path: ".shipwright/iterate/X.md", started_at: recent(1000) },
      ]),
    );
    expect([...readLoopAttachments(projectRoot, NOW)]).toEqual(["2026-06-08-foo"]);
  });
});
