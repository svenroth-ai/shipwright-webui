/*
 * Unit tests for the All-Projects create-menu cascade
 * (iterate-2026-06-02-all-projects-create-cascade).
 *
 * Scope split, mirroring the repo convention (CreateMenuSplitButton.test.tsx
 * tests pure render; Radix open/submenu *interaction* is covered by Playwright
 * E2E — jsdom does not faithfully drive Radix pointer/submenu flows):
 *   - `ProjectActionsLoader` — the lazy per-project action loader. Pure data
 *     logic (filter / loading / empty / hide-when-empty), Radix-agnostic.
 *   - `ProjectCreateMenu` / `ProjectPlainPicker` — trigger render + disabled
 *     states only.
 * Full click-through (open → expand project → click action → modal scoped to
 * that project) lives in the Playwright spec.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  ProjectActionsLoader,
  ProjectCreateMenu,
  ProjectPlainPicker,
} from "./ProjectCreateCascade";
import type {
  ActionDefinition,
  ResolvedProjectActions,
} from "../../lib/externalApi";
import type { Project } from "../../types";

const TASK: ActionDefinition = {
  id: "new-task",
  label: "New task",
  kind: "external_launch",
  command_template: "x",
};
const ITERATE: ActionDefinition = {
  id: "new-iterate",
  label: "New iterate",
  kind: "external_launch",
  command_template: "z",
};
const PLAIN: ActionDefinition = {
  id: "new-plain",
  label: "Plain Claude",
  kind: "external_launch",
  command_template: "p",
};

function resolved(actions: ActionDefinition[]): ResolvedProjectActions {
  return {
    actions,
    phases: [],
    defaults: { autonomy: "guided" },
    preview: {
      enabled: false,
      command: null,
      port: null,
      ready_path: null,
      ready_timeout_seconds: null,
    },
    diagnostics: [],
  };
}

const PROJECTS: Project[] = [
  {
    id: "p1",
    name: "Webui",
    path: "/p1",
    profile: "x",
    status: "active",
    lastActive: "2026-06-01",
    createdAt: "2026-01-01",
  },
  {
    id: "p2",
    name: "Content",
    path: "/p2",
    profile: "x",
    status: "active",
    lastActive: "2026-05-01",
    createdAt: "2026-01-01",
  },
];

function makeQc() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}
function seed(qc: QueryClient, projectId: string, actions: ActionDefinition[]) {
  // Mirror useProjectActions' query key so the hook resolves from cache and
  // never touches fetch.
  qc.setQueryData(["project-actions", projectId], resolved(actions));
}
function wrap(qc: QueryClient, ui: React.ReactNode) {
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProjectActionsLoader", () => {
  beforeEach(() => {
    // Unseeded queries would hit fetch; stub it to a never-resolving promise
    // so loading-state stays loading and no rejection escapes the test.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });

  // @covers FR-01.38
  it("renders the project's actions, applying the filter", () => {
    const qc = makeQc();
    seed(qc, "p1", [TASK, ITERATE, PLAIN]);
    wrap(
      qc,
      <ProjectActionsLoader projectId="p1" filter={(a) => a.id !== "new-plain"}>
        {(actions) => (
          <>
            {actions.map((a) => (
              <span key={a.id} data-testid={`a-${a.id}`}>
                {a.label}
              </span>
            ))}
          </>
        )}
      </ProjectActionsLoader>,
    );
    expect(screen.getByTestId("a-new-task")).toBeTruthy();
    expect(screen.getByTestId("a-new-iterate")).toBeTruthy();
    expect(screen.queryByTestId("a-new-plain")).toBeNull();
  });

  // @covers FR-01.38
  it("shows a loading placeholder before data arrives", () => {
    const qc = makeQc(); // not seeded → isLoading
    wrap(
      qc,
      <ProjectActionsLoader projectId="pX" filter={() => true}>
        {() => <span data-testid="should-not-render" />}
      </ProjectActionsLoader>,
    );
    expect(screen.getByTestId("project-actions-loading-pX")).toBeTruthy();
    expect(screen.queryByTestId("should-not-render")).toBeNull();
  });

  // @covers FR-01.38
  it("renders the empty placeholder when no actions match (create submenu)", () => {
    const qc = makeQc();
    seed(qc, "p1", [PLAIN]); // only new-plain; the create filter excludes it
    wrap(
      qc,
      <ProjectActionsLoader
        projectId="p1"
        filter={(a) => a.id !== "new-plain"}
        emptyLabel="No actions configured"
      >
        {(actions) => (
          <>
            {actions.map((a) => (
              <span key={a.id} data-testid={`a-${a.id}`} />
            ))}
          </>
        )}
      </ProjectActionsLoader>,
    );
    expect(screen.getByTestId("project-actions-empty-p1")).toBeTruthy();
  });

  // @covers FR-01.38
  it("hides entirely (renders nothing) when empty and hideWhenEmpty is set", () => {
    const qc = makeQc();
    seed(qc, "p2", [TASK, ITERATE]); // no new-plain
    const { container } = wrap(
      qc,
      <ProjectActionsLoader
        projectId="p2"
        filter={(a) => a.id === "new-plain"}
        hideWhenEmpty
      >
        {() => <span data-testid="plain-row" />}
      </ProjectActionsLoader>,
    );
    expect(screen.queryByTestId("plain-row")).toBeNull();
    expect(screen.queryByTestId("project-actions-empty-p2")).toBeNull();
    expect(container.textContent).toBe("");
  });
});

describe("ProjectCreateMenu / ProjectPlainPicker triggers", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });

  // @covers FR-01.38
  it("create-menu cascade renders a trigger, disabled when there are no projects", () => {
    const qc = makeQc();
    wrap(qc, <ProjectCreateMenu projects={[]} onSelect={vi.fn()} />);
    const trigger = screen.getByTestId(
      "create-menu-cascade-trigger",
    ) as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    expect(trigger.disabled).toBe(true);
  });

  // @covers FR-01.38
  it("create-menu cascade trigger is enabled when projects exist", () => {
    const qc = makeQc();
    wrap(qc, <ProjectCreateMenu projects={PROJECTS} onSelect={vi.fn()} />);
    const trigger = screen.getByTestId(
      "create-menu-cascade-trigger",
    ) as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);
  });

  // @covers FR-01.38
  it("plain picker renders a trigger when projects exist", () => {
    const qc = makeQc();
    wrap(qc, <ProjectPlainPicker projects={PROJECTS} onSelect={vi.fn()} />);
    expect(screen.getByTestId("plain-cascade-trigger")).toBeTruthy();
  });
});

/*
 * Sven 2026-07-21 (iterate-2026-07-21-all-projects-new-button-parity).
 *
 * The 2026-07-17 standardisation pass put the Board "New task", "Create Project"
 * and the Ship's Log button on the ONE canonical `.btn-primary` contract
 * (styles/buttons.css: fixed 36px height, 132px min-width, --btn-primary-bg
 * #0E7A6B). This trigger was MISSED and kept hand-rolling its own box:
 * `bg-[var(--color-primary)] px-4 py-2` + a 1.5px ring on the wrapper. Inside
 * the board header `.chrome-dark-controls` re-points --color-primary at
 * #35B8A4 — precisely the brighter teal buttons.css records as RETIRED — so the
 * All-Projects button was a different colour AND a different size, and with no
 * min-width its left edge landed somewhere else than every other page's CTA.
 *
 * Asserting the CLASS (not computed pixels) is deliberate: jsdom applies no
 * stylesheet, so geometry is unobservable here. The class is the contract;
 * buttons.css owns the geometry behind it. Same shape as the sibling assertion
 * in pages/ProjectsPage.test.tsx.
 */
