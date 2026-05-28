/*
 * Boundary probe — iterate-2026-05-27-transcript-renderer-scroll.
 *
 * Round-trips a JSONL stream whose event shapes mirror EXACTLY what was
 * observed on disk in the user's example session (sessionId 86832cb1):
 *   last-prompt, custom-title, agent-name, mode (×2), permission-mode,
 *   pr-link, assistant, a Stop-hook user-string, and a plain user msg.
 *
 * `touches_io_boundary` round-trip requirement: parsing the third-party
 * producer's on-disk format must (a) leave NO event as `kind:"unknown"`
 * for the newly-handled types, and (b) reclassify the Stop-hook content
 * without swallowing the plain user message.
 */

import { describe, it, expect } from "vitest";
import { parseSessionJsonl } from "../session-parser";

const STOP_HOOK_BODY = [
  "Stop hook feedback:",
  "================================================================",
  "  SHIPWRIGHT BLOAT GATE — Stop blocked",
  "================================================================",
  "",
  "The IRON LAW",
  "",
  "    NO COMPLETION WHILE FILES ARE GROWING UNCHECKED",
].join("\n");

const SESSION = "86832cb1-db18-4cb8-8755-db8dc94b6fbf";

// Verbatim top-level shapes from the on-disk format.
const LINES: Record<string, unknown>[] = [
  { type: "last-prompt", leafUuid: "x", sessionId: SESSION },
  { type: "custom-title", customTitle: "Iterate: Phase Pill for Iterates", sessionId: SESSION },
  { type: "agent-name", agentName: "Iterate: Phase Pill for Iterates", sessionId: SESSION },
  { type: "mode", mode: "normal", sessionId: SESSION },
  { type: "permission-mode", permissionMode: "auto", sessionId: SESSION },
  { type: "mode", mode: "normal", sessionId: SESSION },
  {
    type: "pr-link",
    sessionId: SESSION,
    prNumber: 78,
    prUrl: "https://github.com/svenroth-ai/shipwright-webui/pull/78",
    prRepository: "svenroth-ai/shipwright-webui",
    timestamp: "2026-05-27T19:59:59.578Z",
  },
  {
    type: "assistant",
    sessionId: SESSION,
    message: { content: [{ type: "text", text: "Working on it." }] },
  },
  { type: "user", sessionId: SESSION, message: { content: STOP_HOOK_BODY } },
  { type: "user", sessionId: SESSION, message: { content: "Thanks, looks good!" } },
];

describe("boundary probe — on-disk JSONL round-trip", () => {
  const jsonl = LINES.map((l) => JSON.stringify(l)).join("\n") + "\n";
  const { events, malformedLines } = parseSessionJsonl(jsonl);

  it("parses every line with no malformed lines", () => {
    expect(malformedLines).toBe(0);
    expect(events).toHaveLength(LINES.length);
  });

  it("leaves NO event as kind='unknown'", () => {
    const unknowns = events.filter((e) => e.kind === "unknown");
    expect(unknowns).toEqual([]);
  });

  it("reclassifies both mode heartbeats to mode-change", () => {
    expect(events.filter((e) => e.kind === "mode-change")).toHaveLength(2);
  });

  it("reclassifies the pr-link", () => {
    const prLinks = events.filter((e) => e.kind === "pr-link");
    expect(prLinks).toHaveLength(1);
  });

  it("reclassifies the Stop-hook user-string WITHOUT swallowing the plain user message", () => {
    expect(events.filter((e) => e.kind === "stop-hook")).toHaveLength(1);
    const users = events.filter((e) => e.kind === "user");
    expect(users).toHaveLength(1);
    if (users[0].kind === "user") {
      expect(users[0].content).toBe("Thanks, looks good!");
    }
  });
});
