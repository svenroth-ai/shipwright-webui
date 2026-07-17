import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { LaunchFailureNotice } from "./LaunchFailureNotice";
import { resolveLaunchFailure } from "../../lib/launchFailure";

function renderNotice(props: Partial<Parameters<typeof LaunchFailureNotice>[0]> = {}) {
  const failure = props.failure ?? resolveLaunchFailure({ source: "task", state: "launch_failed" })!;
  return render(
    <MemoryRouter>
      <LaunchFailureNotice testId="lfn" {...props} failure={failure} />
    </MemoryRouter>,
  );
}

describe("LaunchFailureNotice", () => {
  it("renders the code-specific title + sentence + machine code (persistent, role=alert)", () => {
    renderNotice({ actions: { retry: { onClick: () => {} } } });
    const notice = screen.getByTestId("lfn");
    expect(notice.getAttribute("role")).toBe("alert");
    expect(screen.getByTestId("lfn-title")).toHaveTextContent("Launch failed");
    expect(screen.getByTestId("lfn-sentence")).toBeInTheDocument();
    expect(screen.getByTestId("lfn-code")).toHaveTextContent("launch_failed");
  });

  it("renders ONLY the actions the surface wires (of those the mapping declares)", () => {
    renderNotice({
      actions: { retry: { onClick: () => {} }, "open-terminal": { onClick: () => {} } },
    });
    // launch_failed lists retry, copy-command, open-terminal — copy-command is
    // unwired here, so it must NOT render (a dead affordance is a lie).
    expect(screen.getByTestId("lfn-retry")).toBeInTheDocument();
    expect(screen.getByTestId("lfn-open-terminal")).toBeInTheDocument();
    expect(screen.queryByTestId("lfn-copy-command")).toBeNull();
  });

  it("fires the wired handler on click", () => {
    const onRetry = vi.fn();
    renderNotice({ actions: { retry: { onClick: onRetry } } });
    fireEvent.click(screen.getByTestId("lfn-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("busy disables Retry and relabels it", () => {
    renderNotice({ busy: true, actions: { retry: { onClick: () => {} } } });
    const retry = screen.getByTestId("lfn-retry");
    expect(retry).toBeDisabled();
    expect(retry).toHaveTextContent(/Retrying/i);
  });

  it("a 403 (no retry) renders no Retry button even if a handler is passed", () => {
    const failure = resolveLaunchFailure({ source: "server", code: "path_traversal_rejected" })!;
    renderNotice({ failure, path: "/evil/../x", actions: { retry: { onClick: () => {} } } });
    expect(screen.queryByTestId("lfn-retry")).toBeNull();
    expect(screen.getByTestId("lfn-path")).toHaveTextContent("/evil/../x");
  });

  it("renders open-project-settings as a Link (href), not a button", () => {
    const failure = resolveLaunchFailure({ source: "server", code: "campaign_not_found" })!;
    renderNotice({ failure, actions: { "open-project-settings": { href: "/projects" } } });
    const link = screen.getByTestId("lfn-open-project-settings");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/projects");
  });

  it("resume-recovery uses recovery tone and offers Resume", () => {
    const failure = resolveLaunchFailure({ source: "resume-recovery" })!;
    renderNotice({ failure, actions: { resume: { onClick: () => {} } } });
    expect(screen.getByTestId("lfn-resume")).toHaveTextContent("Resume");
  });

  it("renders the optional attempted line", () => {
    renderNotice({ attempted: "Launch B1 — glossary-empty-states", actions: { retry: { onClick: () => {} } } });
    expect(screen.getByTestId("lfn-attempted")).toHaveTextContent("Launch B1 — glossary-empty-states");
  });
});
