/*
 * serve.test.ts — GET /api/external/projects/:id/designs/:rest{.+} (AC1 host).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { injectFeedbackBridge } from "../serve.js";
import { makeApp, PROJECT_ID } from "./_helpers.js";

let dir: string;
let designsDir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "designrev-serve-"));
  designsDir = path.join(dir, ".shipwright", "designs");
  mkdirSync(designsDir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("GET /designs/* (viewer host)", () => {
  it("serves index.html as text/html with the feedback bridge injected before the viewer script", async () => {
    writeFileSync(
      path.join(designsDir, "index.html"),
      "<html><body><h1>Viewer</h1><script>const x=1;</script></body></html>",
    );
    const app = makeApp(dir);
    const res = await app.request(`/api/external/projects/${PROJECT_ID}/designs/index.html`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("shipwright:design-feedback");
    expect(html).toContain("window.showSaveFilePicker");
    expect(html.indexOf("showSaveFilePicker")).toBeLessThan(html.indexOf("const x=1"));
  });

  it("serves a nested screen file verbatim (no bridge) as text/html", async () => {
    mkdirSync(path.join(designsDir, "screens"), { recursive: true });
    writeFileSync(
      path.join(designsDir, "screens", "01-dashboard.html"),
      "<html><body>Dashboard mockup</body></html>",
    );
    const app = makeApp(dir);
    const res = await app.request(
      `/api/external/projects/${PROJECT_ID}/designs/screens/01-dashboard.html`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Dashboard mockup");
    expect(html).not.toContain("shipwright:design-feedback");
  });

  it("does NOT set nosniff / default-src 'none' (would blank the viewer)", async () => {
    writeFileSync(path.join(designsDir, "index.html"), "<html></html>");
    const app = makeApp(dir);
    const res = await app.request(`/api/external/projects/${PROJECT_ID}/designs/index.html`);
    expect(res.headers.get("x-content-type-options")).toBeNull();
    expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'self'");
  });

  it("404 for a missing asset", async () => {
    const app = makeApp(dir);
    const res = await app.request(`/api/external/projects/${PROJECT_ID}/designs/nope.html`);
    expect(res.status).toBe(404);
  });

  it("rejects traversal outside the designs subtree (R5)", async () => {
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(path.join(dir, "src", "secret.ts"), "TOP SECRET");
    const app = makeApp(dir);
    const res = await app.request(
      `/api/external/projects/${PROJECT_ID}/designs/${encodeURIComponent("../../src/secret.ts")}`,
    );
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("TOP SECRET");
  });

  it("415 for an unsupported asset extension", async () => {
    writeFileSync(path.join(designsDir, "notes.exe"), "binary");
    const app = makeApp(dir);
    const res = await app.request(`/api/external/projects/${PROJECT_ID}/designs/notes.exe`);
    expect(res.status).toBe(415);
  });
});

describe("injectFeedbackBridge (unit)", () => {
  it("inserts before </body> when there is no <script>", () => {
    const out = injectFeedbackBridge("<html><body>x</body></html>");
    expect(out.indexOf("showSaveFilePicker")).toBeLessThan(out.indexOf("</body>"));
  });
  it("appends when there is neither <script> nor </body>", () => {
    expect(injectFeedbackBridge("<div>x</div>")).toContain("showSaveFilePicker");
  });
});
