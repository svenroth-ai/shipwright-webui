// @covers FR-01.76
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { TriageEntry } from "../lib/triageFilterSort";
import { triageDeepLink, useTriageDeepLink } from "./useTriageDeepLink";

const entry = (projectId: string, id: string) => ({ projectId, item: { id } }) as unknown as TriageEntry;

function setup(url: string, entries: TriageEntry[], settled: boolean) {
  const open = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
  );
  const view = renderHook(
    (p: { entries: TriageEntry[]; settled: boolean }) => {
      useTriageDeepLink(p.entries, p.settled, open);
      return useLocation();
    },
    { wrapper, initialProps: { entries, settled } },
  );
  return { open, view };
}

describe("triageDeepLink", () => {
  it("builds the link from project and id, and falls back to the list without an id", () => {
    expect(triageDeepLink("p 1", "trg-ab")).toBe("/triage?project=p%201&item=trg-ab");
    expect(triageDeepLink("p1", null)).toBe("/triage");
  });
});

describe("useTriageDeepLink", () => {
  it("opens the entry of THAT project (ids repeat across projects) and consumes the link", () => {
    const { open, view } = setup(
      "/triage?project=p2&item=trg-1",
      [entry("p1", "trg-1"), entry("p2", "trg-1")],
      true,
    );
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(entry("p2", "trg-1"));
    expect(view.result.current.search).toBe("");
  });

  it("waits while the lists are loading, then opens once the entry arrives", () => {
    const { open, view } = setup("/triage?project=p1&item=trg-9", [], false);
    expect(open).not.toHaveBeenCalled();
    expect(view.result.current.search).toContain("item=trg-9");
    act(() => view.rerender({ entries: [entry("p1", "trg-9")], settled: false }));
    expect(open).toHaveBeenCalledWith(entry("p1", "trg-9"));
    expect(view.result.current.search).toBe("");
  });

  it("a stale link that matches nothing once everything has loaded is dropped without opening anything", () => {
    const { open, view } = setup("/triage?project=p1&item=gone", [entry("p1", "trg-1")], true);
    expect(open).not.toHaveBeenCalled();
    expect(view.result.current.search).toBe("");
  });

  it("does nothing without both parameters", () => {
    const { open, view } = setup("/triage?item=trg-1", [entry("p1", "trg-1")], true);
    expect(open).not.toHaveBeenCalled();
    expect(view.result.current.search).toBe("?item=trg-1");
  });
});
