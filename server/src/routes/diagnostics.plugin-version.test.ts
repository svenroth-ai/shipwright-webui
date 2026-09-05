/*
 * diagnostics.plugin-version.test.ts
 * (iterate-2026-09-05-nav-collapse-and-version-badges).
 *
 * `/api/diagnostics` additively exposes `shipwrightPlugin.version` — the
 * shipwright plugin SUITE version, read from the "shipwright" marketplace
 * manifest under ~/.claude/plugins/marketplaces/shipwright. Diagnostics
 * shows it next to `app.version` (the webui's own version) so an operator
 * can see both at a glance.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createDiagnosticsRoutes } from "./diagnostics.js";
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

async function probe(
  readPluginVersion: () => Promise<string | null>,
): Promise<{ shipwrightPlugin: { version: string | null } }> {
  const app = new Hono();
  app.route(
    "/",
    createDiagnosticsRoutes({
      store: fakeStore(),
      versionInfo: versionInfoStub() as never,
      appVersion: "1.2.3",
      readPluginVersion,
    }),
  );
  const res = await app.request("/api/diagnostics");
  return res.json() as never;
}

describe("diagnostics.shipwrightPlugin.version", () => {
  it("surfaces the resolved plugin suite version", async () => {
    const json = await probe(async () => "0.33.1");
    expect(json.shipwrightPlugin.version).toBe("0.33.1");
  });

  it("is null when the plugin isn't installed / unresolvable, without failing the route", async () => {
    const json = await probe(async () => null);
    expect(json.shipwrightPlugin.version).toBeNull();
  });

  it("defaults to the real ~/.claude marketplace-manifest reader when no override is given", async () => {
    const app = new Hono();
    app.route(
      "/",
      createDiagnosticsRoutes({
        store: fakeStore(),
        versionInfo: versionInfoStub() as never,
        appVersion: "1.2.3",
      }),
    );
    const res = await app.request("/api/diagnostics");
    const json = (await res.json()) as { shipwrightPlugin: { version: string | null } };
    // No assumption on the CI machine's ~/.claude state — just must not throw
    // and must always carry the key.
    expect(json).toHaveProperty("shipwrightPlugin.version");
  });
});
