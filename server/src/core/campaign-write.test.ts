import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { setCampaignStatus, CampaignWriteError } from "./campaign-write.js";
import { readStatusJson, pickLifecycle } from "./campaign-status-json.js";
import { parseFrontmatter } from "./campaign-parse.js";

describe("campaign-write: setCampaignStatus", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "campaign-write-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function md(frontmatter: string, body = "# Campaign\n\nbody text with a status: word in prose\n"): void {
    writeFileSync(path.join(dir, "campaign.md"), `---\n${frontmatter}---\n\n${body}`, "utf-8");
  }

  it("sets top-level status in status.json when present, leaving sub_iterates intact (scoped)", () => {
    const original = {
      campaign: "c",
      branch_strategy: "stacked",
      status: "draft",
      sub_iterates: [
        { id: "B0", slug: "alpha", status: "pending", commit: null, branch: null },
      ],
    };
    writeFileSync(path.join(dir, "status.json"), JSON.stringify(original, null, 2), "utf-8");
    setCampaignStatus(dir, "active");
    const after = readStatusJson(dir)!;
    expect(after.status).toBe("active");
    expect(after.sub_iterates).toEqual(original.sub_iterates); // scoped: untouched
    // read-after-write parity: the reader sees active
    expect(pickLifecycle(after, {})).toBe("active");
  });

  it("status.json wins over frontmatter (writes json when both exist)", () => {
    writeFileSync(
      path.join(dir, "status.json"),
      JSON.stringify({ status: "draft", sub_iterates: [] }, null, 2),
      "utf-8",
    );
    md("campaign: c\nstatus: draft\n");
    setCampaignStatus(dir, "active");
    expect(readStatusJson(dir)!.status).toBe("active");
    // pickLifecycle reads json-first → active
    expect(pickLifecycle(readStatusJson(dir), parseFrontmatter(readFileSync(path.join(dir, "campaign.md"), "utf-8")))).toBe("active");
  });

  it("replaces an existing frontmatter status: line when there is no status.json", () => {
    md("campaign: c\nbranch_strategy: stacked\nstatus: draft\n");
    setCampaignStatus(dir, "active");
    const text = readFileSync(path.join(dir, "campaign.md"), "utf-8");
    expect(parseFrontmatter(text).status).toBe("active");
    expect(pickLifecycle(null, parseFrontmatter(text))).toBe("active");
    // body untouched
    expect(text).toContain("body text with a status: word in prose");
    // no duplicate status key
    expect((text.match(/^status:/gm) ?? []).length).toBe(1);
  });

  it("inserts a status: line into a frontmatter block that lacks one", () => {
    md("campaign: c\nbranch_strategy: stacked\n");
    setCampaignStatus(dir, "active");
    expect(parseFrontmatter(readFileSync(path.join(dir, "campaign.md"), "utf-8")).status).toBe("active");
  });

  it("handles CRLF frontmatter without corrupting line endings", () => {
    writeFileSync(
      path.join(dir, "campaign.md"),
      "---\r\ncampaign: c\r\nstatus: draft\r\n---\r\n\r\n# Campaign\r\n",
      "utf-8",
    );
    setCampaignStatus(dir, "active");
    const text = readFileSync(path.join(dir, "campaign.md"), "utf-8");
    expect(parseFrontmatter(text).status).toBe("active");
    expect(text).toContain("\r\n"); // CRLF preserved
  });

  it("throws no_writable_status_target when neither status.json nor a frontmatter block exists", () => {
    writeFileSync(path.join(dir, "campaign.md"), "# Campaign\n\nno frontmatter here\n", "utf-8");
    try {
      setCampaignStatus(dir, "active");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CampaignWriteError);
      expect((err as CampaignWriteError).code).toBe("no_writable_status_target");
    }
  });

  it("rejects an invalid lifecycle status", () => {
    writeFileSync(path.join(dir, "status.json"), JSON.stringify({ sub_iterates: [] }), "utf-8");
    expect(() => setCampaignStatus(dir, "bananas" as unknown as "active")).toThrow(CampaignWriteError);
  });

  // ---- review MEDIUM #1 / #2: frontmatter regex must not corrupt content ----

  it("refuses a campaign.md whose leading `---` is a thematic break around prose (no key line)", () => {
    // No status.json; campaign.md opens with a `---` rule, contains prose, then
    // another `---`. The block has NO top-level `key:` line → must NOT splice
    // `status:` into the prose; refuse with no_writable_status_target instead.
    const original =
      "---\n\nThis is a horizontal-rule-led doc with no frontmatter.\n\n---\n\nfooter prose\n";
    writeFileSync(path.join(dir, "campaign.md"), original, "utf-8");
    expect(() => setCampaignStatus(dir, "active")).toThrow(CampaignWriteError);
    try {
      setCampaignStatus(dir, "active");
    } catch (err) {
      expect((err as CampaignWriteError).code).toBe("no_writable_status_target");
    }
    // content byte-identical (never written)
    expect(readFileSync(path.join(dir, "campaign.md"), "utf-8")).toBe(original);
  });

  it("does not de-indent a nested `status:` key — only the top-level lifecycle field is written", () => {
    // Frontmatter has a top-level `campaign:` + a nested `status:` under `meta:`
    // but NO top-level `status:`. setCampaignStatus must leave the nested line
    // byte-intact and APPEND a top-level `status: active`.
    writeFileSync(
      path.join(dir, "campaign.md"),
      "---\ncampaign: c\nmeta:\n  status: nested-should-stay\n---\n\n# Campaign\n",
      "utf-8",
    );
    setCampaignStatus(dir, "active");
    const text = readFileSync(path.join(dir, "campaign.md"), "utf-8");
    expect(text).toContain("  status: nested-should-stay"); // nested untouched
    expect(text).toMatch(/^status: active$/m); // top-level appended
    // exactly one top-level status key
    expect((text.match(/^status:/gm) ?? []).length).toBe(1);
  });
});
