/*
 * Door-wiring tests (A09a, FR-01.52 — AC3).
 *
 * Proves the New plan card and the Adopt result actually BUILD + emit the right
 * launch request when the CTA is clicked — the UI-boundary half of AC3 (the
 * orchestrator half is useWizardLaunch.test.ts). RED on pre-A09a main (the doors
 * had disabled, non-wired CTAs and no `onLaunch` prop).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { NewPathPlanCard } from "./NewPathPlanCard";
import { AdoptResult } from "./AdoptResult";
import { LaunchingScreen } from "./LaunchingScreen";
import type { NewLaunchRequest, AdoptLaunchRequest } from "./contract";

afterEach(() => cleanup());

const ANSWERS = {
  brief: "A booking tool for my yoga studio",
  who: "Customers / public",
  remember: "Yes",
  where: "On the web",
};

describe("New plan card → Go builds a new-pipeline request with the brief (AC3)", () => {
  it("Go is inert until a target folder is given (can't register a project blind)", () => {
    const onLaunch = vi.fn();
    render(<NewPathPlanCard answers={ANSWERS} dispatch={vi.fn()} onLaunch={onLaunch} />);
    expect(screen.getByTestId("wizard-go")).toBeDisabled();
    fireEvent.click(screen.getByTestId("wizard-go"));
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it("with a folder, Go emits actionId new-pipeline + the brief + mapped profile", () => {
    const onLaunch = vi.fn();
    render(<NewPathPlanCard answers={ANSWERS} dispatch={vi.fn()} onLaunch={onLaunch} />);
    fireEvent.change(screen.getByTestId("wizard-plan-folder"), {
      target: { value: "C:\\dev\\yoga" },
    });
    fireEvent.click(screen.getByTestId("wizard-go"));
    expect(onLaunch).toHaveBeenCalledTimes(1);
    const req = onLaunch.mock.calls[0][0] as NewLaunchRequest;
    expect(req.door).toBe("new");
    expect(req.actionId).toBe("new-pipeline");
    expect(req.brief).toContain("A booking tool for my yoga studio");
    expect(req.profile).toBe("supabase-nextjs"); // remember=Yes
    expect(req.path).toBe("C:\\dev\\yoga");
  });

  it("shows the Supabase env note ONLY for web + remember (AC1)", () => {
    const { rerender } = render(
      <NewPathPlanCard answers={ANSWERS} dispatch={vi.fn()} onLaunch={vi.fn()} />,
    );
    expect(screen.getByTestId("wizard-plan-envvars")).toBeInTheDocument();
    rerender(
      <NewPathPlanCard
        answers={{ ...ANSWERS, remember: "No" }}
        dispatch={vi.fn()}
        onLaunch={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("wizard-plan-envvars")).not.toBeInTheDocument();
  });
});

describe("Adopt result → start builds a new-task + adopt request (AC2/AC3)", () => {
  it("emits actionId new-task + adopt phase + a non-empty brief, carrying the path", () => {
    const onLaunch = vi.fn();
    render(<AdoptResult path={"C:\\work\\api-server"} dispatch={vi.fn()} onLaunch={onLaunch} />);
    fireEvent.click(screen.getByTestId("wizard-adopt-start"));
    expect(onLaunch).toHaveBeenCalledTimes(1);
    const req = onLaunch.mock.calls[0][0] as AdoptLaunchRequest;
    expect(req.door).toBe("adopt");
    expect(req.actionId).toBe("new-task");
    expect(req.phase).toBe("adopt");
    expect(req.path).toBe("C:\\work\\api-server");
    expect(req.brief).toContain("api-server");
  });

  it("start is inert without a repo path", () => {
    const onLaunch = vi.fn();
    render(<AdoptResult path={null} dispatch={vi.fn()} onLaunch={onLaunch} />);
    expect(screen.getByTestId("wizard-adopt-start")).toBeDisabled();
  });

  it("refuses a remote URL — adopt needs a local repo (grade→adopt handoff edge)", () => {
    const onLaunch = vi.fn();
    render(<AdoptResult path="github.com/acme/checkout" dispatch={vi.fn()} onLaunch={onLaunch} />);
    expect(screen.getByTestId("wizard-adopt-start")).toBeDisabled();
    expect(screen.getByTestId("wizard-adopt-remote-note")).toHaveTextContent(/clone/i);
    fireEvent.click(screen.getByTestId("wizard-adopt-start"));
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it("does not claim a diff-approval UI the plugin lacks (AC5)", () => {
    render(<AdoptResult path={"C:\\r"} dispatch={vi.fn()} onLaunch={vi.fn()} />);
    const result = screen.getByTestId("wizard-adopt-result");
    expect(result.textContent ?? "").not.toMatch(/show you the diff first/i);
    expect(result.textContent ?? "").not.toMatch(/approve the diff/i);
  });
});

describe("LaunchingScreen (transient + failure states)", () => {
  it("renders the in-flight hand-off state", () => {
    render(<LaunchingScreen door="new" failed={false} onBack={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByTestId("wizard-launching")).toHaveTextContent("/shipwright-run");
  });

  it("failure names the plugin, surfaces the error, and wires a real retry", () => {
    const onRetry = vi.fn();
    render(
      <LaunchingScreen door="adopt" failed error="HTTP 400 boom" onBack={vi.fn()} onRetry={onRetry} />,
    );
    expect(screen.getByTestId("wizard-launch-failed")).toHaveTextContent("/shipwright-adopt");
    expect(screen.getByTestId("wizard-launch-error")).toHaveTextContent("boom");
    fireEvent.click(screen.getByTestId("wizard-launch-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    // Honest copy — never claim "nothing was launched" absolutely (a task may exist).
    expect(screen.getByTestId("wizard-launch-failed").textContent ?? "").not.toMatch(/nothing was launched/i);
  });
});
