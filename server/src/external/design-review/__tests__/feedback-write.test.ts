/*
 * feedback-write.test.ts — POST /design-feedback: the round-file write
 * round-trip boundary test (touches_io_boundary; AC2/AC3/AC4).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";

import { makeApp, VIEWER_MD, PROJECT_ID } from "./_helpers.js";

let dir: string;
let designsDir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "designrev-write-"));
  designsDir = path.join(dir, ".shipwright", "designs");
  mkdirSync(designsDir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function post(app: Hono, bodyMd: string, headers: Record<string, string> = {}) {
  return app.request(`/api/external/projects/${PROJECT_ID}/design-feedback`, {
    method: "POST",
    headers: { "content-type": "text/markdown", ...headers },
    body: bodyMd,
  });
}

describe("POST /design-feedback (round-file write)", () => {
  it("writes round 1 into an empty designs dir and returns { round: 1 }", async () => {
    const res = await post(makeApp(dir), VIEWER_MD);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      round: 1,
      path: ".shipwright/designs/design-feedback-round1.md",
      written: true,
    });
    expect(readdirSync(designsDir)).toContain("design-feedback-round1.md");
  });

  it("computes N from disk (round1,round3 → writes round4), NOT from the body's 'Round 1' (AC3)", async () => {
    writeFileSync(path.join(designsDir, "design-feedback-round1.md"), "old");
    writeFileSync(path.join(designsDir, "design-feedback-round3.md"), "old");
    const res = await post(makeApp(dir), VIEWER_MD);
    expect((await res.json()).round).toBe(4);
    const written = readFileSync(path.join(designsDir, "design-feedback-round4.md"), "utf-8");
    // Heading normalized to the disk round, em-dash preserved (AC4).
    expect(written.split("\n")[0]).toBe("# Design Feedback — Round 4");
  });

  it("ROUND-TRIP: the written file re-reads to the exact per-screen/per-split contract shape (AC4)", async () => {
    await post(makeApp(dir), VIEWER_MD);
    const written = readFileSync(path.join(designsDir, "design-feedback-round1.md"), "utf-8");
    expect(written).toMatch(/^# Design Feedback — Round 1$/m); // heading
    expect(written).toContain("## Summary"); // summary table
    expect(written).toMatch(/\| Approved \| 1 \|/);
    expect(written).toMatch(/\| Changes Requested \| 1 \|/);
    expect(written).toMatch(/\| Rejected \| 0 \|/);
    expect(written).toContain("## Core"); // per-split heading
    expect(written).toMatch(/### #01 Dashboard — CHANGES/); // per-screen status
    expect(written).toMatch(/### #02 Settings — APPROVED/);
    expect(written).toContain("**File:** screens/01-dashboard.html");
    expect(written).toContain("**FRs:** FR-01.09");
    expect(written).toContain("Tighten the header spacing."); // free-text preserved
    // The ONLY server transform is the round integer — otherwise verbatim.
    expect(written).toBe(VIEWER_MD); // round is already 1 here
  });

  it("400 not_design_feedback when the body is not a feedback file", async () => {
    const res = await post(makeApp(dir), "# Random Notes\n\nhello");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("not_design_feedback");
  });

  it("400 designs_dir_missing when .shipwright/designs is absent", async () => {
    rmSync(designsDir, { recursive: true, force: true });
    const res = await post(makeApp(dir), VIEWER_MD);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("designs_dir_missing");
  });

  it("does NOT clobber an existing round file (exclusive create — R6)", async () => {
    writeFileSync(path.join(designsDir, "design-feedback-round1.md"), "SENTINEL round1");
    const res = await post(makeApp(dir), VIEWER_MD);
    expect((await res.json()).round).toBe(2);
    expect(readFileSync(path.join(designsDir, "design-feedback-round1.md"), "utf-8")).toBe(
      "SENTINEL round1",
    );
  });

  it("413 when the declared Content-Length exceeds the cap", async () => {
    const res = await post(makeApp(dir), VIEWER_MD, {
      "content-length": String(3 * 1024 * 1024),
    });
    expect(res.status).toBe(413);
  });

  it("404 when the project is unknown", async () => {
    const res = await post(makeApp(dir, { project: null }), VIEWER_MD);
    expect(res.status).toBe(404);
  });
});
