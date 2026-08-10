/* Integration coverage for the real Python triage transition surface. */

import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { appendLine, makeHarness, TRIAGE_HEADER, type Harness } from "./_triage-api-harness.js";
import { _clearCache_TEST_ONLY } from "../core/triage-store.js";
import { resolveTriageCliScript, runTriageCli, type TriageCliResult } from "../core/triage-cli-runner.js";
import { defaultRun, resolvePython } from "../core/readiness-probe.js";

const execFileAsync = promisify(execFile);
const hasCachedCli = resolveTriageCliScript() !== null;
const cachedCliIt = hasCachedCli ? it : it.skip;

function seed(h: Harness, id = "trg-aaaa1111"): void {
  writeFileSync(h.triagePath, `${TRIAGE_HEADER}\n${appendLine(id)}\n`);
  _clearCache_TEST_ONLY();
}

describe("triage routes — Python CLI writer", () => {
  let h: Harness;

  beforeEach(async () => { h = await makeHarness(); });
  afterEach(() => h.cleanup());

  it("routes dismiss through the CLI and returns its resolved item", async () => {
    h.cleanup();
    h = await makeHarness({
      runTriageCli: async (input) => ({
        kind: "ok", operation: input.operation,
        item: { id: input.itemId, status: "dismissed", statusReason: "out of scope" },
      }),
    });
    seed(h);
    const response = await h.app.request("/api/triage/proj-a/dismiss", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triageId: "trg-aaaa1111", reason: "out of scope" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.item).toMatchObject({ id: "trg-aaaa1111", status: "dismissed", statusReason: "out of scope" });
  });

  it("routes snooze and amend through the CLI, preserving the resulting delta", async () => {
    h.cleanup();
    h = await makeHarness({
      runTriageCli: async (input) => ({
        kind: "ok",
        operation: input.operation,
        item: input.operation === "amend"
          ? { id: input.itemId, title: "Corrected", amendedBy: "cli" }
          : { id: input.itemId, status: "snoozed", revisitAt: "2099-01-01" },
      }),
    });
    seed(h, "trg-bbbb2222");
    const amended = await h.app.request("/api/triage/proj-a/amend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triageId: "trg-bbbb2222", title: "Corrected" }),
    });
    expect(amended.status).toBe(200);
    expect((await amended.json()).item).toMatchObject({ title: "Corrected", amendedBy: "cli" });

    const snoozed = await h.app.request("/api/triage/proj-a/snooze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triageId: "trg-bbbb2222", revisitAt: "2099-01-01" }),
    });
    expect(snoozed.status).toBe(200);
    expect((await snoozed.json()).item).toMatchObject({ status: "snoozed", revisitAt: "2099-01-01" });
  });

  it("keeps optional user text in a single CLI option argument", async () => {
    const calls: string[][] = [];
    h.cleanup();
    h = await makeHarness({
      runTriageCli: async (input) => {
        calls.push(input.args);
        return { kind: "ok", operation: input.operation, item: { id: input.itemId, title: "--not-an-option" } };
      },
    });
    seed(h, "trg-eeee5555");
    const amended = await h.app.request("/api/triage/proj-a/amend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triageId: "trg-eeee5555", title: "--not-an-option" }),
    });
    expect(amended.status).toBe(200);
    expect((await amended.json()).item).toMatchObject({ title: "--not-an-option" });
    expect(calls).toEqual([["--title=--not-an-option"]]);
  });

  it("does not wait for an availability probe before serving a native board read", async () => {
    let finishProbe: ((value: { available: boolean }) => void) | undefined;
    h.cleanup();
    h = await makeHarness({
      triageWriteAvailability: () => new Promise((resolve) => { finishProbe = resolve; }),
    });
    seed(h, "trg-ffff6666");

    const response = await h.app.request("/api/triage/proj-a");
    expect(response.status).toBe(200);
    expect((await response.json()).origin.write).toMatchObject({
      available: false,
      checking: true,
      reason: "Checking whether the triage write engine is available.",
    });
    finishProbe?.({ available: true });
  });

  it("caches a completed availability probe and converts probe errors into a visible disabled state", async () => {
    let probes = 0;
    h.cleanup();
    h = await makeHarness({ triageWriteAvailability: async () => ({ available: ++probes === 1 }) });
    seed(h, "trg-aabbccdd");
    await h.app.request("/api/triage/proj-a");
    await Promise.resolve();
    const cached = await h.app.request("/api/triage/proj-a");
    expect((await cached.json()).origin.write).toEqual({ available: true });
    expect(probes).toBe(1);

    h.cleanup();
    h = await makeHarness({ triageWriteAvailability: async () => { throw new Error("probe failed"); } });
    seed(h, "trg-aabbccdd");
    await h.app.request("/api/triage/proj-a");
    await Promise.resolve();
    const failed = await h.app.request("/api/triage/proj-a");
    expect((await failed.json()).origin.write).toMatchObject({ available: false, reason: "The triage write engine could not be checked." });
  });

  it("maps stable CLI failure categories and reconciles a recovered promote through show", async () => {
    const responses: TriageCliResult[] = [
      { kind: "failed", reason: "lost response" },
      { kind: "precondition" },
      { kind: "ok", operation: "show", item: { status: "promoted" } },
    ];
    h.cleanup();
    h = await makeHarness({
      runTriageCli: async (input) => {
        const result = responses.shift()!;
        return result.kind === "ok" && input.operation === "show"
          ? { ...result, item: { ...result.item, promotedTaskId: `EXT:${h.store.list()[0]?.taskId}` } }
          : result;
      },
    });
    seed(h, "trg-ddccbbaa");
    const body = { triageId: "trg-ddccbbaa", priority: "P1", domain: "engineering", tags: [] };
    expect((await h.app.request("/api/triage/proj-a/promote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).status).toBe(207);
    expect((await h.app.request("/api/triage/proj-a/promote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).status).toBe(201);

    for (const [kind, expected] of [["engine-unavailable", 503], ["precondition", 409], ["not-found", 404], ["lock-timeout", 503], ["failed", 502]] as const) {
      h.cleanup();
      const result: TriageCliResult = kind === "engine-unavailable"
        ? { kind, reason: "missing", repairCommand: "repair" }
        : kind === "failed" ? { kind, reason: "broken" } : { kind };
      h = await makeHarness({ runTriageCli: async () => result });
      seed(h, "trg-a1b2c3d4");
      const response = await h.app.request("/api/triage/proj-a/amend", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ triageId: "trg-a1b2c3d4", title: "Changed" }) });
      expect(response.status).toBe(expected);
    }
  });

  cachedCliIt("interleaves a Python producer and UI transition: exactly one CLI CAS succeeds", async () => {
    seed(h, "trg-cccc3333");
    const python = await resolvePython(defaultRun);
    const script = resolveTriageCliScript();
    expect(python).not.toBeNull();
    expect(script).not.toBeNull();
    const projectRoot = path.dirname(path.dirname(h.triagePath));
    const ui = h.app.request("/api/triage/proj-a/dismiss", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triageId: "trg-cccc3333" }),
    });
    const producer = execFileAsync(python!.bin, [
      script!, "--project-root", projectRoot, "snooze", "trg-cccc3333", "--json",
    ]).then(() => ({ code: 0, stderr: "" })).catch((error: { code?: number; stderr?: string }) => ({
      code: error.code,
      stderr: error.stderr ?? "",
    }));
    const [uiResponse, producerCode] = await Promise.all([ui, producer]);
    expect([uiResponse.status, producerCode.code].sort()).toEqual([0, 409]);
    if (uiResponse.status === 409) {
      expect((await uiResponse.json()).error).toBe("triage_item_not_in_triage_state");
      expect(producerCode.code).toBe(0);
    } else {
      expect(uiResponse.status).toBe(200);
      expect(producerCode.code).toBe(3);
      expect(producerCode.stderr).toMatch(/status precondition failed/);
    }
    _clearCache_TEST_ONLY();
    const listed = await h.app.request("/api/triage/proj-a");
    const readerItem = (await listed.json()).items.find((value: { id: string }) => value.id === "trg-cccc3333");
    const shown = await execFileAsync(python!.bin, [
      script!, "--project-root", projectRoot, "show", "trg-cccc3333", "--json",
    ]);
    const cliItem = JSON.parse(shown.stdout).item;
    // The native resolver may add display-only enrichments; every field emitted
    // by the Python CLI must nevertheless agree with its independently-read
    // resolved item, not only the winner's status.
    expect(readerItem).toMatchObject(cliItem);
    expect(["dismissed", "snoozed"]).toContain(cliItem.status);
  });

  it("preserves a new task when the promote CLI result is ambiguous", async () => {
    const cliFailure = async (): Promise<TriageCliResult> => ({
      kind: "failed",
      reason: "The triage write engine didn't return valid JSON.",
    });
    h.cleanup();
    h = await makeHarness({ runTriageCli: cliFailure });
    seed(h, "trg-dddd4444");

    const response = await h.app.request("/api/triage/proj-a/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        triageId: "trg-dddd4444",
        priority: "P1",
        domain: "engineering",
        tags: [],
      }),
    });

    expect(response.status).toBe(207);
    const body = await response.json();
    expect(body).toMatchObject({
      error: "promote_partial",
      code: "triage_cli_result_unknown",
      triageId: "trg-dddd4444",
    });
    expect(h.store.list()).toHaveLength(1);
    expect(h.store.get(body.taskId)).toMatchObject({ promotedFromTriageId: "trg-dddd4444" });
  });

  cachedCliIt("reconciles a committed promotion when its first CLI response was lost", async () => {
    let discardFirstPromoteResponse = true;
    const commitThenLoseResponse: typeof runTriageCli = async (input) => {
      const result = await runTriageCli(input);
      if (input.operation === "promote" && discardFirstPromoteResponse) {
        discardFirstPromoteResponse = false;
        expect(result.kind).toBe("ok");
        return { kind: "failed", reason: "The triage write engine didn't return valid JSON." };
      }
      return result;
    };
    h.cleanup();
    h = await makeHarness({ runTriageCli: commitThenLoseResponse });
    seed(h, "trg-9999aaaa");
    const body = {
      triageId: "trg-9999aaaa",
      priority: "P1",
      domain: "engineering",
      tags: [],
    };

    const first = await h.app.request("/api/triage/proj-a/promote", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    expect(first.status).toBe(207);

    const retry = await h.app.request("/api/triage/proj-a/promote", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    expect(retry.status).toBe(201);
    expect(await retry.json()).toMatchObject({
      triageId: "trg-9999aaaa",
      recovered: true,
      newStatus: "promoted",
      item: { status: "promoted" },
    });
  });
});
