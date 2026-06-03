import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { readStatusJson, pickLifecycle } from "./campaign-status-json.js";

describe("campaign-status-json: readStatusJson", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "campaign-statusjson-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(content: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "status.json"), content, "utf-8");
  }

  it("returns null when status.json is absent", () => {
    expect(readStatusJson(dir)).toBeNull();
  });

  it("parses a valid status.json object (producer format)", () => {
    write(
      JSON.stringify({
        campaign: "c",
        branch_strategy: "stacked",
        status: "active",
        sub_iterates: [{ id: "B0", slug: "alpha", status: "pending" }],
      }),
    );
    const s = readStatusJson(dir);
    expect(s).not.toBeNull();
    expect(s!.status).toBe("active");
    expect(Array.isArray(s!.sub_iterates)).toBe(true);
  });

  it("returns null on a torn / half-written file (the 3s-poll race)", () => {
    write('{ "status": "act');
    expect(readStatusJson(dir)).toBeNull();
  });

  it("returns null for a top-level array (not an object)", () => {
    write("[1,2,3]");
    expect(readStatusJson(dir)).toBeNull();
  });
});

describe("campaign-status-json: pickLifecycle", () => {
  it("status.json top-level status wins", () => {
    expect(pickLifecycle({ status: "active" }, { status: "draft" })).toBe("active");
  });

  it("falls back to the campaign.md frontmatter status", () => {
    expect(pickLifecycle(null, { status: "draft" })).toBe("draft");
    expect(pickLifecycle({}, { status: "complete" })).toBe("complete");
  });

  it("is case-insensitive + trims", () => {
    expect(pickLifecycle({ status: "  ACTIVE " }, {})).toBe("active");
  });

  it("returns null when absent or invalid (legacy fallback)", () => {
    expect(pickLifecycle(null, {})).toBeNull();
    expect(pickLifecycle({ status: "bananas" }, {})).toBeNull();
    expect(pickLifecycle({ status: 42 as unknown as string }, {})).toBeNull();
  });
});
