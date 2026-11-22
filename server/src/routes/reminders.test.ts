import { describe, expect, it } from "vitest";

import type { ReminderDueResult, ReminderWriteResult } from "../core/reminder-cli-runner.js";
import { parseDueAnswer } from "../core/reminder-contract.js";
import { GOOD_ANSWER } from "../core/reminder-fixtures.js";
import { createReminderRoutes, type ReminderProjectMeta } from "./reminders.js";

const PROJECTS: ReminderProjectMeta[] = [
  { id: "p1", path: "C:/one", name: "One" },
  { id: "p2", path: "C:/two", name: "Two" },
  { id: "syn", path: "C:/syn", name: "Unassigned", synthesized: true },
];

function okDue(over: Record<string, unknown> = {}): ReminderDueResult {
  const parsed = parseDueAnswer(JSON.stringify({ ...GOOD_ANSWER, ...over }));
  if (parsed.kind !== "ok") throw new Error("fixture");
  return { kind: "ok", view: parsed.view };
}

function app(opts: {
  due?: (root: string) => Promise<ReminderDueResult>;
  write?: (root: string, input: unknown) => Promise<ReminderWriteResult>;
}) {
  const writes: { root: string; input: unknown }[] = [];
  const a = createReminderRoutes({
    projects: { getAll: () => PROJECTS, getById: (id) => PROJECTS.find((p) => p.id === id) },
    runReminderDue: (root) => (opts.due ?? (async () => okDue()))(root),
    runReminderWrite: async (root, input) => {
      writes.push({ root, input });
      return (opts.write ?? (async () => ({ kind: "ok", operation: "done", output: "done" })))(root, input);
    },
  });
  const post = (p: string, body: unknown, raw = false) =>
    a.request(p, { method: "POST", headers: { "content-type": "application/json" }, body: raw ? (body as string) : JSON.stringify(body) });
  return { a, post, writes };
}

describe("GET due", () => {
  it("per project: contract shape, no local paths, state ok", async () => {
    const { a } = app({});
    const res = await a.request("/api/reminders/p1/due");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ projectId: "p1", state: "ok", contractVersion: 1, on: "2026-11-22", triageError: null, reminderCorruptLines: 0 });
    expect(body.items).toHaveLength(2);
    expect(Object.keys(body.items[0])).toHaveLength(10);
    expect(JSON.stringify(body)).not.toContain("sourceRoot");
    expect(JSON.stringify(body)).not.toContain("reminders.jsonl");
  });

  it("across all registered projects (synthesized skipped), each with its own state", async () => {
    const roots: string[] = [];
    const { a } = app({
      due: async (root) => { roots.push(root); return root === "C:/two" ? { kind: "unreadable", reason: "x" } : okDue(); },
    });
    const body = await (await a.request("/api/reminders/due")).json();
    expect(roots.sort()).toEqual(["C:/one", "C:/two"]);
    expect(body.projects.map((p: { projectId: string; state: string }) => [p.projectId, p.state])).toEqual([["p1", "ok"], ["p2", "unreadable"]]);
  });

  it("a throwing runner becomes a failed state for that project only", async () => {
    const { a } = app({ due: async (root) => { if (root === "C:/one") throw new Error("boom"); return okDue(); } });
    const body = await (await a.request("/api/reminders/due")).json();
    expect(body.projects[0]).toMatchObject({ projectId: "p1", state: "failed" });
    expect(body.projects[1]).toMatchObject({ projectId: "p2", state: "ok" });
  });

  it("triageError and corrupt lines are a degraded state WITH the data, not 'nothing due'", async () => {
    const { a } = app({ due: async () => okDue({ triageError: "the triage log could not be read (OSError)", reminderCorruptLines: 3 }) });
    const res = await a.request("/api/reminders/p1/due");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ state: "degraded", triageError: "the triage log could not be read (OSError)", reminderCorruptLines: 3 });
    expect(body.items).toHaveLength(2);
  });

  it.each<[string, ReminderDueResult, number, Record<string, unknown>]>([
    ["engine unavailable", { kind: "engine-unavailable", reason: "r", repairCommand: "fix" }, 503, { state: "engine-unavailable", repairCommand: "fix" }],
    ["unreadable answer", { kind: "unreadable", reason: "r" }, 502, { state: "unreadable" }],
    ["unknown contractVersion", { kind: "unsupported-version", contractVersion: 7 }, 502, { state: "unsupported-version", contractVersion: "7" }],
    ["store busy", { kind: "store-busy", message: "m" }, 503, { state: "store-busy" }],
    ["failed", { kind: "failed", reason: "r" }, 502, { state: "failed" }],
  ])("%s is an explicit error state", async (_n, result, status, expected) => {
    const { a } = app({ due: async () => result });
    const res = await a.request("/api/reminders/p1/due");
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body).toMatchObject(expected);
    expect(body).not.toHaveProperty("items");
  });

  it("unknown or synthesized project -> 404", async () => {
    const { a } = app({});
    expect((await a.request("/api/reminders/nope/due")).status).toBe(404);
    expect((await a.request("/api/reminders/syn/due")).status).toBe(404);
  });
});

