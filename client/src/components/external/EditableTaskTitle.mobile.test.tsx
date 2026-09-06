import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExternalTask } from "../../lib/externalApi";

const mutateAsync = vi.fn(async () => undefined);
vi.mock("../../hooks/useExternalTasks", () => ({
  useRenameTask: () => ({ mutateAsync, isPending: false }),
}));

import { EditableTaskTitle } from "./EditableTaskTitle";

const task = {
  taskId: "task-1",
  sessionUuid: "11111111-1111-1111-1111-111111111111",
  title: "A very long <script>task title</script> that must not grow the header",
  cwd: "/tmp/p",
  pluginDirs: [],
  projectId: "p1",
  state: "idle",
  createdAt: "2026-08-02T00:00:00Z",
  inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
} as ExternalTask;

const originalMatchMedia = window.matchMedia;

/**
 * The component reads the COMPACT query (`max-width: 1023px`, tablet+phone —
 * iterate-2026-09-06-tablet-ipad-ux-pass), not the narrower PHONE query
 * directly. `phoneMatches` defaults to mirroring `compact` (a real phone
 * viewport matches both queries at once); passing `false` while `compact` is
 * `true` simulates a tablet-width viewport (phone query false, compact query
 * true) to prove the component does NOT key off the phone query.
 */
function setViewport(compact: boolean, phoneMatches: boolean = compact) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === "(max-width: 1023px)" ? compact : query === "(max-width: 767px)" ? phoneMatches : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.clearAllMocks();
});

describe("EditableTaskTitle — compact (tablet + phone) disclosure", () => {
  it("phone: truncates the trigger and opens the full title as inert text", async () => {
    setViewport(true);
    const user = userEvent.setup();
    render(<EditableTaskTitle task={task} />);
    expect(screen.getByTestId("task-title-display")).toHaveClass("truncate");
    await user.click(screen.getByTestId("task-title-display"));
    const content = await screen.findByTestId("task-title-popover");
    expect(content).toHaveTextContent(task.title);
    expect(content.querySelector("script")).toBeNull();
  });

  // @covers iterate-2026-09-06-tablet-ipad-ux-pass — the same tap-to-expand
  // disclosure now covers iPad-width viewports (768-1023px), not only phone.
  it("tablet (compact but not phone-width): also truncates and opens the tap-to-expand popover", async () => {
    setViewport(true, false);
    const user = userEvent.setup();
    render(<EditableTaskTitle task={task} />);
    expect(screen.getByTestId("task-title-display")).toHaveClass("truncate");
    await user.click(screen.getByTestId("task-title-display"));
    const content = await screen.findByTestId("task-title-popover");
    expect(content).toHaveTextContent(task.title);
  });

  it("Rename closes the overlay and focuses the existing editor", async () => {
    setViewport(true);
    const user = userEvent.setup();
    render(<EditableTaskTitle task={task} />);
    await user.click(screen.getByTestId("task-title-display"));
    await user.click(await screen.findByTestId("task-title-popover-rename"));
    const input = await screen.findByTestId("task-title-input-edit");
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.queryByTestId("task-title-popover")).toBeNull();
  });

  it("desktop click keeps the existing direct edit path", async () => {
    setViewport(false);
    const user = userEvent.setup();
    render(<EditableTaskTitle task={task} />);
    const display = screen.getByTestId("task-title-display");
    await user.click(display);
    expect(screen.getByTestId("task-title-input-edit")).toBeInTheDocument();
  });

  // @covers iterate-2026-09-06-tablet-ipad-ux-pass
  it("desktop also single-line truncates a long title instead of wrapping unbounded", () => {
    setViewport(false);
    render(<EditableTaskTitle task={task} />);
    const display = screen.getByTestId("task-title-display");
    expect(display).toHaveClass("min-w-0");
    expect(display.querySelector("span")).toHaveClass("truncate");
    expect(display).toHaveAttribute("title", task.title);
  });
});
