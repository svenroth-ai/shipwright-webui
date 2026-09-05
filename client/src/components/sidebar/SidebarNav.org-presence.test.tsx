import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SidebarNav } from './SidebarNav';

// Split out of SidebarNav.test.tsx (300-line file-size convention) —
// FR-01.71 Nav presence (AC-6a/AC-7): the sidebar's own call site of
// useOrgChartPresence(). CommandCenter's palette call site mirrors this
// condition (`orgPresence !== 'absent'`), tested there.

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function renderWithRouter(initialEntries = ['/']) {
  const Wrapper = makeWrapper();
  return render(
    <Wrapper>
      <MemoryRouter initialEntries={initialEntries}>
        <SidebarNav inboxCount={0} triageCount={0} />
      </MemoryRouter>
    </Wrapper>,
  );
}

describe('Org nav entry (FR-01.71)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hides "Org" on a confirmed org_chart_missing 404 (AC-6a)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'org_chart_missing' }),
      }),
    );
    renderWithRouter();
    await waitFor(() => expect(screen.queryByText('Org')).toBeNull());
  });

  it('shows "Org" once present (200)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ version: 1, po: 'sven', leads: {} }),
      }),
    );
    renderWithRouter();
    await waitFor(() => expect(screen.getByText('Org')).toBeInTheDocument());
  });

  it('still shows "Org" on a 502 (broken, not absent) — AC-7', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({ error: 'org_chart_invalid' }),
      }),
    );
    renderWithRouter();
    await waitFor(() => expect(screen.getByText('Org')).toBeInTheDocument());
  });
});
