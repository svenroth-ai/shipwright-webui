/*
 * external/inbox/_lead.test.ts — the `lead_question` inbox kind
 * (FR-04.17/18/19). Marker detection, sentinel-stripping (FR-04.37
 * outbound), and the aggregation post-pass.
 */
import { describe, it, expect } from "vitest";

import {
  extractLeadQuestionBody,
  appendLeadQuestions,
  leadQuestionDismissId,
} from "./_lead.js";
import type { AggregatedEntry } from "./_types.js";
import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../../core/sdk-sessions-store.js";

function inMemoryDeps(): SdkSessionsStoreDeps {
  const files = new Map<string, string>();
  const existing = new Set<string>();
  return {
    readFile: async (p) => {
      if (!files.has(p))
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files.get(p)!;
    },
    writeFile: async (p, data) => {
      files.set(p, data);
      existing.add(p);
    },
    existsSync: (p) => existing.has(p),
    mkdirSync: (p) => {
      existing.add(p);
    },
    ensureFile: (p) => {
      if (!files.has(p)) files.set(p, "");
      existing.add(p);
    },
  };
}

async function makeStore(): Promise<SdkSessionsStore> {
  const store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
  await store.load();
  return store;
}

describe("extractLeadQuestionBody", () => {
  it("returns null for a description with no marker", () => {
    expect(extractLeadQuestionBody("just a normal task description")).toBeNull();
  });

  it("returns null for an undefined description", () => {
    expect(extractLeadQuestionBody(undefined)).toBeNull();
  });

  it("strips the marker line and returns the body", () => {
    const body = extractLeadQuestionBody(
      "<!-- lead-question:info -->\nDone, no answer needed.",
    );
    expect(body).toBe("Done, no answer needed.");
  });

  it("strips the marker regardless of question type", () => {
    const body = extractLeadQuestionBody(
      "<!-- lead-question:entscheidung -->\nPick one of two options.",
    );
    expect(body).toBe("Pick one of two options.");
  });

  it("FR-04.37 outbound: the marker sentinel never survives into the stripped body", () => {
    const description = "<!-- lead-question:abnahme -->\nPlease confirm this.";
    const body = extractLeadQuestionBody(description)!;
    expect(body).not.toContain("<!-- lead-question:");
  });

  it("FR-04.37 outbound: a second marker line further down is also stripped", () => {
    const description =
      "<!-- lead-question:info -->\nFirst question.\n\n<!-- lead-question:abnahme -->\nSecond question.";
    const body = extractLeadQuestionBody(description)!;
    expect(body).not.toContain("<!-- lead-question:");
    expect(body).toContain("First question.");
    expect(body).toContain("Second question.");
  });

  it("strips a CRLF-terminated marker line without leaving a stray \\r", () => {
    const body = extractLeadQuestionBody(
      "<!-- lead-question:info -->\r\nDone, no answer needed.",
    );
    expect(body).toBe("Done, no answer needed.");
  });
});

describe("appendLeadQuestions", () => {
  it("surfaces a waiting task with kind lead_question and no bestEffort field", async () => {
    const store = await makeStore();
    const task = store.create({ title: "Lead follow-up", cwd: "/c", pluginDirs: [] });
    store.patch(task.taskId, {
      description: "<!-- lead-question:info -->\nAre we good to ship?",
    });

    const entries: AggregatedEntry[] = [];
    appendLeadQuestions(entries, { store });

    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.kind).toBe("lead_question");
    expect(entry).not.toHaveProperty("bestEffort");
    if (entry.kind === "lead_question") {
      expect(entry.questionText).toBe("Are we good to ship?");
      expect(entry.taskId).toBe(task.taskId);
    }
  });

  it("skips a task with no lead-question marker", async () => {
    const store = await makeStore();
    const task = store.create({ title: "Ordinary task", cwd: "/c", pluginDirs: [] });
    store.patch(task.taskId, { description: "just some notes" });

    const entries: AggregatedEntry[] = [];
    appendLeadQuestions(entries, { store });
    expect(entries).toHaveLength(0);
  });

  it("skips a task that already has a poFeedback answer", async () => {
    const store = await makeStore();
    const task = store.create({ title: "Answered", cwd: "/c", pluginDirs: [] });
    store.patch(task.taskId, {
      description: "<!-- lead-question:info -->\nAlready answered?",
      poFeedback: "Yes.\n\n<!-- answered-at:2026-09-01T00:00:00.000Z -->",
    });

    const entries: AggregatedEntry[] = [];
    appendLeadQuestions(entries, { store });
    expect(entries).toHaveLength(0);
  });

  it("skips a task dismissed via the lq- prefixed id", async () => {
    const store = await makeStore();
    const task = store.create({ title: "Dismissed", cwd: "/c", pluginDirs: [] });
    store.patch(task.taskId, {
      description: "<!-- lead-question:info -->\nStill relevant?",
      inbox: {
        pendingToolUseIds: [],
        dismissedToolUseIds: [leadQuestionDismissId(task.taskId)],
        lastProcessedByteOffset: 0,
      },
    });

    const entries: AggregatedEntry[] = [];
    appendLeadQuestions(entries, { store });
    expect(entries).toHaveLength(0);
  });

  it("skips done and launch_failed tasks", async () => {
    const store = await makeStore();
    const done = store.create({ title: "Done task", cwd: "/c", pluginDirs: [] });
    store.patch(done.taskId, {
      state: "done",
      description: "<!-- lead-question:info -->\nStale?",
    });

    const entries: AggregatedEntry[] = [];
    appendLeadQuestions(entries, { store });
    expect(entries).toHaveLength(0);
  });
});
