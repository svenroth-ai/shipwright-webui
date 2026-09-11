/*
 * FR-01.01 triage trg-0f040744 finding 1 — a failed projects load must not
 * render the same "No projects yet" onboarding claim a genuinely-empty
 * successful response gets.
 *
 * Standalone from ProjectsPage.test.tsx (which is at its bloat ceiling).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import ProjectsPage from './ProjectsPage';

beforeEach(() => {
  vi.stubGlobal('EventSource', vi.fn().mockImplementation(() => ({
    onopen: null, onerror: null, onmessage: null, close: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProjectsPage load-error state', () => {
  it('renders a distinct load-error state (not the onboarding empty state) when the projects fetch fails', async () => {
    server.use(http.get('/api/projects', () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    renderPage();
    expect(await screen.findByTestId('projects-load-error')).toBeInTheDocument();
    expect(screen.queryByTestId('projects-empty')).toBeNull();
    expect(screen.queryByText(/no projects yet/i)).toBeNull();
  });

  it('load-error retry re-fetches and recovers once the endpoint starts responding', async () => {
    let failing = true;
    server.use(
      http.get('/api/projects', () =>
        failing
          ? HttpResponse.json({ error: 'boom' }, { status: 500 })
          : HttpResponse.json({ data: [] }),
      ),
    );
    renderPage();
    const retryButton = await screen.findByTestId('projects-load-error-retry');

    failing = false;
    await userEvent.click(retryButton);

    expect(await screen.findByTestId('projects-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('projects-load-error')).toBeNull();
  });
});
