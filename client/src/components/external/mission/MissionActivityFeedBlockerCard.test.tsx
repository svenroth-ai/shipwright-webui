/*
 * `FeedCard`'s BLOCKER disclosure - the plain-language headline, the
 * collapsed-by-default raw detail, and the commands folded into the same
 * toggle. Split out of `MissionActivityFeedCard.test.tsx` at the 300-line
 * convention (46th review round). */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FeedCard } from "./MissionActivityFeedCard";
import type { ActivityCard } from "../../../lib/missionActivityFeed";
import type { ExternalTask } from "../../../lib/externalApi";

vi.mock("../../../hooks/useLaunchTask", () => ({
  useLaunchTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const TASK = { taskId: "task-mission-feed", projectId: "p1" } as unknown as ExternalTask;

function renderCard(card: ActivityCard) {
  return render(<FeedCard card={card} commitArtifact={null} task={TASK} />);
}

describe("FeedCard — blocker detail is collapsed by default with a plain explanation up top (reported: raw traceback + bash command with no explanation)", () => {
  it("shows the derived one-line explanation as card.text, and hides the raw detail behind Show details", async () => {
    const user = userEvent.setup();
    renderCard({
      kind: "blocker",
      text: "A command failed: TypeError: amend_triage_item() got an unexpected keyword argument 'to_outbox'",
      textLiteral: true,
      commands: ["Bash: python -c '...'"],
      status: "err",
      detail: "Traceback (most recent call last):\n  File \"<stdin>\", line 21\nTypeError: amend_triage_item() got an unexpected keyword argument 'to_outbox'",
    });
    expect(screen.getByText(/TypeError: amend_triage_item/)).toBeInTheDocument();
    // The disclosure's own single toggle folds in the command count (25th/
    // 26th-round external review catch, openai, medium) rather than a
    // second, independent "N commands" control.
    const toggle = screen.getByRole("button", { name: "Show details (1 command)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Traceback \(most recent call last\)/)).not.toBeInTheDocument();
    expect(screen.queryByText("Bash: python -c '...'")).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByText(/Traceback \(most recent call last\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide details" })).toBeInTheDocument();
    // The failing command must be visible immediately, not behind a SECOND
    // nested toggle (6th-round external review catch, both reviewers,
    // medium: a naive `FeedCommands` mount inside "Show details" was still
    // collapsed by its own default state).
    expect(screen.getByText("Bash: python -c '...'")).toBeInTheDocument();
  });

  // 46th-round catch (glm, low), FIXED: `blockerDetailFullyExpanded` survived
  // the disclosure closing, so RE-opening it dumped the whole traceback rather
  // than the bounded excerpt. Falsify by dropping the reset in the outer
  // toggle's onClick in `MissionActivityFeedCard.tsx`.
  it("re-opening Show details starts at the bounded excerpt again, not the full traceback", async () => {
    const user = userEvent.setup();
    renderCard({
      kind: "blocker", text: "A command failed: boom", textLiteral: true,
      commands: ["Bash: pytest"], status: "err",
      detail: "short excerpt", detailFull: "short excerpt plus the WHOLE traceback",
    });
    await user.click(screen.getByRole("button", { name: "Show details (1 command)" }));
    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText("short excerpt plus the WHOLE traceback")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide details" }));
    await user.click(screen.getByRole("button", { name: "Show details (1 command)" }));
    expect(screen.getByText("short excerpt")).toBeInTheDocument();
    expect(screen.queryByText("short excerpt plus the WHOLE traceback")).not.toBeInTheDocument();
  });

  // 15th-round catch (glm, low): a blocker with NO `detail` (resolve.ts's
  // ambiguity guard skipped attaching it because `add()` coalesced more than
  // one command) must still use the "Show details" disclosure for its
  // command(s), not the bottom, doubly-collapsed generic FeedCommands.
  it("still uses the Show details disclosure for a blocker with no detail at all", async () => {
    const user = userEvent.setup();
    renderCard({
      kind: "blocker",
      text: "A command needs attention before work can continue.",
      textLiteral: true,
      commands: ["Bash: a", "Bash: b"],
      status: "err",
    });
    const toggle = screen.getByRole("button", { name: "Show details (2 commands)" });
    expect(screen.queryByText("Bash: a")).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByText("Bash: a")).toBeInTheDocument();
    expect(screen.getByText("Bash: b")).toBeInTheDocument();
    // No SEPARATE, bottom-level "N commands" toggle duplicating this.
    expect(screen.queryByRole("button", { name: "2 commands" })).not.toBeInTheDocument();
  });

  // 17th-round external code review catch (glm, low): a blocker's headline
  // is a synthesized sentence embedding a raw, verbatim error line — routing
  // it through markdown risked `_foo_`/`<Type>` in real error text being
  // reinterpreted as emphasis/stripped, garbling the plain-language
  // explanation this field exists to show.
  it("renders a blocker's headline literally, not as markdown, even when the derived error text contains markdown-significant characters", () => {
    renderCard({
      kind: "blocker",
      text: "A command failed: TypeError: cannot read property '_foo_' of <undefined>",
      textLiteral: true,
      commands: ["Bash: node script.js"],
      status: "err",
    });
    expect(screen.getByText("A command failed: TypeError: cannot read property '_foo_' of <undefined>")).toBeInTheDocument();
    expect(screen.queryByText("foo", { selector: "em" })).not.toBeInTheDocument();
  });

  // 18th-round catch (glm, medium): gating on `kind === "blocker"` alone was
  // an implicit invariant — a blocker WITHOUT `textLiteral` (a hypothetical
  // path that never goes through the synthesized-text mutation) must still
  // render through the real markdown pipeline, not literally.
  it("renders a blocker's text as real markdown when textLiteral is not set", () => {
    renderCard({ kind: "blocker", text: "Some **bold** narration.", commands: ["Bash: a"], status: "err" });
    expect(screen.getByText("bold", { selector: "strong" })).toBeInTheDocument();
  });

  // 34th-round catch (glm, medium), DECLINED - pins the ACCEPTED trade-off
  // (see the note on the explanation branch in `MissionActivityFeedCard.tsx`):
  // routing `explanation` through MarkdownChunk is what requirement 3 asks
  // for, and CommonMark's soft-break rule is its cost. Nothing is LOST.
  // 45th-round catch (glm, low, test), FIXED: the old name claimed the VISUAL
  // re-flow, which is CSS and invisible to jsdom. The checkable part is the DOM
  // markdown produces - ONE paragraph, NO `<br>`.
  it("renders a multi-line explanation as ONE markdown paragraph with no <br> (accepted CommonMark trade-off)", () => {
    const { container, unmount } = renderCard({ kind: "implement", text: "t", explanation: "first line\nsecond line", commands: [], status: "ok" });
    const para = screen.getByText(/first line/);
    expect(para.tagName).toBe("P");
    expect(para.textContent).toBe("first line\nsecond line");
    expect(container.querySelectorAll(".mc-feed-explanation p")).toHaveLength(1);
    expect(container.querySelectorAll(".mc-feed-explanation br")).toHaveLength(0);
    // A HARD break (blank line) still separates genuinely — the structure
    // markdown DOES own is unaffected by the soft-break rule above. The soft-
    // break render is UNMOUNTED first (59th-round catch, glm, low, test — it
    // asked for exactly this over the 56th round's container-scoped query, so
    // no later `screen` use in this file can inherit a stacked DOM).
    unmount();
    const hard = renderCard({ kind: "implement", text: "t", explanation: "para one\n\npara two", commands: [], status: "ok" });
    const paragraphs = hard.container.querySelectorAll(".mc-feed-explanation p");
    expect([...paragraphs].map((node) => node.textContent)).toEqual(["para one", "para two"]);
  });

  // 34th-round catch (glm, low): the blocker branch DECLINED a zero-command
  // guard, arguing every creation site attaches a command first. That claim
  // was asserted, not checked — this pins the degradation. The disclosure
  // must be OPENED before asserting: `FeedCommands` mounts only inside the
  // expanded branch, so a closed-state-only assertion passes trivially
  // whether or not the guard exists (proven by falsifying its own
  // `commands.length === 0` early return).
  it("renders no command list and no count in the label when a blocker carries zero commands", async () => {
    const user = userEvent.setup();
    renderCard({ kind: "blocker", text: "boom", textLiteral: true, commands: [], commandCount: 0, detail: "trace", status: "err" });
    const toggle = screen.getByRole("button", { name: "Show details" });
    expect(screen.queryByText(/0 commands/)).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByText("trace")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /commands/i })).not.toBeInTheDocument();
  });

  // 73rd-round catch (glm, low), FIXED with a MECHANICAL guard where rounds
  // 47/57/72 had argued an invariant: the label read `commandCount` while
  // `FeedCommands` gates on `commands.length`, so a card carrying a count with
  // an EMPTY array promised "2 commands" and expanded to no chips. Unreachable
  // from the reducer, so this drives `FeedCard` directly with the violating
  // shape. Falsify by dropping the `commands.length > 0` clamp in
  // `MissionActivityFeedCard.tsx`.
  it("never promises commands it cannot show, even for a card whose commandCount contradicts its empty command list", async () => {
    const user = userEvent.setup();
    renderCard({ kind: "blocker", text: "boom", textLiteral: true, commands: [], commandCount: 2, detail: "trace", status: "err" });
    const toggle = screen.getByRole("button", { name: "Show details" });
    expect(screen.queryByText(/2 commands/)).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByText("trace")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /commands/i })).not.toBeInTheDocument();
  });

  // 82nd-round catch (glm, low), FIXED with a MECHANICAL guard where the
  // invariant had only been argued in `missionActivityFeedResolve.ts` comments:
  // the `textLiteral` branch ignored `textFull`, so a card carrying BOTH lost
  // the never-crop affordance silently. Unreachable from the reducer (it
  // deletes `textFull` at both mutation sites), so this drives `FeedCard`
  // directly with the violating shape. Falsify by reverting the literal branch
  // to a bare `<p>{card.text}</p>` in `MissionActivityFeedCard.tsx`.
  it("still offers the never-crop expand on a literal-text card that carries a textFull", async () => {
    const user = userEvent.setup();
    renderCard({
      kind: "blocker", text: "A command failed: short", textLiteral: true, textFull: "A command failed: the WHOLE line",
      commands: [], status: "err",
    });
    expect(screen.getByText("A command failed: short")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show more" }));
    const full = screen.getByText("A command failed: the WHOLE line");
    expect(full).toBeInTheDocument();
    // Still a literal text node, never markdown and never raw HTML.
    expect(full.tagName).toBe("P");
    expect(full.querySelector("em")).toBeNull();
  });

  // 35th-round catch (glm, low): round 34 pinned only the LABEL degradation,
  // so with neither detail nor commands the disclosure still rendered — a
  // clickable toggle revealing nothing. The branch is now guarded, and this
  // pins that a blocker with nothing to disclose renders no control at all.
  it("renders no details disclosure at all when a blocker has neither detail nor commands", () => {
    const { container } = renderCard({ kind: "blocker", text: "boom", textLiteral: true, commands: [], status: "err" });
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(container.querySelector(".mc-feed-code")).toBeNull();
    expect(screen.queryByRole("button", { name: /show details/i })).not.toBeInTheDocument();
  });
});
