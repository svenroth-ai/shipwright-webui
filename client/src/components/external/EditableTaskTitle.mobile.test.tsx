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
  title: "A very long <script>task title</script> that must not grow the phone header",
  cwd: "/tmp/p",
  pluginDirs: [],
  projectId: "p1",
  state: "idle",
  createdAt: "2026-08-02T00:00:00Z",
  inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
} as ExternalTask;

const originalMatchMedia = window.matchMedia;

function setPhone(phone: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === "(max-width: 767px)" ? phone : false,
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
describe("EditableTaskTitle — phone disclosure", () => {
  it("truncates the trigger and opens the full title as inert text", async () => {
    setPhone(true);
    const user = userEvent.setup();
    render(<EditableTaskTitle task={task} />);
    expect(screen.getByTestId("task-title-display")).toHaveClass("truncate");
    await user.click(screen.getByTestId("task-title-display"));
    const content = await screen.findByTestId("task-title-popover");
    expect(content).toHaveTextContent(task.title);
    expect(content.querySelector("script")).toBeNull();
  });

  it("Rename closes the overlay and focuses the existing editor", async () => {
    setPhone(true);
    const user = userEvent.setup();
    render(<EditableTaskTitle task={task} />);
    await user.click(screen.getByTestId("task-title-display"));
    await user.click(await screen.findByTestId("task-title-popover-rename"));
    const input = await screen.findByTestId("task-title-input-edit");
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.queryByTestId("task-title-popover")).toBeNull();
  });

  it("desktop click keeps the existing direct edit path", async () => {
    setPhone(false);
    const user = userEvent.setup();
    render(<EditableTaskTitle task={task} />);
    const display = screen.getByTestId("task-title-display");
    expect(display).not.toHaveClass("truncate");
    expect(display.querySelector("span")).not.toHaveClass("truncate");
    await user.click(display);
    expect(screen.getByTestId("task-title-input-edit")).toBeInTheDocument();
  });
});
