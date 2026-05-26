/*
 * ToolOutputBlock (BubbleTranscript subfolder, distinct from legacy strip-ansi)
 * — Campaign-C C3 BubbleTranscript split (2026-05-26).
 *
 * Public surface contract:
 *   - Props: `{ toolUse: ToolUseEntry; toolResult?: ToolResultEntry; defaultOpen?: boolean }`.
 *   - Collapsed by default — `data-expanded="false"` on the underlying tool-card.
 *   - Click header toggles → `data-expanded="true"`.
 *   - When `toolResult` is undefined: no `tool-card-output` rendered.
 *   - Dispatch:
 *     - `name === "AskUserQuestion"` → renders an `askuser-pending` /
 *       `askuser-resolved` block, NOT a tool-card.
 *     - `name === "TodoWrite"` → renders a TodoWriteCard.
 *     - `name === "TaskCreate" | "TaskUpdate"` → renders a TaskListAggregateCard.
 *     - any other → renders the generic ToolCard.
 *   - `defaultOpen` controls the initial expanded state on the generic
 *     ToolCard branch.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToolOutputBlock } from "./ToolOutputBlock";

const EMPTY_RESOLVED = new Set<string>();
const EMPTY_TOOLS: { id: string; name: string; input: unknown }[] = [];

describe("ToolOutputBlock — generic branch", () => {
  it("is collapsed by default when defaultOpen is omitted", () => {
    const { container } = render(
      <ToolOutputBlock
        toolUse={{ id: "tu_1", name: "Bash", input: { command: "ls" } }}
        resolved={EMPTY_RESOLVED}
        allToolUses={EMPTY_TOOLS}
      />,
    );
    const card = container.querySelector("[data-testid='tool-card']");
    expect(card).not.toBeNull();
    expect(card!.getAttribute("data-expanded")).toBe("false");
  });

  it("expands when the header is clicked", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ToolOutputBlock
        toolUse={{ id: "tu_1", name: "Bash", input: { command: "ls" } }}
        resolved={EMPTY_RESOLVED}
        allToolUses={EMPTY_TOOLS}
      />,
    );
    const header = container.querySelector("[data-testid='tool-card-header']");
    expect(header).not.toBeNull();
    await user.click(header as HTMLElement);
    const card = container.querySelector("[data-testid='tool-card']");
    expect(card!.getAttribute("data-expanded")).toBe("true");
  });

  it("renders no tool-card-output when toolResult is undefined", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ToolOutputBlock
        toolUse={{ id: "tu_1", name: "Bash", input: { command: "ls" } }}
        resolved={EMPTY_RESOLVED}
        allToolUses={EMPTY_TOOLS}
      />,
    );
    // Expand to make the body visible.
    await user.click(container.querySelector("[data-testid='tool-card-header']") as HTMLElement);
    expect(container.querySelector("[data-testid='tool-card-output']")).toBeNull();
  });

  it("renders tool-card-output when toolResult is provided AND card is expanded", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ToolOutputBlock
        toolUse={{ id: "tu_1", name: "Bash", input: { command: "ls" } }}
        toolResult={{ content: "file-a", is_error: false }}
        resolved={EMPTY_RESOLVED}
        allToolUses={EMPTY_TOOLS}
      />,
    );
    await user.click(container.querySelector("[data-testid='tool-card-header']") as HTMLElement);
    const output = container.querySelector("[data-testid='tool-card-output']");
    expect(output).not.toBeNull();
    expect(output!.textContent).toContain("file-a");
  });
});

describe("ToolOutputBlock — AskUserQuestion branch", () => {
  it("renders as askuser-pending when the id is NOT in `resolved`", () => {
    const { container } = render(
      <ToolOutputBlock
        toolUse={{
          id: "tu_q1",
          name: "AskUserQuestion",
          input: { parts: [{ question: "Pick?", options: ["A", "B"] }] },
        }}
        resolved={EMPTY_RESOLVED}
        allToolUses={EMPTY_TOOLS}
      />,
    );
    const pending = container.querySelector("[data-testid='askuser-pending']");
    expect(pending).not.toBeNull();
    expect(pending!.textContent).toContain("Pick?");
    expect(container.querySelector("[data-testid='askuser-resolved']")).toBeNull();
  });

  it("renders as askuser-resolved when the id IS in `resolved`", () => {
    const { container } = render(
      <ToolOutputBlock
        toolUse={{
          id: "tu_q1",
          name: "AskUserQuestion",
          input: { parts: [{ question: "Pick?", options: ["A"] }] },
        }}
        resolved={new Set(["tu_q1"])}
        allToolUses={EMPTY_TOOLS}
      />,
    );
    const resolved = container.querySelector("[data-testid='askuser-resolved']");
    expect(resolved).not.toBeNull();
    expect(resolved!.textContent).toContain("Answered");
  });
});

describe("ToolOutputBlock — TodoWrite / TaskCreate dispatch", () => {
  it("renders TodoWriteCard when name === 'TodoWrite'", () => {
    const { container } = render(
      <ToolOutputBlock
        toolUse={{
          id: "tu_todo",
          name: "TodoWrite",
          input: {
            todos: [
              { content: "todo 1", status: "pending", activeForm: "writing todo 1" },
            ],
          },
        }}
        resolved={EMPTY_RESOLVED}
        allToolUses={EMPTY_TOOLS}
      />,
    );
    // Wrapper carries bubble-tool-use testid for back-compat.
    const wrap = container.querySelector("[data-testid='bubble-tool-use']");
    expect(wrap).not.toBeNull();
    expect(wrap!.getAttribute("data-tool-use-id")).toBe("tu_todo");
  });

  it("renders TaskListAggregateCard when name === 'TaskCreate'", () => {
    const { container } = render(
      <ToolOutputBlock
        toolUse={{ id: "tu_task", name: "TaskCreate", input: { title: "Foo" } }}
        resolved={EMPTY_RESOLVED}
        allToolUses={[{ id: "tu_task", name: "TaskCreate", input: { title: "Foo" } }]}
      />,
    );
    const wrap = container.querySelector("[data-testid='bubble-tool-use']");
    expect(wrap).not.toBeNull();
    expect(wrap!.getAttribute("data-tool-use-id")).toBe("tu_task");
  });
});
