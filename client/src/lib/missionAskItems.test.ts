/** M5 — AskUserQuestion Q&A derivation: tool_use input joined with the result line's top-level toolUseResult.answers. */
import { describe, expect, it } from "vitest";
import { parseSessionJsonl } from "../external/session-parser";
import { deriveActivityFeed } from "./missionActivityFeed";
import { applyAskAnswers, buildAskItems } from "./missionAskItems";

const line = (value: unknown) => JSON.stringify(value);
const ask = (questions: unknown[]) => line({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "ask", name: "AskUserQuestion", input: { questions } }] } });
const answered = (answers: Record<string, string>) => line({
  type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "ask", content: "User has answered your questions.", is_error: false }] },
  toolUseResult: { questions: [], answers },
});
const rejected = () => line({
  type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "ask", content: "The user doesn't want to proceed.", is_error: true }] },
  toolUseResult: "User rejected tool use",
});
const q1 = { question: "Which platform?", header: "Platform", multiSelect: false, options: [{ label: "Web App", description: "Browser" }, { label: "Mobile App", description: "Native" }] };
const q2 = { question: "Which features?", header: "Features", multiSelect: true, options: [{ label: "Tags" }, { label: "Due dates" }] };
const cardOf = (...lines: string[]) => deriveActivityFeed(parseSessionJsonl(lines.join("\n")).events, null).cards.find((c) => c.kind === "user-input");

describe("buildAskItems / applyAskAnswers", () => {
  // @covers FR-01.66
  it("reads every question with header, multiSelect, option descriptions", () => {
    const items = buildAskItems({ questions: [q1, q2] });
    expect(items.map((i) => [i.question, i.header, i.multiSelect])).toEqual([["Which platform?", "Platform", false], ["Which features?", "Features", true]]);
    expect(items[0].options[1]).toEqual({ label: "Mobile App", description: "Native" });
  });
  // @covers FR-01.66
  it("returns [] for an unreadable payload", () => {
    expect(buildAskItems(null)).toEqual([]);
    expect(buildAskItems({ questions: "x" })).toEqual([]);
  });
  // @covers FR-01.66
  it("answers nothing for a string toolUseResult (rejection) or a missing answers map", () => {
    const items = buildAskItems({ questions: [q1] });
    expect(applyAskAnswers(items, "User rejected tool use")).toBe(false);
    expect(applyAskAnswers(items, { questions: [] })).toBe(false);
    expect(items[0].answer).toBeUndefined();
  });
});

