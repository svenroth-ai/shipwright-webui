/*
 * _triage-api-harness.ts — shared F0.5 surface=api harness for the triage
 * route gates. NOT a test file (no `.test.` segment, so vitest does not
 * collect it); the leading underscore marks it as test-support.
 *
 * Extracted from `triage.outbox-union.test.ts` when the record-boundary
 * recovery gate (iterate-2026-07-18-triage-jsonl-record-boundary) needed the
 * same setup: one harness, two gate files, both under the 300-line convention
 * and neither duplicating ~50 lines of wiring.
 *
 * Drives the REAL production Hono triage route (`createTriageRoutes`) with a
 * real `SdkSessionsStore` and the production `.weblock` lock against a temp
 * project — so these gates exercise the actual HTTP consumer chain, not a
 * re-implementation of it.
 */

import {
  appendFileSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
  existsSync,
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
import { _clearEnrichCache_TEST_ONLY } from "../core/triage-enrich.js";
import { outboxPathFor } from "../core/triage-paths.js";

function realStoreDeps(): SdkSessionsStoreDeps {
  return {
    readFile: (p, e) => fsReadFile(p, e as BufferEncoding),
    writeFile: (p, d) => fsWriteFile(p, d),
    existsSync: (p) => existsSync(p),
    mkdirSync: (p, o) => mkdirSync(p, o),
    lock: (p) => lockfile.lock(p, { retries: 0 }),
    // Append-with-empty CREATES the file when absent and is a no-op when it
    // exists, without truncating. The obvious `if (!existsSync) writeFileSync`
    // is a check-then-act TOCTOU (CodeQL js/file-system-race) — this has the
    // same outcome in one atomic open, so there is no window to lose.
    ensureFile: (p) => appendFileSync(p, ""),
  };
}

/** A triage `append` event line, matching the producer wire shape. */
export function appendLine(id: string, source = "drift"): string {
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

/** The canonical schema header line for a tracked triage store. */
export const TRIAGE_HEADER = '{"v":1,"schema":"triage","created":"2026-06-01T00:00:00Z"}';

export interface Harness {
  triagePath: string;
  outboxPath: string;
  app: ReturnType<typeof createTriageRoutes>;
  cleanup: () => void;
}

export async function makeHarness(): Promise<Harness> {
  _clearCache_TEST_ONLY();
  _clearEnrichCache_TEST_ONLY();
  const workDir = mkdtempSync(path.join(tmpdir(), "triage-outbox-api-"));
  const projectPath = path.join(workDir, "project-a");
  mkdirSync(path.join(projectPath, ".shipwright"), { recursive: true });
  const triagePath = path.join(projectPath, ".shipwright", "triage.jsonl");

  const registryDir = path.join(workDir, "registry");
  mkdirSync(registryDir, { recursive: true });
  const store = new SdkSessionsStore(
    path.join(registryDir, "sdk-sessions.json"),
    realStoreDeps(),
  );
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
