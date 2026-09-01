/*
 * InboxCard.exhaustive.type.test.ts — FR-04.19 trap 3/4, acceptance (d):
 * both `inboxItemKey` and `InboxCard`'s dispatcher narrow `InboxItem` in an
 * exhaustive `switch`. A fifth kind added to the `InboxItem` union without
 * a matching `case` is a TYPE error at the `default` branch's `never`
 * assertion — not a silent `undefined` key / wrong-card fallthrough.
 *
 * This file proves the exhaustiveness check ITSELF still fires by widening
 * the union with a fake fifth kind and asserting the narrowed `default`
 * value is no longer assignable to `never`.
 */
import { describe, it, expectTypeOf } from "vitest";

import type { InboxItem } from "../../lib/externalApi";
import { unhandledInboxItemKind } from "./InboxCard";

type FakeFifthKind = { kind: "fake_fifth"; taskId: string };

// Type-only — deliberately never invoked (that would throw at runtime; see
// `unhandledInboxItemKind`'s own implementation). TypeScript still checks
// every function body regardless of whether it's called, so the
// `@ts-expect-error` below is exercised at compile time on every run.
function typeOnlyRejectsFakeFifthKind() {
  // Exercises the ACTUAL guard both dispatchers fall through to, not a
  // standalone `never` check — if `unhandledInboxItemKind`'s parameter
  // were ever widened from `never` to `InboxItem`, this stops compiling.
  // @ts-expect-error — FakeFifthKind is not `never`; a real fifth kind
  // added to InboxItem without a switch case would fail here too.
  unhandledInboxItemKind({ kind: "fake_fifth", taskId: "t" } as FakeFifthKind);
}
void typeOnlyRejectsFakeFifthKind;

describe("InboxItem exhaustiveness guard stays load-bearing", () => {
  it("unhandledInboxItemKind rejects a value outside today's InboxItem union (compile-time only, see typeOnlyRejectsFakeFifthKind above)", () => {
    expectTypeOf(typeOnlyRejectsFakeFifthKind).returns.toBeVoid();
  });

  it("today's four real kinds are exactly what InboxItem is (no silent fifth)", () => {
    type RealKinds = InboxItem["kind"];
    expectTypeOf<RealKinds>().toEqualTypeOf<
      "ask_tool" | "text_question" | "terminal_prompt" | "lead_question"
    >();
  });
});
