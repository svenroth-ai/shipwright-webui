/*
 * triage.outbox-union.test.ts — F0.5 surface=api end-to-end gate for
 * iterate-2026-06-08-triage-outbox-union-reader.
 *
 * Drives the REAL production Hono triage route (`createTriageRoutes`) with a
 * real `SdkSessionsStore` and the production `.weblock` lock against a temp
 * project that carries a per-tree, gitignored `triage.outbox.jsonl` buffer
 * (what an idle-main background producer writes via the D1 reroute).
 *
 * The regression this gate pins: before the union reader, the live Inbox
 * (which reads `GET /api/triage/:projectId`) missed every background finding
 * in the outbox until a sweep+merge round-trip. These tests assert the finding
 * surfaces through the real HTTP consumer, is counted, and can be dismissed
 * (the status flip residence-routes to the outbox — no tracked main drift).
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import * as lockfile from "proper-lockfile";

import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../core/sdk-sessions-store.js";
import { createTriageRoutes } from "./triage.js";
import { createTriageLock } from "../core/triage-lock.js";
import { _clearCache_TEST_ONLY } from "../core/triage-store.js";
import { outboxPathFor } from "../core/triage-paths.js";

function realStoreDeps(): SdkSessionsStoreDeps {
  return {
    readFile: (p, e) => fsReadFile(p, e as BufferEncoding),
    writeFile: (p, d) => fsWriteFile(p, d),
    existsSync: (p) => existsSync(p),
    mkdirSync: (p, o) => mkdirSync(p, o),
    lock: (p) => lockfile.lock(p, { retries: 0 }),
    ensureFile: (p) => {
      if (!existsSync(p)) writeFileSync(p, "");
    },
  };
}

function appendLine(id: string, source = "drift"): string {
  return JSON.stringify({
    event: "append",
    id,
    ts: "2026-06-01T08:00:00Z",
    originalTs: "2026-06-01T08:00:00Z",
    source,
    severity: "high",
    kind: "bug",
    title: `Background finding ${id}`,
    detail: `Detail for ${id}`,
    evidencePath: null,
    runId: null,
    commit: null,
    dedupKey: `${source}:${id}`,
    status: "triage",
    suggestedPriority: "P1",
    suggestedDomain: "engineering",
  });
}

interface Harness {
  triagePath: string;
  outboxPath: string;
  app: ReturnType<typeof createTriageRoutes>;
  cleanup: () => void;
}

async function makeHarness(): Promise<Harness> {
  _clearCache_TEST_ONLY();
  const workDir = mkdtempSync(path.join(tmpdir(), "triage-outbox-api-"));
  const projectPath = path.join(workDir, "project-a");
  mkdirSync(path.join(projectPath, ".shipwright"), { recursive: true });
  const triagePath = path.join(projectPath, ".shipwright", "triage.jsonl");

  const registryDir = path.join(workDir, "registry");
  mkdirSync(registryDir, { recursive: true });
  const store = new SdkSessionsStore(path.join(registryDir, "sdk-sessions.json"), realStoreDeps());
  await store.load();

  const projects = [{ id: "proj-a", path: projectPath }];
  const app = createTriageRoutes({
    getAllProjects: () => projects,
    getProjectById: (id) => projects.find((p) => p.id === id),
    store,
    lock: createTriageLock(0),
    now: () => "2026-06-08T20:00:00Z",
  });

  return {
    triagePath,
    outboxPath: outboxPathFor(triagePath),
    app,
    cleanup: () => rmSync(workDir, { recursive: true, force: true }),
  };
}

const POST = { method: "POST", headers: { "content-type": "application/json" } };

describe("triage routes — outbox union (F0.5 surface=api)", () => {
  const harnesses: Harness[] = [];
  afterEach(() => {
    for (const h of harnesses.splice(0)) h.cleanup();
  });

  it("GET /:projectId surfaces an outbox-only background finding alongside tracked items", async () => {
    const h = await makeHarness();
    harnesses.push(h);
    writeFileSync(
      h.triagePath,
      `{"v":1,"schema":"triage","created":"2026-06-01T00:00:00Z"}\n${appendLine("trg-tracked1", "compliance")}\n`,
    );
    // Background idle-main producer wrote ONLY to the gitignored outbox.
    writeFileSync(h.outboxPath, appendLine("trg-outbox1") + "\n");

    const res = await h.app.request("/api/triage/proj-a");
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = (body.items as Array<{ id: string }>).map((i) => i.id).sort();
    expect(ids).toEqual(["trg-outbox1", "trg-tracked1"]);
  });

  it("GET /:projectId surfaces outbox findings even when NO tracked triage.jsonl exists", async () => {
    const h = await makeHarness();
    harnesses.push(h);
    // No tracked file at all — only the outbox buffer.
    writeFileSync(h.outboxPath, appendLine("trg-outboxonly") + "\n");
    expect(existsSync(h.triagePath)).toBe(false);

    const res = await h.app.request("/api/triage/proj-a");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect((body.items as Array<{ id: string }>).map((i) => i.id)).toEqual(["trg-outboxonly"]);
  });

  it("GET /counts includes outbox findings in the per-project triage count", async () => {
    const h = await makeHarness();
    harnesses.push(h);
    writeFileSync(
      h.triagePath,
      `{"v":1,"schema":"triage","created":"2026-06-01T00:00:00Z"}\n${appendLine("trg-tracked2")}\n`,
    );
    writeFileSync(h.outboxPath, appendLine("trg-outbox2") + "\n");

    const res = await h.app.request("/api/triage/counts");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts["proj-a"]).toBe(2);
    expect(body.total).toBe(2);
  });

  it("POST /:projectId/dismiss on an outbox finding → 200; the flip residence-routes to the outbox (no tracked drift) and the item reads back dismissed", async () => {
    const h = await makeHarness();
    harnesses.push(h);
    // Tracked store exists (header only) so the route's existence-guard + lock
    // target are satisfied; the finding itself lives only in the outbox.
    writeFileSync(h.triagePath, `{"v":1,"schema":"triage","created":"2026-06-01T00:00:00Z"}\n`);
    // Route body validator requires /^trg-[0-9a-fA-F]{8}$/ for the flip id.
    writeFileSync(h.outboxPath, appendLine("trg-0a0b0c0d") + "\n");

    const dismiss = await h.app.request("/api/triage/proj-a/dismiss", {
      ...POST,
      body: JSON.stringify({ triageId: "trg-0a0b0c0d", reason: "handled" }),
    });
    expect(dismiss.status).toBe(200);

    // Residence: the status flip landed in the OUTBOX, NOT the tracked store
    // (the tracked file still has only its header line → no main drift).
    const trackedLines = readFileSync(h.triagePath, "utf-8").split("\n").filter(Boolean);
    expect(trackedLines).toHaveLength(1);
    const outboxRaw = readFileSync(h.outboxPath, "utf-8");
    expect(outboxRaw).toContain('"event":"status"');
    expect(outboxRaw).toContain('"newStatus":"dismissed"');

    // End-to-end: the item now reads back dismissed through the real route.
    const res = await h.app.request("/api/triage/proj-a");
    const body = await res.json();
    const item = (body.items as Array<{ id: string; status: string }>).find(
      (i) => i.id === "trg-0a0b0c0d",
    );
    expect(item?.status).toBe("dismissed");
  });

  it("AC6 — the repo .gitignore carries the canonical outbox-ignore line (D3 propagation)", () => {
    // The per-tree outbox is a transient buffer that must never be committed.
    // setup_iterate_worktree's self-heal lands the canonical line; pin it so a
    // future gitignore rewrite can't silently start tracking the buffer.
    const repoRoot = path.resolve(__dirname, "../../../");
    const gitignore = readFileSync(path.join(repoRoot, ".gitignore"), "utf-8");
    expect(gitignore).toContain("/.shipwright/triage.outbox.jsonl");
  });
});
