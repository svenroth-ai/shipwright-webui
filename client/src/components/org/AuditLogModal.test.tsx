/*
 * AuditLogModal.test.tsx — code-review regression: closing the modal
 * unmounts it (`LeadCard.tsx`'s `{auditOpen && <AuditLogModal .../>}`), and
 * TanStack Query's default `gcTime` keeps the page's data cached for a
 * later remount. The modal must render the SAME entries on that cache-hit
 * remount, never a blank body — see AuditLogModal.tsx's header comment.
 */
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, afterEach } from "vitest";

import { AuditLogModal } from "./AuditLogModal";
import { fetchLeadAuditLog, type AuditLogPage } from "../../lib/orgApi";
import { ApiError } from "../../lib/externalApi";

vi.mock("../../lib/orgApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/orgApi")>();
  return { ...actual, fetchLeadAuditLog: vi.fn() };
});

const mockedFetch = vi.mocked(fetchLeadAuditLog);

function page(entries: string[], nextCursor: number | null): AuditLogPage {
  return {
    entries: entries.map((raw) => ({ raw, parsed: null })),
    total: entries.length,
    nextCursor,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AuditLogModal — cache-hit remount renders the same entries, never blank", () => {
  it("shows entries again on close then reopen within the cache window", async () => {
    mockedFetch.mockResolvedValue(page(["entry-1", "entry-2"], null));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onOpenChange = vi.fn();

    const first = render(
      <QueryClientProvider client={qc}>
        <AuditLogModal open onOpenChange={onOpenChange} leadId="acme-lead" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("org-audit-log-entries")).toBeInTheDocument());
    expect(screen.getAllByText(/entry-\d/)).toHaveLength(2);
    first.unmount();

    // Reopen — same QueryClient instance, so the page's data is still in
    // cache. This is the exact scenario the regression broke: local `pages`
    // state re-initializes empty on remount, and the fetch never re-runs
    // for cached data.
    render(
      <QueryClientProvider client={qc}>
        <AuditLogModal open onOpenChange={onOpenChange} leadId="acme-lead" />
      </QueryClientProvider>,
    );

    // The regression: entries must be visible from the CACHED data
    // immediately, synchronously on this render — not only after a fresh
    // fetch resolves (a background refetch may still happen for freshness,
    // but the cached page must never render blank while it's in flight).
    expect(screen.getByTestId("org-audit-log-entries")).toBeInTheDocument();
    expect(screen.getAllByText(/entry-\d/)).toHaveLength(2);
  });
});

describe("AuditLogModal — pagination", () => {
  it("appends the next page's entries under 'Load older entries' without duplicating the first page", async () => {
    mockedFetch.mockImplementation(async (_leadId, opts) => {
      if (opts?.before === undefined) return page(["newest"], 42);
      if (opts.before === 42) return page(["older"], null);
      throw new Error(`unexpected cursor ${opts.before}`);
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <AuditLogModal open onOpenChange={vi.fn()} leadId="acme-lead" />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText("newest")).toBeInTheDocument());
    expect(screen.getByTestId("org-audit-log-load-older")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("org-audit-log-load-older"));

    await waitFor(() => expect(screen.getByText("older")).toBeInTheDocument());
    expect(screen.getByText("newest")).toBeInTheDocument();
    expect(screen.queryByTestId("org-audit-log-load-older")).not.toBeInTheDocument();
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });
});

describe("AuditLogModal — doubt-review fixes", () => {
  it("a rapid double-click on 'Load older entries' does not duplicate the next page (idempotent cursor push)", async () => {
    let olderCalls = 0;
    mockedFetch.mockImplementation(async (_leadId, opts) => {
      if (opts?.before === undefined) return page(["newest"], 42);
      if (opts.before === 42) {
        olderCalls += 1;
        return page(["older"], null);
      }
      throw new Error(`unexpected cursor ${opts.before}`);
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <AuditLogModal open onOpenChange={vi.fn()} leadId="acme-lead" />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText("newest")).toBeInTheDocument());
    const button = screen.getByTestId("org-audit-log-load-older");
    // Two clicks back-to-back, before either state update has flushed to a
    // re-render — the exact race the fix's idempotency check guards.
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByText("older")).toBeInTheDocument());
    expect(screen.getAllByText("older")).toHaveLength(1);
    expect(olderCalls).toBe(1);
  });

  it("a failed later page shows a per-page error and Retry re-fetches that SAME page, not page one", async () => {
    let olderAttempts = 0;
    mockedFetch.mockImplementation(async (_leadId, opts) => {
      if (opts?.before === undefined) return page(["newest"], 42);
      if (opts.before === 42) {
        olderAttempts += 1;
        if (olderAttempts === 1) throw new ApiError("broken", 502, {});
        return page(["older"], null);
      }
      throw new Error(`unexpected cursor ${opts.before}`);
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <AuditLogModal open onOpenChange={vi.fn()} leadId="acme-lead" />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText("newest")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("org-audit-log-load-older"));

    await waitFor(() => expect(screen.getByTestId("org-audit-log-page-error")).toBeInTheDocument());
    // The first page's entries stay visible — a later-page failure must not
    // blank out what already loaded successfully.
    expect(screen.getByText("newest")).toBeInTheDocument();
    const retry = screen.getByTestId("org-audit-log-load-older");
    expect(retry).toHaveTextContent("Retry");

    fireEvent.click(retry);

    await waitFor(() => expect(screen.getByText("older")).toBeInTheDocument());
    expect(screen.queryByTestId("org-audit-log-page-error")).not.toBeInTheDocument();
    expect(olderAttempts).toBe(2);
  });
});

describe("AuditLogModal — not-found and error states", () => {
  it("renders the not-found state on a 404, not the generic error state", async () => {
    mockedFetch.mockRejectedValue(new ApiError("not_found", 404, {}));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <AuditLogModal open onOpenChange={vi.fn()} leadId="acme-lead" />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("org-audit-log-not-found")).toBeInTheDocument());
  });

  it("renders the generic error state on a non-404 failure", async () => {
    mockedFetch.mockRejectedValue(new ApiError("broken", 502, {}));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <AuditLogModal open onOpenChange={vi.fn()} leadId="acme-lead" />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("org-audit-log-error")).toBeInTheDocument());
  });
});
