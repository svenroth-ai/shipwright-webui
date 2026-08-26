/*
 * file-read-write.test.ts — GET/PUT /api/external/org/file.
 *
 * Standalone Hono app (no router-level host/secret gate here — that's
 * `routes.test.ts`'s concern) so these tests exercise the allowlist +
 * atomic-write + If-Match + symlink-defense contract in isolation.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  lstatSync,
  openSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { registerOrgFileRead } from "../file-read.js";
import { registerOrgFileWrite, ORG_WRITE_MAX_BYTES } from "../file-write.js";
import { fileFingerprint } from "../../file/_helpers.js";

describe("GET/PUT /api/external/org/file", () => {
  let leadsRoot: string;

  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "org-route-fixture-"));
  });

  afterEach(() => {
    try {
      rmSync(leadsRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  function app(): Hono {
    const a = new Hono();
    registerOrgFileRead(a, { leadsRoot });
    registerOrgFileWrite(a, { leadsRoot });
    return a;
  }

  const url = (p: string) => `/api/external/org/file?path=${encodeURIComponent(p)}`;

  it("GET requires ?path", async () => {
    const res = await app().request("/api/external/org/file");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("path_required");
  });

  it("GET/PUT round-trip on an allowlisted target", async () => {
    const target = path.join(leadsRoot, "conventions.md");
    writeFileSync(target, "# original\n", "utf8");
    const a = app();

    const getRes = await a.request(url("conventions.md"));
    expect(getRes.status).toBe(200);
    const etag = getRes.headers.get("etag")!;
    expect(etag).toBeTruthy();
    expect(await getRes.text()).toBe("# original\n");

    const putRes = await a.request(url("conventions.md"), {
      method: "PUT",
      headers: { "If-Match": etag },
      body: "# updated\n",
    });
    expect(putRes.status).toBe(200);
    expect(readFileSync(target, "utf8")).toBe("# updated\n");

    const reGetRes = await a.request(url("conventions.md"));
    expect(await reGetRes.text()).toBe("# updated\n");
  });

  it("GET/PUT round-trip on a charter.md", async () => {
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    const target = path.join(leadsRoot, "acme-lead", "charter.md");
    writeFileSync(target, "# charter\n", "utf8");
    const a = app();

    const getRes = await a.request(url("acme-lead/charter.md"));
    expect(getRes.status).toBe(200);
    const etag = getRes.headers.get("etag")!;
    const putRes = await a.request(url("acme-lead/charter.md"), {
      method: "PUT",
      headers: { "If-Match": etag },
      body: "# charter v2\n",
    });
    expect(putRes.status).toBe(200);
    expect(readFileSync(target, "utf8")).toBe("# charter v2\n");
  });

  it("GET on a not-yet-bootstrapped allowlisted target 404s not_found, never path_traversal (open-before-realpath ordering)", async () => {
    const res = await app().request(url("conventions.md"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  it("GET rejects org-chart.json — it has its own typed endpoint", async () => {
    writeFileSync(path.join(leadsRoot, "org-chart.json"), "{}", "utf8");
    const res = await app().request(url("org-chart.json"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("not_allowlisted");
  });

  it("PUT rejects org-chart.json even with a valid If-Match", async () => {
    const p = path.join(leadsRoot, "org-chart.json");
    writeFileSync(p, "{}", "utf8");
    const etag = `"${fileFingerprint(readFileSync(p))}"`;
    const res = await app().request(url("org-chart.json"), {
      method: "PUT",
      headers: { "If-Match": etag },
      body: "{}",
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("not_allowlisted");
    expect(readFileSync(p, "utf8")).toBe("{}");
  });

  it("PUT rejects a non-allowlisted filename", async () => {
    const p = path.join(leadsRoot, "random-notes.md");
    writeFileSync(p, "x", "utf8");
    const etag = `"${fileFingerprint(readFileSync(p))}"`;
    const res = await app().request(url("random-notes.md"), {
      method: "PUT",
      headers: { "If-Match": etag },
      body: "y",
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("not_allowlisted");
  });

  it("PUT rejects traversal (..) with 400, never touching the allowlist", async () => {
    const res = await app().request(url("../decision_log.md"), {
      method: "PUT",
      headers: { "If-Match": '"x"' },
      body: "y",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("path_traversal");
  });

  it("PUT on a missing (not-yet-bootstrapped) allowlisted target 404s — no create", async () => {
    const etag = `"${fileFingerprint(Buffer.from(""))}"`;
    const res = await app().request(url("decision_log.md"), {
      method: "PUT",
      headers: { "If-Match": etag },
      body: "new content",
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  it("PUT without If-Match is a hard 400 (never a blind write)", async () => {
    const p = path.join(leadsRoot, "principal.md");
    writeFileSync(p, "x", "utf8");
    const res = await app().request(url("principal.md"), {
      method: "PUT",
      body: "y",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("precondition_required");
    expect(readFileSync(p, "utf8")).toBe("x");
  });

  it("PUT with a stale If-Match is 409, target untouched", async () => {
    const p = path.join(leadsRoot, "AGENTS.md");
    writeFileSync(p, "original", "utf8");
    const res = await app().request(url("AGENTS.md"), {
      method: "PUT",
      headers: { "If-Match": '"sha256:stale"' },
      body: "hijack",
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("fingerprint_mismatch");
    expect(readFileSync(p, "utf8")).toBe("original");
  });

  it("PUT over ORG_WRITE_MAX_BYTES is 413", async () => {
    const p = path.join(leadsRoot, "decisions-proposed.md");
    writeFileSync(p, "x", "utf8");
    const etag = `"${fileFingerprint(readFileSync(p))}"`;
    const oversized = "a".repeat(ORG_WRITE_MAX_BYTES + 1);
    const res = await app().request(url("decisions-proposed.md"), {
      method: "PUT",
      headers: { "If-Match": etag },
      body: oversized,
    });
    expect(res.status).toBe(413);
  });

  it("PUT rejects a final-component symlink (mocked lstat) 403, no write-through", async () => {
    const p = path.join(leadsRoot, "conventions.md");
    const original = "# original\n";
    writeFileSync(p, original, "utf8");
    const etag = `"${fileFingerprint(readFileSync(p))}"`;

    const a = new Hono();
    registerOrgFileWrite(a, {
      leadsRoot,
      lstatSync: (pp) =>
        path.basename(pp) === "conventions.md"
          ? { isSymbolicLink: () => true, isFile: () => true }
          : lstatSync(pp),
    });

    const res = await a.request(url("conventions.md"), {
      method: "PUT",
      headers: { "If-Match": etag },
      body: "# hacked\n",
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("symlink_forbidden");
    expect(readFileSync(p, "utf8")).toBe(original);
  });

  it(
    "code-review fix: GET rejects a final-component symlink 403, never serving " +
      "its content — GET previously only stat()-ed (follows symlinks) and never " +
      "lstat-checked, unlike PUT above",
    async () => {
      const p = path.join(leadsRoot, "conventions.md");
      writeFileSync(p, "# secret elsewhere\n", "utf8");

      const a = new Hono();
      registerOrgFileRead(a, {
        leadsRoot,
        // CodeQL js/file-system-race fix: the real defense is opening with
        // O_NOFOLLOW (a single atomic syscall — no separate check-then-read
        // window to race). Simulate the kernel's ELOOP for a mocked
        // final-component symlink here rather than creating a REAL symlink,
        // which needs elevated privileges on Windows CI.
        openSync: ((p2: string, flags?: number | string, mode?: number) =>
          path.basename(p2) === "conventions.md"
            ? (() => {
                throw Object.assign(new Error("ELOOP"), { code: "ELOOP" });
              })()
            : openSync(p2, flags ?? "r", mode)) as typeof openSync,
      });

      const res = await a.request(url("conventions.md"));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("symlink_forbidden");
    },
  );
});
