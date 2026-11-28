/*
 * The request-path hardening the Hono bump brings, driven through a REAL
 * `@hono/node-server` listener with the same `serveStatic` wiring as
 * server/src/index.ts (`app.use("/*", serveStatic({ root }))`) and a catch-all
 * route standing in for the SPA fallback (iterate-2026-11-28-hono-cve-bump).
 *
 *   - CVE-2026-126210 (@hono/node-server 2.1.6): a raw backslash in the request
 *     path is rejected with 400 instead of being read as "/", so a path that a
 *     proxy saw one way is never routed as another.
 *   - CVE-2026-118663 (@hono/node-server 2.1.3): serveStatic no longer decodes a
 *     second time; a path still holding "%" after decoding is refused instead of
 *     being served as a different file.
 *   - GHSA-frvp-7c67-39w9 (@hono/node-server 1.19.15 / 2.0.5, still listed as an
 *     accepted risk until a maintainer retires it): an encoded backslash (%5C) in a serveStatic path is never a
 *     way out of, or around, the static root.
 *
 * Raw sockets are used because every HTTP client normalises a backslash before
 * sending it.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { connect, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";

let root: string;
let server: Server;
let port: number;

/** One raw HTTP/1.1 request; resolves with the status code and body. */
function rawGet(target: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.setTimeout(5000, () => socket.destroy(new Error(`timeout waiting for ${target}`)));
      socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
    });
    let data = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => (data += chunk));
    socket.on("error", reject);
    socket.on("end", () => {
      const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(data)?.[1] ?? 0);
      resolve({ status, body: data.slice(data.indexOf("\r\n\r\n") + 4) });
    });
  });
}

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), "hono-path-hardening-"));
  mkdirSync(path.join(root, "assets"));
  writeFileSync(path.join(root, "assets", "app.js"), "served-asset");
  writeFileSync(path.join(root, "secret.txt"), "secret-file");
  writeFileSync(path.join(root, "assets", "100%.js"), "percent-file"); // a real file whose name holds a literal %
  const app = new Hono();
  app.use("/*", serveStatic({ root }));
  app.get("*", (c) => c.text("spa-shell"));
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => resolve()) as Server;
  });
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

describe("request-path hardening of the Hono backend", () => {
  // @covers FR-01.31
  it("serves a static asset and the SPA fallback as before", async () => {
    expect(await rawGet("/assets/app.js")).toMatchObject({ status: 200, body: "served-asset" });
    expect(await rawGet("/tasks/123")).toMatchObject({ status: 200, body: "spa-shell" });
  });

  // @covers FR-01.31
  it("answers 400 to a raw backslash in the path and serves nothing", async () => {
    for (const target of ["/assets\\app.js", "/x\\..\\secret.txt"]) {
      const res = await rawGet(target);
      expect(res.status, target).toBe(400);
      expect(res.body).not.toContain("served-asset");
      expect(res.body).not.toContain("secret-file");
    }
  });

  // @covers FR-01.31
  it("never serves a file through an encoded backslash (%5C)", async () => {
    for (const target of ["/x%5C..%5Csecret.txt", "/assets%5Capp.js"]) {
      const res = await rawGet(target);
      expect(res.body, target).not.toContain("secret-file");
      expect(res.body, target).not.toContain("served-asset");
      expect(res, target).toMatchObject({ status: 200, body: "spa-shell" }); // declined by serveStatic, not an error path
    }
  });

  // @covers FR-01.31
  it("never serves a static file for a path that still holds a percent sign after decoding", async () => {
    // decoded once this is "/assets%2Fapp.js": serveStatic refuses it and the request falls through to the SPA shell;
    // before the fix a second decode made it "/assets/app.js" and the asset was served
    const res = await rawGet("/assets%252Fapp.js");
    expect(res.body).not.toContain("served-asset");
    expect(res).toMatchObject({ status: 200, body: "spa-shell" });
    // a file whose name really holds "%" is not served either: its decoded path still contains "%"
    const literal = await rawGet("/assets/100%25.js");
    expect(literal.body).not.toContain("percent-file");
    expect(literal).toMatchObject({ status: 200, body: "spa-shell" });
  });
});
