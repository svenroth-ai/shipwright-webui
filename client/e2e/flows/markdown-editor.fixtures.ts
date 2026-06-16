/*
 * Fixtures + route mocks for the SmartViewer markdown-editor spec
 * (markdown-editor.spec.ts, FR-01.34). Extracted so the spec stays focused on
 * behaviour and under the 300-LOC file guideline.
 *
 * Both the GET (load) and PUT (save) file endpoints are route-mocked so the
 * specs need no live backend. Line endings are built from char codes — literal
 * "\n" escapes in editor-written source have been written as real control bytes
 * and corrupted files in this repo before (project memory).
 */

import { type Page } from "@playwright/test";

export const NL = String.fromCharCode(10);

export const DOC_V1 = "# Title\n\nOriginal body paragraph.\n";
export const DOC_V2 = "# Title\n\nSaved new body paragraph.\n";

export const FM_DOC = [
  "---",
  'title: "My Post"',
  'slug: "my-post"',
  'keywords: ["a", "b"]',
  "---",
  "",
  "First paragraph stays put.",
  "",
  "Second paragraph also untouched.",
  "",
].join(NL);

// A content-marketing blog article (the user's exact bug scenario): YAML
// frontmatter + an inline `<a href>` attribution link to Shipwright in the body.
export const BLOG_DOC = [
  "---",
  'title: "Why SDLC Automation Matters"',
  'slug: "sdlc-automation"',
  'date: "2026-06-16"',
  "---",
  "",
  "Great content about shipping software faster.",
  "",
  'Built with <a href="https://github.com/svenroth-ai/shipwright">Shipwright</a>.',
  "",
].join(NL);

export async function mockApi(page: Page, opts: { putStatus?: number } = {}) {
  const putStatus = opts.putStatus ?? 200;
  let saved = false;
  await page.route("**/api/external/projects/**/file**", async (route) => {
    if (route.request().method() === "PUT") {
      saved = true;
      if (putStatus === 409) {
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: "fingerprint_mismatch",
            currentFingerprint: "sha256:disk",
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ written: true, fingerprint: "sha256:v2", size: DOC_V2.length }),
      });
    }
    // GET — after a successful save, serve the updated content (AC5b).
    const body = saved && putStatus === 200 ? DOC_V2 : DOC_V1;
    return route.fulfill({
      status: 200,
      contentType: "text/markdown; charset=utf-8",
      headers: { ETag: '"sha256:v1"' },
      body,
    });
  });
}

export async function mockFrontmatterFile(page: Page): Promise<{ putBody: string | null }> {
  const captured: { putBody: string | null } = { putBody: null };
  await page.route("**/api/external/projects/**/file**", async (route) => {
    if (route.request().method() === "PUT") {
      captured.putBody = route.request().postData();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ written: true, fingerprint: "sha256:fm2", size: FM_DOC.length }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "text/markdown; charset=utf-8",
      headers: { ETag: '"sha256:fm1"' },
      body: FM_DOC,
    });
  });
  return captured;
}

export async function mockBlogFile(page: Page): Promise<{ putBody: string | null }> {
  const captured: { putBody: string | null } = { putBody: null };
  await page.route("**/api/external/projects/**/file**", async (route) => {
    if (route.request().method() === "PUT") {
      captured.putBody = route.request().postData();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ written: true, fingerprint: "sha256:blog2", size: BLOG_DOC.length }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "text/markdown; charset=utf-8",
      headers: { ETag: '"sha256:blog1"' },
      body: BLOG_DOC,
    });
  });
  return captured;
}