describe("All-Projects create trigger — the ONE primary-button standard", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });

  // @covers FR-01.38
  it("carries the canonical .btn-primary", () => {
    const qc = makeQc();
    wrap(qc, <ProjectCreateMenu projects={PROJECTS} onSelect={vi.fn()} />);
    expect(screen.getByTestId("create-menu-cascade-trigger")).toHaveClass(
      "btn-primary",
    );
  });

  // @covers FR-01.38
  it("re-implements neither the primary colour nor its own padding box", () => {
    const qc = makeQc();
    wrap(qc, <ProjectCreateMenu projects={PROJECTS} onSelect={vi.fn()} />);
    const cls = screen.getByTestId("create-menu-cascade-trigger").className;
    expect(cls).not.toContain("bg-[var(--color-primary)]");
    expect(cls).not.toContain("px-4");
    expect(cls).not.toContain("py-2");
  });

  // The wrapper existed only to draw a rounded 1.5px ring around the hand-rolled
  // button; `.btn-primary` owns radius + colour, so the ring must not come back
  // (it added ~3px of height, breaking the fixed-geometry contract).
  // @covers FR-01.38
  it("no longer wraps the trigger in its own bordered shell", () => {
    const qc = makeQc();
    wrap(qc, <ProjectCreateMenu projects={PROJECTS} onSelect={vi.fn()} />);
    const cls = screen.getByTestId("create-menu-cascade").className;
    expect(cls).not.toContain("border-[1.5px]");
    expect(cls).not.toContain("border-[var(--color-primary)]");
  });
});
