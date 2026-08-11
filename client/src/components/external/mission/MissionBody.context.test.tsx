/*
 * MissionBody.context.test.tsx — the CONTEXT-driven rail (AC1/AC4 client half).
 *
 * The boundary this file guards is the no-regression contract: the resolver's
 * rail engages ONLY for a resolved iterate on a schema this build understands.
 * Pipeline / campaign / plain sessions, an unsupported schema, and a failed
 * resolve all fall back to the LEGACY rail — the Mission tab can never end up
 * worse than it was before this slice.
 *
 * @covers FR-01.66
 */

import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";

import type { ExternalTask } from "../../../lib/externalApi";
import type { MissionContext } from "../../../lib/missionContextApi";
import type { RunDetailResponse } from "../../../lib/runDataApi";

const missionStateMock = vi.fn<() => "done" | "live" | "designgate">();
const runDetailMock = vi.fn<() => { data: RunDetailResponse | undefined }>();
const contextMock = vi.fn<() => { data: MissionContext | undefined }>();

vi.mock("../../../hooks/useMissionState", () => ({
  useMissionState: () => missionStateMock(),
}));
vi.mock("../../../hooks/useRunData", () => ({
  useRunDetail: () => runDetailMock(),
}));
vi.mock("../../../hooks/useCampaigns", () => ({
  useCampaigns: () => ({ data: [] }),
}));
vi.mock("./DesignGateCard", () => ({
  DesignGateCard: () => <div data-testid="design-gate-card-stub" />,
}));
vi.mock("../SmartViewer/DocumentMarkdown", () => ({
  DocumentMarkdown: ({ text }: { text: string }) => <div data-testid="doc-markdown">{text}</div>,
}));
vi.mock("../../../hooks/useMissionContext", () => ({
  useMissionContext: () => contextMock(),
  useArtifactDocument: () => ({
    data: { status: "ok", document: { title: "mini-plan.md", body: "# Plan" } },
    isPending: false,
    isError: false,
  }),
}));

import { MissionBody } from "./MissionBody";

const originalMatchMedia = window.matchMedia;
const TASK = {
  taskId: "task-1",
  projectId: "p1",
  title: "Mission resolver",
} as unknown as ExternalTask;

function context(over: Partial<MissionContext> = {}): MissionContext {
  return {
    schemaVersion: 1,
    scenario: "iterate",
    missionTabVisible: true,
    runId: "iterate-2026-07-18-demo",
    runLive: false,
    artifacts: [
      {
        kind: "spec",
        label: "Spec",
        state: "available",
        summary: "The plan this session is working to.",
        receipt: "mini-plan.md",
        detail: { type: "document", documentId: "opaque", title: "mini-plan.md" },
      },
      {
        kind: "requirement",
        label: "Requirement",
        state: "available",
        summary: "Expected to affect Mission view.",
        receipt: "FR-01.66",
        detail: { type: "requirements", confidence: "planned", rows: [], specImpact: null },
      },
      // Mid-run the commit does not exist yet → hidden by hide-empty.
      {
        kind: "commit",
        label: "Commit",
        state: "not_yet_created",
        summary: null,
        receipt: null,
        detail: null,
      },
    ],
    tests: null,
    servesFrId: "FR-01.66",
    sourceRev: "rev1",
    ...over,
  };
}

