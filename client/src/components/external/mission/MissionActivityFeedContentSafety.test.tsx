/*
 * HTML-inertness of untrusted transcript content in the activity feed - the
 * `card.text` markdown path and the `card.detail` literal `<pre>` path, both
 * collapsed and expanded. Split out of `MissionActivityFeed.test.tsx` at the
 * project's 300-line convention (69th review round). */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { MissionActivityFeed } from "./MissionActivityFeed";
import type { ExternalTask } from "../../../lib/externalApi";

vi.mock("../../../hooks/useLaunchTask", () => ({
  useLaunchTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const TASK = { taskId: "task-mission-feed", projectId: "p1" } as unknown as ExternalTask;

describe("MissionActivityFeed - untrusted content stays inert", () => {
  // Content-safety (review -08-13, extended -08-20 to `detail`/`question.*`).
  // 50th (openai, low, test), DECLINED as a misread: it reports the payload in
  // `detail` with `card.text` benign - it IS in `card.text` below.
  it("renders HTML-like card text as inert markdown, never a real element", () => {
    const { container } = render(<MissionActivityFeed feed={{
      outcome: "In progress",
      cards: [{ kind: "implement", text: '<img src=x onerror="window.__pwned=true">Edited the login handler.', commands: [] }],
    }} commitArtifact={null} task={TASK} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/Edited the login handler/)).toBeInTheDocument();
  });

  // 77th (glm, low, test), FIXED: the fixture omitted `textLiteral: true`, which
  // EVERY reducer-produced blocker carries, so `text` was checked only on the
  // MarkdownChunk branch. `textLiteral` takes the OTHER branch in
  // `MissionActivityFeedCard.tsx` (`<p>{card.text}</p>`) — as-shipped, that is a
  // React text child and inert, but nothing here pinned it, so a regression
  // routing the literal branch through raw HTML would have left this file green.
  // The headline now carries the payload too, verbatim (it is a raw error line
  // spliced into a synthesized sentence, so that is the realistic shape).
  it("renders HTML-like raw-output detail as inert literal text, never a real element", () => {
    const { container } = render(<MissionActivityFeed feed={{
      outcome: "In progress",
      cards: [{ kind: "blocker", text: 'A command failed: <img src=x onerror="window.__pwned=true">', textLiteral: true, commands: ["Bash: npm test"], status: "err", detail: '<img src=x onerror="window.__pwned=true">FAIL src/x.test.ts' }],
    }} commitArtifact={null} task={TASK} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText('A command failed: <img src=x onerror="window.__pwned=true">')).toBeInTheDocument();
    expect(screen.queryByText(/FAIL src\/x\.test\.ts/)).toBeNull();
    // 69th (glm, low, test), DECLINED as INVERTED and falsified empirically.
    // glm calls the POST-expand `img` check vacuous "because detail renders as
    // a literal text node" - but that is the implementation this line guards,
    // so the argument assumes its conclusion. It is the PRE-expand check that
    // is nearly free (the detail is not mounted at all while collapsed). Probed:
    // swapping the `<pre>` in `MissionActivityFeedCard.tsx` for
    // `dangerouslySetInnerHTML` leaves every other assertion here GREEN and
    // fails exactly the line below, with `expected <img src="x" …> to be null`.
    fireEvent.click(screen.getByRole("button", { name: "Show details (1 command)" }));
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/FAIL src\/x\.test\.ts/)).toBeInTheDocument();
  });
});