describe("deriveActivityFeed — AskUserQuestion cards", () => {
  // @covers FR-01.66
  it("highlights the chosen option of a single-select answer", () => {
    const q = cardOf(ask([q1]), answered({ "Which platform?": "Web App" }))?.question;
    expect(q?.resolved).toBe(true);
    expect(q?.items).toHaveLength(1);
    expect(q?.items?.[0]).toMatchObject({ chosen: "Web App", answer: "Web App" });
    expect(q?.items?.[0].other).toBeUndefined();
  });
  // @covers FR-01.66
  it("treats an answer matching no label as the free-text Other answer", () => {
    const item = cardOf(ask([q1]), answered({ "Which platform?": "Both, via PWA" }))?.question?.items?.[0];
    expect(item).toMatchObject({ other: true, answer: "Both, via PWA" });
    expect(item?.chosen).toBeUndefined();
  });
  // @covers FR-01.66
  it("keeps the raw multiSelect text and marks options only when every part is a label", () => {
    const all = cardOf(ask([q2]), answered({ "Which features?": "Tags, Due dates" }))?.question?.items?.[0];
    expect(all).toMatchObject({ multiSelect: true, answer: "Tags, Due dates", chosenAll: ["Tags", "Due dates"] });
    expect(all?.chosen).toBeUndefined();
    expect(all?.other).toBeUndefined();
    const mixed = cardOf(ask([q2]), answered({ "Which features?": "Tags, something else" }))?.question?.items?.[0];
    expect(mixed).toMatchObject({ answer: "Tags, something else" });
    expect(mixed?.chosenAll).toBeUndefined();
  });
  // @covers FR-01.66
  it("treats an empty/whitespace answer as unanswered and answers a repeated question text once", () => {
    expect(cardOf(ask([q1]), answered({ "Which platform?": "  " }))).toBeUndefined();
    expect(cardOf(ask([q1]), answered({}))).toBeUndefined();
    // real answers under a key that matches no question: the card is NOT silently dropped (legacy display)
    const mismatched = cardOf(ask([q1]), answered({ "Which platform? ": "Web App" }))?.question;
    expect(mismatched?.resolved).toBe(true);
    expect(mismatched?.items).toBeUndefined();
    const dup = cardOf(ask([q1, q1]), answered({ "Which platform?": "Web App" }))?.question?.items;
    expect(dup).toHaveLength(1);
  });
  // @covers FR-01.66
  it("keeps the whole call on the legacy display when a real answer sits under a key matching no question", () => {
    const q = cardOf(ask([q1, q2]), answered({ "Which platform?": "Web App", "Which features? ": "Tags" }))?.question;
    expect(q?.items).toBeUndefined();
    expect(q?.resolved).toBe(true);
  });
  // @covers FR-01.66
  it("carries the user's own note from annotations", () => {
    const withNote = line({
      type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "ask", content: "ok", is_error: false }] },
      toolUseResult: { questions: [], answers: { "Which platform?": "Web App" }, annotations: { "Which platform?": { preview: "p", notes: "needs offline" } } },
    });
    expect(cardOf(ask([q1]), withNote)?.question?.items?.[0].notes).toBe("needs offline");
  });
  // @covers FR-01.66
  it("never lets a tool_result line become a human bubble: only real typed text yields a user card", () => {
    const feed = deriveActivityFeed(parseSessionJsonl([ask([q1]), answered({ "Which platform?": "Web App" })].join("\n")).events, null);
    expect(feed.cards.some((c) => c.kind === "user")).toBe(false);
  });
  // @covers FR-01.66
  it("keeps only the answered questions of a multi-question call", () => {
    const items = cardOf(ask([q1, q2]), answered({ "Which features?": "Tags" }))?.question?.items;
    expect(items?.map((i) => i.question)).toEqual(["Which features?"]);
  });
  // @covers FR-01.66
  it("keeps an answered question on the legacy display when an answer value has an unrecognised shape", () => {
    const arrayAnswer = line({
      type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "ask", content: "Tags, Due dates", is_error: false }] },
      toolUseResult: { questions: [], answers: { "Which features?": ["Tags", "Due dates"] } },
    });
    const q = cardOf(ask([q2]), arrayAnswer)?.question;
    expect(q?.resolved).toBe(true);
    expect(q?.items).toBeUndefined();
  });
  // @covers FR-01.66
  it("drops a rejected question entirely", () => {
    expect(cardOf(ask([q1]), rejected())).toBeUndefined();
  });
  // @covers FR-01.66
  it("keeps an unanswered (pending) question as the terminal-CTA prompt, with no answer items", () => {
    const q = cardOf(ask([q1]))?.question;
    expect(q?.resolved).toBe(false);
    expect(q?.text).toBe("Which platform?");
  });
  // @covers FR-01.66
  it("falls back to the legacy single-answer display when no answers map is recorded", () => {
    const legacy = line({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "ask", content: "Web App", is_error: false }] } });
    const q = cardOf(ask([q1]), legacy)?.question;
    expect(q?.items).toBeUndefined();
    expect(q?.picked).toBe("Web App");
  });
  // @covers FR-01.66
  it("ignores a toolUseResult sidecar when the line carries several tool results", () => {
    const multi = line({
      type: "user", message: { role: "user", content: [
        { type: "tool_result", tool_use_id: "ask", content: "Web App", is_error: false },
        { type: "tool_result", tool_use_id: "other", content: "x", is_error: false },
      ] },
      toolUseResult: { answers: { "Which platform?": "Web App" } },
    });
    expect(cardOf(ask([q1]), multi)?.question?.items).toBeUndefined();
  });
});