beforeEach(() => {
  missionStateMock.mockReturnValue("live");
  runDetailMock.mockReturnValue({ data: { status: "ok", run: null } as RunDetailResponse });
  contextMock.mockReturnValue({ data: undefined });
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

function setCompact() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === "(max-width: 1023px)",
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function setResponsiveCompact(initial: boolean) {
  let matches = initial;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = "(max-width: 1023px)";
  window.matchMedia = vi.fn(() => ({
    get matches() { return matches; },
    media: query,
    onchange: null,
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.delete(listener),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  return (next: boolean) => {
    matches = next;
    act(() => listeners.forEach((listener) =>
      listener({ matches: next, media: query } as MediaQueryListEvent)));
  };
}

function setup() {
  render(<MissionBody task={TASK} transcriptContent="" onOpenDocument={vi.fn()} />);
}

describe("context-driven artifact rail", () => {
  it("renders the resolver's artifacts for a live iterate (AC1)", () => {
    contextMock.mockReturnValue({ data: context() });
    setup();
    expect(screen.getByTestId("artifact-link-spec")).toBeInTheDocument();
    expect(screen.getByTestId("artifact-link-requirement")).toBeInTheDocument();
  });

  it.each(["done", "launch_failed"] as const)("keeps the resolved terminal OperationCard for %s when the legacy run join has not caught up", (state) => {
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue({ data: { status: "ok", run: null } as RunDetailResponse });
    contextMock.mockReturnValue({ data: context({ runLive: false }) });
    render(<MissionBody task={{ ...TASK, state } as ExternalTask} transcriptContent="" onOpenDocument={vi.fn()} />);
    expect(screen.getByTestId("mission-completed-stack")).toBeInTheDocument();
    // The live placeholder and the resolved card deliberately share the test
    // hook; the completed stack must contain the resolved one.
    expect(screen.getAllByTestId("operation-card")).toHaveLength(2);
  });

  it("HIDES an artifact that does not exist yet (hide-empty)", () => {
    contextMock.mockReturnValue({ data: context() });
    setup();
    expect(screen.queryByTestId("artifact-link-commit")).not.toBeInTheDocument();
  });

  it("SHOWS an unavailable artifact rather than hiding a data-integrity fault", () => {
    contextMock.mockReturnValue({
      data: context({
        artifacts: [
          {
            kind: "commit",
            label: "Commit",
            state: "unavailable",
            summary: null,
            receipt: null,
            note: "The run record could not be read.",
            detail: null,
          },
        ],
      }),
    });
    setup();
    expect(screen.getByTestId("artifact-link-commit")).toBeInTheDocument();
  });

  it("opens the two-region panel on click and closes on re-click (AC3)", () => {
    contextMock.mockReturnValue({ data: context() });
    setup();
    fireEvent.click(screen.getByTestId("artifact-link-spec"));
    expect(screen.getByTestId("mission-artifact-panel")).toBeInTheDocument();
    expect(screen.getByTestId("doc-markdown")).toHaveTextContent("# Plan");
    fireEvent.click(screen.getByTestId("artifact-link-spec"));
    expect(screen.queryByTestId("mission-artifact-panel")).not.toBeInTheDocument();
  });

  it("disables Detail and returns to Overview when a live artifact disappears", async () => {
    setCompact();
    const initial = context();
    contextMock.mockReturnValue({ data: initial });
    const view = render(
      <MissionBody task={TASK} transcriptContent="" onOpenDocument={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("artifact-link-spec"));
    expect(screen.getByTestId("mission-compact-tab-detail")).toBeEnabled();

    contextMock.mockReturnValue({
      data: context({ artifacts: [initial.artifacts[1]] }),
    });
    view.rerender(
      <MissionBody task={TASK} transcriptContent="updated" onOpenDocument={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("mission-compact-tab-detail")).toBeDisabled());
    expect(screen.getByTestId("mission-compact-tab-overview")).toHaveAttribute(
      "aria-selected", "true",
    );
    expect(screen.queryByTestId("mission-artifact-panel")).not.toBeInTheDocument();
  });

  it("restores Overview when the selected artifact disappears on desktop", async () => {
    const switchViewport = setResponsiveCompact(true);
    const initial = context();
    contextMock.mockReturnValue({ data: initial });
    const view = render(
      <MissionBody task={TASK} transcriptContent="" onOpenDocument={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("artifact-link-spec"));
    switchViewport(false);

    contextMock.mockReturnValue({
      data: context({ artifacts: [initial.artifacts[1]] }),
    });
    view.rerender(
      <MissionBody task={TASK} transcriptContent="updated" onOpenDocument={vi.fn()} />,
    );
    switchViewport(true);

    await waitFor(() => expect(
      screen.getByTestId("mission-compact-tab-overview"),
    ).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByTestId("mission-compact-tab-detail")).toBeDisabled();
    expect(screen.getByTestId("mission-panel-overview")).toBeVisible();
  });
});

describe("no-regression fallbacks (AC4)", () => {
  it("keeps the LEGACY rail for a pipeline session", () => {
    contextMock.mockReturnValue({ data: context({ scenario: "pipeline", artifacts: [] }) });
    setup();
    expect(screen.queryByTestId("artifact-link-spec")).not.toBeInTheDocument();
    expect(screen.getByTestId("record-node-spec")).toBeInTheDocument();
  });

  it("keeps the LEGACY rail for a campaign session", () => {
    contextMock.mockReturnValue({ data: context({ scenario: "campaign", artifacts: [] }) });
    setup();
    expect(screen.getByTestId("record-node-spec")).toBeInTheDocument();
  });

  it("keeps the LEGACY rail when the resolver has not answered yet", () => {
    contextMock.mockReturnValue({ data: undefined });
    setup();
    expect(screen.getByTestId("record-node-spec")).toBeInTheDocument();
  });

  it("REFUSES an unknown schema version and falls back rather than misreading", () => {
    contextMock.mockReturnValue({ data: context({ schemaVersion: 99 }) });
    setup();
    expect(screen.queryByTestId("artifact-link-spec")).not.toBeInTheDocument();
    expect(screen.getByTestId("record-node-spec")).toBeInTheDocument();
  });
});
