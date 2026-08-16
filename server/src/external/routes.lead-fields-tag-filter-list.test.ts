/*
 * routes.lead-fields-tag-filter-list.test.ts —
 * iterate-2026-08-16-v1-lead-fields-tag-filter (triage-v1-v4a.md Item 1).
 *
 * GET /api/external/tasks?tag= (AC8, AC8b, AC9). Split out of the original
 * combined routes.lead-fields-tag-filter.test.ts (313 lines) to clear the
 * 300-line bloat gate; see _lead-fields-tag-filter-harness.ts for the
 * shared in-memory harness and sibling files -patch.test.ts /
 * -create.test.ts for the other two AC groups.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";

import { SdkSessionsStore } from "../core/sdk-sessions-store.js";
import { SessionWatcher } from "../core/session-watcher.js";
import { STORE_PATH, inMemoryDeps, makeApp } from "./_lead-fields-tag-filter-harness.js";

describe("GET /api/external/tasks?tag= (AC8, AC8b, AC9)", () => {
  let app: Hono;
  let store: SdkSessionsStore;
  let watcher: SessionWatcher;

  beforeEach(async () => {
    store = new SdkSessionsStore(STORE_PATH, inMemoryDeps());
    await store.load();
    watcher = new SessionWatcher({ projectsDir: "/fake/projects" });
    app = makeApp(store, watcher);
  });

  // @covers FR-01.01
  it("AC8: returns only tasks carrying the exact tag (case-sensitive)", async () => {
    store.create({ title: "a", cwd: "/tmp", tags: ["lead-dedup:x"] });
    store.create({ title: "b", cwd: "/tmp", tags: ["lead-dedup:y"] });
    store.create({ title: "c", cwd: "/tmp", tags: ["LEAD-DEDUP:X"] });

    const res = await app.request("/api/external/tasks?tag=lead-dedup:x");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { tasks: Array<{ title: string }> };
    expect(json.tasks).toHaveLength(1);
    expect(json.tasks[0].title).toBe("a");
  });

  // @covers FR-01.01
  it("AC8: unknown tag -> 200 {tasks: []}, not 400", async () => {
    store.create({ title: "a", cwd: "/tmp", tags: ["x"] });
    const res = await app.request("/api/external/tasks?tag=does-not-exist");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { tasks: unknown[] };
    expect(json.tasks).toEqual([]);
  });

  // @covers FR-01.01
  it("AC8: empty ?tag= value behaves as no filter (all tasks)", async () => {
    store.create({ title: "a", cwd: "/tmp", tags: ["x"] });
    store.create({ title: "b", cwd: "/tmp" });
    const res = await app.request("/api/external/tasks?tag=");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { tasks: unknown[] };
    expect(json.tasks).toHaveLength(2);
  });

  // @covers FR-01.01
  it("AC8: ?tag=x&projectId=y intersects both filters", async () => {
    store.create({ title: "match", cwd: "/tmp", tags: ["x"], projectId: "p1" });
    store.create({ title: "wrong-project", cwd: "/tmp", tags: ["x"], projectId: "p2" });
    store.create({ title: "wrong-tag", cwd: "/tmp", tags: ["y"], projectId: "p1" });
    const res = await app.request("/api/external/tasks?tag=x&projectId=p1");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { tasks: Array<{ title: string }> };
    expect(json.tasks).toHaveLength(1);
    expect(json.tasks[0].title).toBe("match");
  });

  // @covers FR-01.01
  it("AC8b: repeated ?tag=a&tag=b — only the first value counts", async () => {
    store.create({ title: "a-task", cwd: "/tmp", tags: ["a"] });
    store.create({ title: "b-task", cwd: "/tmp", tags: ["b"] });
    const res = await app.request("/api/external/tasks?tag=a&tag=b");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { tasks: Array<{ title: string }> };
    expect(json.tasks).toHaveLength(1);
    expect(json.tasks[0].title).toBe("a-task");
  });

  // @covers FR-01.01
  it("AC9: filters BEFORE findManyByUuid — a real SessionWatcher spy sees a Set of size 1", async () => {
    // Coupled to SessionWatcher's public findManyByUuid signature by
    // design (external review, deepseek finding 8) — this is the
    // "injizierbarer Spion" the assignment calls for, on a REAL watcher
    // instance (no mock, no production seam needed).
    const matching = store.create({ title: "match", cwd: "/tmp", tags: ["only-one"] });
    store.create({ title: "other-1", cwd: "/tmp", tags: ["other"] });
    store.create({ title: "other-2", cwd: "/tmp", tags: ["other"] });

    const spy = vi.spyOn(watcher, "findManyByUuid");
    const res = await app.request("/api/external/tasks?tag=only-one");
    expect(res.status).toBe(200);

    expect(spy).toHaveBeenCalledTimes(1);
    const calledWith = spy.mock.calls[0][0] as Set<string>;
    // Not just size 1 — the ONE uuid in the set must be the matching task's,
    // not an unrelated one (external review, openai finding 3: a set of
    // size 1 alone doesn't prove the RIGHT task survived the filter).
    expect(calledWith).toEqual(new Set([matching.sessionUuid.toLowerCase()]));
  });
});
