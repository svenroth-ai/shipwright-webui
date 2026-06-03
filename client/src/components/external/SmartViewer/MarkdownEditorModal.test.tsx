/*
 * MarkdownEditorModal.test.tsx — editor modal behavior (FR-01.34).
 * Mocks ONLY the load/save transport; uses the real TipTap editor + diff +
 * detectLossyConstructs (the spike proved TipTap mounts in jsdom).
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "../../../lib/externalApi";

vi.mock("../../../lib/markdownFileApi", async (importActual) => {
  const actual = await importActual<typeof import("../../../lib/markdownFileApi")>();
  return { ...actual, loadMarkdownForEdit: vi.fn(), saveMarkdown: vi.fn() };
});

import * as api from "../../../lib/markdownFileApi";
import { MarkdownEditorModal } from "./MarkdownEditorModal";

const loadMock = api.loadMarkdownForEdit as unknown as Mock;
const saveMock = api.saveMarkdown as unknown as Mock;

function renderModal(overrides?: Partial<Parameters<typeof MarkdownEditorModal>[0]>) {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  render(
    <MarkdownEditorModal
      open
      onOpenChange={onOpenChange}
      projectId="p1"
      path="README.md"
      onSaved={onSaved}
      {...overrides}
    />,
  );
  return { onOpenChange, onSaved };
}

beforeEach(() => {
  loadMock.mockReset();
  saveMock.mockReset();
});
afterEach(() => cleanup());

describe("MarkdownEditorModal", () => {
  it("loads the file and reaches the editing state (no warn for clean prose)", async () => {
    loadMock.mockResolvedValue({ text: "# Hi\n\nbody\n", fingerprint: "sha256:fp1" });
    renderModal();
    await waitFor(() => expect(screen.getByTestId("md-editor-review")).not.toBeDisabled());
    expect(loadMock).toHaveBeenCalledWith("p1", "README.md");
    expect(screen.queryByTestId("md-editor-warn")).toBeNull();
  });

  it("shows the non-blocking warn banner for frontmatter (review #9)", async () => {
    loadMock.mockResolvedValue({ text: "---\ntitle: x\n---\n\n# Hi\n", fingerprint: "sha256:fp1" });
    renderModal();
    expect(await screen.findByTestId("md-editor-warn")).toBeTruthy();
  });

  it("Review → diff → Save writes with the captured fingerprint, fires onSaved + close", async () => {
    loadMock.mockResolvedValue({ text: "# Hi\n\nbody\n", fingerprint: "sha256:fp1" });
    saveMock.mockResolvedValue({ fingerprint: "sha256:new" });
    const user = userEvent.setup();
    const { onSaved, onOpenChange } = renderModal();

    await waitFor(() => expect(screen.getByTestId("md-editor-review")).not.toBeDisabled());
    await user.click(screen.getByTestId("md-editor-review"));
    expect(await screen.findByTestId("markdown-diff")).toBeTruthy();
    await user.click(screen.getByTestId("md-editor-save"));

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    const [projectId, path, body, fp] = saveMock.mock.calls[0];
    expect(projectId).toBe("p1");
    expect(path).toBe("README.md");
    // The saved body is the SERIALIZED editor document (review #8) — it must
    // reflect the loaded content, not an empty/stale string.
    expect(body).toContain("# Hi");
    expect(body).toContain("body");
    expect(fp).toBe("sha256:fp1");
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("on a 409 conflict shows the conflict banner and KEEPS the editor (review #11)", async () => {
    loadMock.mockResolvedValue({ text: "# Hi\n\nbody\n", fingerprint: "sha256:fp1" });
    saveMock.mockRejectedValue(new api.MarkdownConflictError("sha256:disk"));
    const user = userEvent.setup();
    const { onOpenChange } = renderModal();

    await waitFor(() => expect(screen.getByTestId("md-editor-review")).not.toBeDisabled());
    await user.click(screen.getByTestId("md-editor-review"));
    await user.click(await screen.findByTestId("md-editor-save"));

    expect(await screen.findByTestId("md-editor-conflict")).toBeTruthy();
    expect(screen.getByTestId("md-editor-surface")).toBeTruthy(); // edits preserved
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByTestId("md-editor-reload")).toBeTruthy();
  });

  it("shows a non-crashing load-error state when the file can't be opened (review #4)", async () => {
    loadMock.mockRejectedValue(new ApiError("not_found", 404, { error: "not_found" }));
    renderModal();
    expect(await screen.findByTestId("md-editor-load-error")).toBeTruthy();
  });
});