describe("POST done / snooze / add", () => {
  it("done calls the CLI bridge for the project's path", async () => {
    const { post, writes } = app({});
    const res = await post("/api/reminders/p2/done", { id: "rem-aabbccdd" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, id: "rem-aabbccdd", operation: "done" });
    expect(writes).toEqual([{ root: "C:/two", input: { operation: "done", id: "rem-aabbccdd" } }]);
  });

  it("snooze validates the day and forwards --until", async () => {
    const { post, writes } = app({});
    expect((await post("/api/reminders/p1/snooze", { id: "rem-aabbccdd", until: "2026-02-31" })).status).toBe(400);
    expect((await post("/api/reminders/p1/snooze", { id: "rem-aabbccdd" })).status).toBe(400);
    expect(writes).toHaveLength(0);
    const ok = await post("/api/reminders/p1/snooze", { id: "rem-aabbccdd", until: "2026-12-01" });
    expect(ok.status).toBe(200);
    expect(writes[0].input).toEqual({ operation: "snooze", id: "rem-aabbccdd", until: "2026-12-01" });
  });

  it("add requires title, due and why; passes optional fields and url links", async () => {
    const { post, writes } = app({ write: async () => ({ kind: "ok", operation: "add", reminder: { id: "rem-11112222" } }) });
    for (const bad of [{}, { title: "t", due: "2026-12-01" }, { title: "t", why: "w" }, { title: " ", due: "2026-12-01", why: "w" }, { title: "t", due: "soon", why: "w" }]) {
      expect((await post("/api/reminders/p1/add", bad)).status).toBe(400);
    }
    expect(writes).toHaveLength(0);
    const res = await post("/api/reminders/p1/add", {
      title: "t", due: "2026-12-01", why: "w", decided: "d", open: "o", command: "c",
      links: [{ label: "Docs", kind: "url", ref: "https://example.com" }],
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, reminder: { id: "rem-11112222" } });
    expect(writes[0].input).toEqual({
      operation: "add", title: "t", due: "2026-12-01", why: "w", decided: "d", open: "o", command: "c",
      links: [{ label: "Docs", ref: "https://example.com" }],
    });
  });

  it.each([
    ["a non-url link kind", { links: [{ label: "x", kind: "file", ref: "a" }] }],
    ["a link label with '='", { links: [{ label: "a=b", kind: "url", ref: "https://x" }] }],
    ["a link without an address", { links: [{ label: "x", kind: "url" }] }],
    ["an oversized title", { title: "x".repeat(201) }],
  ])("add rejects %s", async (_n, extra) => {
    const { post } = app({});
    const res = await post("/api/reminders/p1/add", { title: "t", due: "2026-12-01", why: "w", ...extra });
    expect(res.status).toBe(400);
  });

  it("the CLI's secret refusal is passed through unchanged (422), without a second call", async () => {
    const msg = "The text in `why` looks like it contains a secret ... reword it.";
    const { post, writes } = app({ write: async () => ({ kind: "refused", message: msg }) });
    const res = await post("/api/reminders/p1/add", { title: "t", due: "2026-12-01", why: "sk-secret" });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "refused", message: msg });
    expect(writes).toHaveLength(1);
  });

  it.each<[ReminderWriteResult, number, string]>([
    [{ kind: "not-found", message: "m" }, 404, "not_found"],
    [{ kind: "engine-unavailable", reason: "r", repairCommand: "c" }, 503, "engine_unavailable"],
    [{ kind: "store-busy", message: "m" }, 503, "store_busy"],
    [{ kind: "unreadable", reason: "r" }, 502, "unreadable"],
    [{ kind: "failed", reason: "r" }, 502, "failed"],
  ])("write result %j maps to %i", async (result, status, error) => {
    const { post } = app({ write: async () => result });
    const res = await post("/api/reminders/p1/done", { id: "rem-aabbccdd" });
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe(error);
  });

  it("refuses a non-JSON content-type (cross-site simple POST) with 415 before any CLI call", async () => {
    const { a, writes } = app({});
    const res = await a.request("/api/reminders/p1/done", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ id: "rem-aabbccdd" }) });
    expect(res.status).toBe(415);
    expect((await a.request("/api/reminders/p1/done", { method: "POST", body: "{}" })).status).toBe(415);
    expect(writes).toHaveLength(0);
  });

  it("add rejects javascript:/data: link addresses, NUL characters and an oversized total", async () => {
    const { post, writes } = app({});
    const base = { title: "t", due: "2026-12-01", why: "w" };
    for (const ref of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "not a url"]) {
      expect((await post("/api/reminders/p1/add", { ...base, links: [{ label: "x", kind: "url", ref }] })).status).toBe(400);
    }
    expect((await post("/api/reminders/p1/add", { ...base, why: "a" + String.fromCharCode(0) + "b" })).status).toBe(400);
    expect((await post("/api/reminders/p1/add", { ...base, why: "w".repeat(2000), decided: "d".repeat(2000), open: "o".repeat(2000), command: "c".repeat(2000), links: Array.from({ length: 12 }, (_, i) => ({ label: `l${i}`, kind: "url", ref: "https://x.example/" + "a".repeat(1900) })) })).status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it("a runner that throws becomes a named failure (502), not a bare 500", async () => {
    const { a, post } = app({ due: async () => { throw new Error("boom"); }, write: async () => { throw new Error("boom"); } });
    expect((await a.request("/api/reminders/p1/due")).status).toBe(502);
    const res = await post("/api/reminders/p1/done", { id: "rem-aabbccdd" });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("failed");
  });

  it("rejects bad ids, bad JSON and unknown projects", async () => {
    const { post, writes } = app({});
    expect((await post("/api/reminders/p1/done", { id: "--help" })).status).toBe(400);
    expect((await post("/api/reminders/p1/done", { id: "a b" })).status).toBe(400);
    expect((await post("/api/reminders/p1/done", "{nope", true)).status).toBe(400);
    expect((await post("/api/reminders/nope/done", { id: "rem-aabbccdd" })).status).toBe(404);
    expect(writes).toHaveLength(0);
  });
});
