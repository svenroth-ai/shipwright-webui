/*
 * ws-upgrade-handler.codex-flip.test.ts — the ADR-309 Codex-runtime
 * awaiting_external_start → active early-flip and its Codextender-mode
 * exclusion (Codextender integration Part B.6 companion fix).
 *
 * Split out of ws-upgrade-handler.test.ts per the Stop-hook bloat gate
 * (2026-09-23) — see that file's own header for the rest of the sibling
 * split history.
 *
 * Coverage:
 *   (f) Codex-runtime state flip (iterate-2026-09-20-codex-liveness-transition)
 *   (g) Codextender exclusion from the Codex-runtime flip — a Codextender
 *       task DOES write a real Claude `.jsonl`, so it must NOT get the
 *       early flip; the ordinary transcript-poll `!firstJsonlObservedAt`
 *       path is authoritative for it instead, exactly like a plain Claude
 *       task.
 */

import { describe, expect, it } from "vitest";

import { buildWsHandlers, type ValidatedWsUpgradeContext } from "./ws-upgrade-handler.js";
import { makeCtx, makeStore, makeTask, makeWs } from "./ws-upgrade-handler.fixtures.js";

// ---------------------------------------------------------------------------
// (f) Codex-runtime awaiting_external_start → active flip
//     (iterate-2026-09-20-codex-liveness-transition)
// ---------------------------------------------------------------------------

describe("buildWsHandlers — Codex-runtime state flip", () => {
  it("flips awaiting_external_start → active for a Codex task under a non-new-plain actionId (new-iterate)", () => {
    const store = makeStore();
    const ctx = makeCtx({
      store: store as unknown as ValidatedWsUpgradeContext["store"],
      task: makeTask({
        state: "awaiting_external_start",
        actionId: "new-iterate",
        runtime: "codex",
      }),
    });
    const handlers = buildWsHandlers(ctx);
    handlers.onOpen?.({} as Event, makeWs() as never);
    expect(store.patch).toHaveBeenCalledWith("task-1", { state: "active" });
    expect(store.persist).toHaveBeenCalled();
  });

  it("flips awaiting_external_start → active for a Codex task under resume/fork actionIds too", () => {
    for (const actionId of ["resume", "fork", "triage-promote"]) {
      const store = makeStore();
      const ctx = makeCtx({
        store: store as unknown as ValidatedWsUpgradeContext["store"],
        task: makeTask({ state: "awaiting_external_start", actionId, runtime: "codex" }),
      });
      const handlers = buildWsHandlers(ctx);
      handlers.onOpen?.({} as Event, makeWs() as never);
      expect(store.patch).toHaveBeenCalledWith("task-1", { state: "active" });
    }
  });

  it("does NOT flip a Claude-runtime task under a non-new-plain actionId (regression guard)", () => {
    const store = makeStore();
    const ctx = makeCtx({
      store: store as unknown as ValidatedWsUpgradeContext["store"],
      task: makeTask({
        state: "awaiting_external_start",
        actionId: "new-iterate",
        runtime: "claude",
      }),
    });
    const handlers = buildWsHandlers(ctx);
    handlers.onOpen?.({} as Event, makeWs() as never);
    expect(store.patch).not.toHaveBeenCalled();
  });

  it("does NOT set firstJsonlObservedAt when flipping a Codex task", () => {
    const store = makeStore();
    const ctx = makeCtx({
      store: store as unknown as ValidatedWsUpgradeContext["store"],
      task: makeTask({
        state: "awaiting_external_start",
        actionId: "new-iterate",
        runtime: "codex",
      }),
    });
    const handlers = buildWsHandlers(ctx);
    handlers.onOpen?.({} as Event, makeWs() as never);
    const patchCall = store.patch.mock.calls.find((c) => c[0] === "task-1");
    expect(patchCall?.[1]).toEqual({ state: "active" });
    expect(patchCall?.[1]).not.toHaveProperty("firstJsonlObservedAt");
  });

  it("does NOT flip a Codex task when state is already active", () => {
    const store = makeStore();
    const ctx = makeCtx({
      store: store as unknown as ValidatedWsUpgradeContext["store"],
      task: makeTask({ state: "active", actionId: "new-iterate", runtime: "codex" }),
    });
    const handlers = buildWsHandlers(ctx);
    handlers.onOpen?.({} as Event, makeWs() as never);
    expect(store.patch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (g) Codextender exclusion from the Codex-runtime flip (Codextender
//     integration Part B.6 companion fix) — a Codextender task DOES write a
//     real Claude `.jsonl`, so it must NOT get the ADR-309 early flip; the
//     ordinary transcript-poll `!firstJsonlObservedAt` path is authoritative
//     for it instead, exactly like a plain Claude task.
// ---------------------------------------------------------------------------

describe("buildWsHandlers — Codextender exclusion from the Codex-runtime flip", () => {
  it("does NOT flip a Codextender-mode task under a non-new-plain actionId", () => {
    const store = makeStore();
    const ctx = makeCtx({
      store: store as unknown as ValidatedWsUpgradeContext["store"],
      task: makeTask({
        state: "awaiting_external_start",
        actionId: "new-iterate",
        runtime: "codex",
        codexIntegrationMode: "codextender",
      }),
    });
    const handlers = buildWsHandlers(ctx);
    handlers.onOpen?.({} as Event, makeWs() as never);
    expect(store.patch).not.toHaveBeenCalled();
  });

  it("still flips a Codex-Light-mode task (codexIntegrationMode: 'light') under a non-new-plain actionId", () => {
    const store = makeStore();
    const ctx = makeCtx({
      store: store as unknown as ValidatedWsUpgradeContext["store"],
      task: makeTask({
        state: "awaiting_external_start",
        actionId: "new-iterate",
        runtime: "codex",
        codexIntegrationMode: "light",
      }),
    });
    const handlers = buildWsHandlers(ctx);
    handlers.onOpen?.({} as Event, makeWs() as never);
    expect(store.patch).toHaveBeenCalledWith("task-1", { state: "active" });
  });

  it("still flips a codex task whose codexIntegrationMode is unset (pre-existing behavior)", () => {
    const store = makeStore();
    const ctx = makeCtx({
      store: store as unknown as ValidatedWsUpgradeContext["store"],
      task: makeTask({ state: "awaiting_external_start", actionId: "new-iterate", runtime: "codex" }),
    });
    const handlers = buildWsHandlers(ctx);
    handlers.onOpen?.({} as Event, makeWs() as never);
    expect(store.patch).toHaveBeenCalledWith("task-1", { state: "active" });
  });

  it("a Codextender-mode task under actionId=new-plain still flips (new-plain's own rule is unaffected)", () => {
    const store = makeStore();
    const ctx = makeCtx({
      store: store as unknown as ValidatedWsUpgradeContext["store"],
      task: makeTask({
        state: "awaiting_external_start",
        actionId: "new-plain",
        runtime: "codex",
        codexIntegrationMode: "codextender",
      }),
    });
    const handlers = buildWsHandlers(ctx);
    handlers.onOpen?.({} as Event, makeWs() as never);
    expect(store.patch).toHaveBeenCalledWith("task-1", { state: "active" });
  });
});
