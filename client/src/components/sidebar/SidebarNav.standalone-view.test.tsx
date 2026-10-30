import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SidebarNav } from './SidebarNav';
import { setStandaloneViewEnabled } from '../../lib/standaloneView';

function setup() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(), onchange: null,
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><SidebarNav inboxCount={0} triageCount={0} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SidebarNav in Standalone view', () => {
  beforeEach(() => { localStorage.clear(); act(() => setStandaloneViewEnabled(false)); });

  // @covers FR-01.03
  it('shows Triage by default and hides it live when the view is turned on', () => {
    setup();
    expect(screen.getByRole('link', { name: /Triage/ })).toBeInTheDocument();
    act(() => setStandaloneViewEnabled(true));
    expect(screen.queryByRole('link', { name: /Triage/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Inbox/ })).toBeInTheDocument();
  });
});
