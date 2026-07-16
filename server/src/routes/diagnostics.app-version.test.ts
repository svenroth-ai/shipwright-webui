/*
 * diagnostics.app-version.test.ts — A06 (FR-01.49)
 *
 * `/api/diagnostics` exposes the WebUI's OWN version additively. The npx
 * bootstrapper (`@svenroth-ai/shipwright`) reads `app.version` to decide
 * attach-vs-swap against a server already holding :3847. This field must be
 * present regardless of `claudeCli.supported`, must be overridable (test
 * seam), and must default to the real `server/package.json` version.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createDiagnosticsRoutes, readAppVersion, APP_NAME } from "./diagnostics.js";
import type { SdkSessionsStore } from "../core/sdk-sessions-store.js";

function fakeStore(): SdkSessionsStore {
  return { list: () => [], get: () => undefined } as unknown as SdkSessionsStore;
}

function versionInfoStub() {
  return () => ({
    raw: "2.1.132 (Claude Code)",
    parsed: { major: 2, minor: 1, patch: 132 },
    supported: true,
  });
}

async function probe(appVersion?: string): Promise<{ app: { name: string; version: string }; claudeCli: { supported: boolean } }> {
  const app = new Hono();
  app.route(
    "/",
    createDiagnosticsRoutes({
      store: fakeStore(),
      versionInfo: versionInfoStub() as never,
      appVersion,
    }),
  );
  const res = await app.request("/api/diagnostics");
  return res.json() as never;
}

describe("A06 — diagnostics.app.version (attach-vs-swap source of truth)", () => {
  it("defaults to the real server/package.json version", async () => {
    const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../package.json");
    const expected = (JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string }).version;
    const json = await probe();
    expect(json.app.version).toBe(expected);
    expect(json.app.version).not.toBe("unknown");
  });

  it("readAppVersion() resolves a non-empty semver-shaped string", () => {
    const v = readAppVersion();
    expect(v).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("honors an explicit appVersion override (test seam)", async () => {
    const json = await probe("9.9.9");
    expect(json.app.version).toBe("9.9.9");
  });

  it("carries the stable wire-protocol identity name (foreign-process guard)", async () => {
    const json = await probe("1.2.3");
    expect(json.app.name).toBe(APP_NAME);
    expect(APP_NAME).toBe("shipwright-command-center");
  });

  it("is present even on the happy path (supported=true, no diagnostic block)", async () => {
    const json = await probe("1.2.3");
    expect(json.claudeCli.supported).toBe(true);
    expect(json.app.version).toBe("1.2.3");
  });
});
