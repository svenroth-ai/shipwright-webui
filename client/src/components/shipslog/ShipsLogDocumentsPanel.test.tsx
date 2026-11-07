/*
 * ShipsLogDocumentsPanel (iterate-2026-08-31-shipslog-documents-panel) —
 * loading/error/ok states, semantic headings, and that clicking a row opens
 * the shared SmartViewerModal with the right projectId + path.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { ShipsLogDocumentsPanel } from "./ShipsLogDocumentsPanel";
import type { ShipsLogDocsResponse } from "../../lib/shipsLogDocsApi";

const docsMock = vi.fn<() => { data: ShipsLogDocsResponse | undefined; isLoading: boolean; isError: boolean }>();
vi.mock("../../hooks/useShipsLogDocs", () => ({
  useShipsLogDocs: () => docsMock(),
}));

vi.mock("../external/SmartViewer/SmartViewerModal", () => ({
  SmartViewerModal: ({ open, projectId, path }: { open: boolean; projectId: string; path: string }) =>
    open ? <div data-testid="mock-smart-viewer-modal">{`${projectId}:${path}`}</div> : null,
}));

const OK: ShipsLogDocsResponse = {
  status: "ok",
  requirements: [{ path: ".shipwright/planning/01-adopted/spec.md", label: "01 — Adopted", when: "2026-08-29T00:00:00.000Z" }],
  iterateSpecs: [],
  agentDocs: [{ path: ".shipwright/agent_docs/architecture.md", label: "Architecture", when: "2026-08-29T00:00:00.000Z" }],
  compliance: [{ path: ".shipwright/compliance/dashboard.md", label: "Dashboard", when: "2026-08-27T00:00:00.000Z" }],
  pendingDocUpdates: [],
  skippedDocUpdates: 0,
  pendingDocUpdatesUnreadable: false,
};

beforeEach(() => docsMock.mockReset());

describe("ShipsLogDocumentsPanel", () => {
  it("renders semantic headings — h2 panel title, h3 group titles", () => {
    docsMock.mockReturnValue({ data: OK, isLoading: false, isError: false });
    render(<ShipsLogDocumentsPanel projectId="p1" />);
    expect(screen.getByRole("heading", { level: 2, name: "Project documents" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Specs" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Agent docs" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Compliance" })).toBeTruthy();
  });

  it("shows a loading state per group while the fetch is in flight", () => {
    docsMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    render(<ShipsLogDocumentsPanel projectId="p1" />);
    expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);
  });

  it("shows an honest error state, never fabricated rows, on fetch failure", () => {
    docsMock.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<ShipsLogDocumentsPanel projectId="p1" />);
    expect(screen.getByText("Could not load agent docs.")).toBeTruthy();
    expect(screen.getByText("Could not load compliance.")).toBeTruthy();
  });

  it("clicking an Agent Docs row opens SmartViewerModal with the project + path", () => {
    docsMock.mockReturnValue({ data: OK, isLoading: false, isError: false });
    render(<ShipsLogDocumentsPanel projectId="p1" />);
    expect(screen.queryByTestId("mock-smart-viewer-modal")).toBeNull();
    fireEvent.click(screen.getByTestId("shipslog-doc-.shipwright/agent_docs/architecture.md"));
    expect(screen.getByTestId("mock-smart-viewer-modal").textContent).toBe(
      "p1:.shipwright/agent_docs/architecture.md",
    );
  });

  // @covers FR-01.59
  it("hides the pending doc updates group when there are none (legacy layout unchanged)", () => {
    docsMock.mockReturnValue({ data: OK, isLoading: false, isError: false });
    render(<ShipsLogDocumentsPanel projectId="p1" />);
    expect(screen.queryByRole("heading", { level: 3, name: "Pending doc updates" })).toBeNull();
  });

  // @covers FR-01.59
  it("lists pending doc updates, opens one, and counts invalid files", () => {
    const bullet = ".shipwright/agent_docs/decision-drops/bullets/architecture--iterate-x--0a1b2c3d--11111111.md";
    docsMock.mockReturnValue({
      data: { ...OK, pendingDocUpdates: [{ path: bullet, label: "Architecture · a line", when: null }], skippedDocUpdates: 2 },
      isLoading: false,
      isError: false,
    });
    render(<ShipsLogDocumentsPanel projectId="p1" />);
    expect(screen.getByRole("heading", { level: 3, name: "Pending doc updates" })).toBeTruthy();
    expect(screen.getByTestId("shipslog-pending-doc-note").textContent).toContain("next release");
    expect(screen.getByTestId("shipslog-pending-doc-skipped").textContent).toContain("2 further files");
    fireEvent.click(screen.getByTestId(`shipslog-doc-${bullet}`));
    expect(screen.getByTestId("mock-smart-viewer-modal").textContent).toBe(`p1:${bullet}`);
  });

  // @covers FR-01.59
  it("says so when the pending updates could not be read, never as none", () => {
    docsMock.mockReturnValue({ data: { ...OK, pendingDocUpdatesUnreadable: true }, isLoading: false, isError: false });
    render(<ShipsLogDocumentsPanel projectId="p1" />);
    expect(screen.getByTestId("shipslog-pending-doc-note").textContent).toContain("could not be read");
    expect(screen.queryByText("No pending doc updates.")).toBeNull(); // never "unreadable" AND "none"
  });
});
