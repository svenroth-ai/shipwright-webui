/*
 * HTML-inertness of untrusted transcript content in the activity feed - the
 * `card.text` markdown path and the `card.detail` literal `<pre>` path, both
 * collapsed and expanded. Split out of `MissionActivityFeed.test.tsx` at the
 * project's 300-line convention (69th review round). */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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

  it("renders HTML-like raw-output detail as inert literal text, never a real element", () => {
    const { container } = render(<MissionActivityFeed feed={{
      outcome: "In progress",
      cards: [{ kind: "test", text: "Tests ran.", commands: ["Bash: npm test"], status: "err", detail: '<img src=x onerror="window.__pwned=true">FAIL src/x.test.ts' }],
    }} commitArtifact={null} task={TASK} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/FAIL src\/x\.test\.ts/)).toBeInTheDocument();
  });
});
