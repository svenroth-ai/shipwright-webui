/*
 * externalApi.inboxItem.type.test.ts — FR-04.19 trap 1/acceptance (b):
 * the `InboxItemCommon`/`InboxItemBase` split must not loosen
 * `bestEffort: true` on the three JSONL/terminal-derived kinds, and
 * `lead_question` must carry no `bestEffort` field at all. Proved at the
 * type level (compile-time), not by runtime inspection.
 */
import { describe, it, expectTypeOf } from "vitest";

import type {
  AskToolInboxItem,
  TextQuestionInboxItem,
  TerminalPromptInboxItem,
} from "./externalApi";
import type { LeadQuestionInboxItem } from "./leadQuestionApi";

describe("InboxItem — bestEffort stays mandatory on the three derived kinds", () => {
  it("ask_tool / text_question / terminal_prompt still require bestEffort: true", () => {
    expectTypeOf<AskToolInboxItem>().toHaveProperty("bestEffort");
    expectTypeOf<AskToolInboxItem["bestEffort"]>().toEqualTypeOf<true>();

    expectTypeOf<TextQuestionInboxItem>().toHaveProperty("bestEffort");
    expectTypeOf<TextQuestionInboxItem["bestEffort"]>().toEqualTypeOf<true>();

    expectTypeOf<TerminalPromptInboxItem>().toHaveProperty("bestEffort");
    expectTypeOf<TerminalPromptInboxItem["bestEffort"]>().toEqualTypeOf<true>();
  });

  it("lead_question carries no bestEffort field (FR-04.19)", () => {
    expectTypeOf<LeadQuestionInboxItem>().not.toHaveProperty("bestEffort");
  });

  it("an AskToolInboxItem literal without bestEffort:true fails to compile", () => {
    // @ts-expect-error — bestEffort is mandatory, this must not compile.
    const _missing: AskToolInboxItem = {
      kind: "ask_tool",
      taskId: "t",
      sessionUuid: "s",
      taskTitle: "T",
      toolUseId: "tu",
      toolName: "AskUserQuestion",
      input: {},
    };
    void _missing;
  });

  it("a LeadQuestionInboxItem literal with bestEffort fails to compile (base has no such key)", () => {
    const _extra: LeadQuestionInboxItem = {
      kind: "lead_question",
      taskId: "t",
      sessionUuid: "s",
      taskTitle: "T",
      questionText: "q",
      // @ts-expect-error — LeadQuestionInboxItem has no bestEffort key.
      bestEffort: true,
    };
    void _extra;
  });
});
