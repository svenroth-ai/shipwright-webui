/*
 * Real shape (CLI 2.1.273, subagents/agent-ac1e1588bea49d4b9.jsonl): the coordinator's mid-run message is a
 * `queued_command` attachment with NO header in `prompt`, tagged only by origin.kind. V3 doubt O2.
 */
import { describe, expect, it } from "vitest";
import { parseSessionJsonl } from "./session-parser";
import { deriveActivityFeed } from "../lib/missionActivityFeed";

const line = (extra: object, sidechain = true) => JSON.stringify({ type: "attachment", isSidechain: sidechain, timestamp: "2026-10-31T10:00:00Z", attachment: { type: "queued_command", prompt: "STOP the round-relaunch loop.\nReport now.", isMeta: true, ...extra } });

describe("coordinator queued_command attachment", () => {
  // @covers FR-01.66
  it("becomes a coordinator hand-back card", () => {
    const { events } = parseSessionJsonl(line({ origin: { kind: "coordinator" } }));
    expect(events[0]).toMatchObject({ kind: "handback", origin: "coordinator", text: "STOP the round-relaunch loop.\nReport now." });
    expect(deriveActivityFeed(events, null).cards.filter((c) => c.kind === "handback")).toHaveLength(1);
  });

  // @covers FR-01.66
  it("is not a coordinator hand-back in the main session", () => {
    expect(parseSessionJsonl(line({ origin: { kind: "coordinator" } }, false)).events[0].kind).toBe("attachment");
  });

  // @covers FR-01.66
  it("an attachment without the coordinator origin stays an attachment", () => {
    expect(parseSessionJsonl(line({})).events[0].kind).toBe("attachment");
    expect(parseSessionJsonl(line({ origin: { kind: "human" } })).events[0].kind).toBe("attachment");
  });
});
