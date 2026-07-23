import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
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

describe('ProjectsPage', () => {
  it('renders projects heading and new project button', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Projects')).toBeInTheDocument();
      expect(screen.getByText('Create Project')).toBeInTheDocument();
    });
  });

  // Sven 2026-07-17 (AC3): "Create Project" uses the ONE standard .btn-primary,
  // the same treatment as the Board "New task" + the Ship's Log button.
  it('the Create Project button uses the standard .btn-primary', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('projects-create-button')).toHaveClass('btn-primary');
    });
  });

  // A07 teaching empty state (FR-01.50) — when there are no projects, the empty
  // block teaches in one sentence and offers exactly one action.
  it('empty state shows the teaching sentence + exactly one CTA', async () => {
    server.use(
      http.get('/api/projects', () => HttpResponse.json({ data: [] })),
    );
    renderPage();
    const empty = await screen.findByTestId('projects-empty');
    expect(within(empty).getByTestId('projects-empty-sentence')).toHaveTextContent(
      'Each project’s logbook — the accumulated proof between runs.',
    );
    expect(within(empty).getAllByRole('button')).toHaveLength(1);
  });

  it('renders project list from API', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Test Project')).toBeInTheDocument();
    });
  });

  // Gear icon aria-label preserved through the A15 table→gallery rebuild.
  it('gear icon has aria-label "Project settings"', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText('Project settings')).toBeInTheDocument();
    });
  });

  // A15 — the registry renders as a gallery of preview cards, not a <table>.
  it('renders projects as a gallery of log cards (no table)', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('projects-gallery')).toBeInTheDocument();
    });
    expect(screen.getByTestId('projects-card-proj-1')).toBeInTheDocument();
    expect(screen.queryByTestId('projects-table')).toBeNull();
  });

  // A15 — the card carries the colour dot + path + gear + trash (preserved ids).
  it('card shows path + settings + delete affordances for each project', async () => {
    renderPage();
    const card = await screen.findByTestId('projects-card-proj-1');
    expect(within(card).getByText('/tmp/test-project')).toBeInTheDocument();
    expect(screen.getByTestId('projects-settings-proj-1')).toBeInTheDocument();
    expect(screen.getByTestId('projects-delete-proj-1')).toBeInTheDocument();
  });

  // A15 — graded projects (a real A02 logbook) lead the gallery.
  it('sorts graded projects (runCount > 0) first', async () => {
    server.use(
      http.get('/api/projects', () =>
        HttpResponse.json({
          data: [
            { id: 'proj-1', name: 'Alpha', path: '/a', profile: 'custom', status: 'active', lastActive: '2026-07-01T00:00:00Z', createdAt: '2026-06-01T00:00:00Z' },
            { id: 'proj-2', name: 'Beta', path: '/b', profile: 'custom', status: 'active', lastActive: '2026-07-01T00:00:00Z', createdAt: '2026-06-01T00:00:00Z' },
          ],
        }),
      ),
      http.get('/api/external/projects/:id/runs', ({ params }) =>
        HttpResponse.json(
          params.id === 'proj-2'
            ? {
                status: 'ok',
                runCount: 1,
                runs: [
                  { runId: 'iterate-2026-07-05-beta', ts: '2026-07-05T00:00:00Z', source: null, intent: null, changeType: null, summary: 'beta run', description: null, commit: null, specImpact: null, specImpactRaw: null, affectedFrs: [], newFrs: [], tests: { passed: 3, total: 3 }, gates: null, phaseDurations: null, campaign: null, subIterateId: null },
                ],
                gradeTrend: [],
                pipelinePhaseDurations: [],
                skippedLines: 0,
              }
            : { status: 'ok', runCount: 0, runs: [], gradeTrend: [], pipelinePhaseDurations: [], skippedLines: 0 },
        ),
      ),
    );
    renderPage();
    const beta = await screen.findByTestId('projects-card-proj-2');
    const alpha = await screen.findByTestId('projects-card-proj-1');
    await waitFor(() => {
      // Beta (graded) must precede Alpha (ungraded): alpha FOLLOWS beta in the DOM.
      const rel = beta.compareDocumentPosition(alpha);
      expect(rel & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Card click → the Ship's Log home for that project, via the single
  // openProjectLog() seam A16 re-points. Settings stays behind the gear.
  // -------------------------------------------------------------------------

  function LocationEcho() {
    const loc = useLocation();
    return <div data-testid="loc">{loc.pathname + loc.search}</div>;
  }

  function renderWithRouter() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/projects']}>
          <Routes>
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:projectId/log" element={<LocationEcho />} />
            <Route path="/" element={<LocationEcho />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("card click navigates to the project's Ship's Log (A16 re-point)", async () => {
    renderWithRouter();
    const card = await screen.findByTestId('projects-card-proj-1');
    await userEvent.click(card);
    const echo = await screen.findByTestId('loc');
    expect(echo.textContent).toBe('/projects/proj-1/log');
  });

  it('clicking the gear icon does NOT navigate; it opens Settings instead', async () => {
    renderWithRouter();
    const gear = await screen.findByTestId('projects-settings-proj-1');
    await userEvent.click(gear);
    expect(
      await screen.findByTestId('project-settings-dialog'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('loc')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // iterate-2026-07-23-intent-launcher-front-door — "Create Project" is now the
  // guided front door (→ /wizard); the expert registration is reached via the
  // ?new=1 deep-link (the target of every "Register a project manually…").
  // -------------------------------------------------------------------------

  function renderAt(entry: string) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/wizard" element={<LocationEcho />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('"Create Project" navigates to the guided Intent Wizard', async () => {
    renderAt('/projects');
    await userEvent.click(await screen.findByTestId('projects-create-button'));
    expect((await screen.findByTestId('loc')).textContent).toBe('/wizard');
  });

  it('/projects?new=1 auto-opens the expert registration dialog', async () => {
    renderAt('/projects?new=1');
    expect(await screen.findByTestId('wizard-modal')).toBeInTheDocument();
  });

  it('the empty-state "Create Project" also navigates to the wizard (AC3)', async () => {
    server.use(http.get('/api/projects', () => HttpResponse.json({ data: [] })));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/projects']}>
          <Routes>
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/wizard" element={<LocationEcho />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const empty = await screen.findByTestId('projects-empty');
    await userEvent.click(within(empty).getByRole('button'));
    expect((await screen.findByTestId('loc')).textContent).toBe('/wizard');
  });

  it('closing the ?new=1 registration clears the param and does not re-open', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function UrlEcho() {
      const loc = useLocation();
      return <div data-testid="url">{loc.pathname + loc.search}</div>;
    }
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/projects?new=1']}>
          <UrlEcho />
          <Routes>
            <Route path="/projects" element={<ProjectsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId('wizard-modal')).toBeInTheDocument();
    expect(screen.getByTestId('url').textContent).toBe('/projects?new=1');
    // Close it → the ?new param is cleared (replace: true) AND the dialog stays
    // closed: wantsNew flips false, so the open-effect does not re-fire.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('wizard-modal')).toBeNull());
    expect(screen.getByTestId('url').textContent).toBe('/projects');
  });

  // -------------------------------------------------------------------------
  // iterate-2026-07-06-project-delete-cascades-tasks — the confirm must warn
  // how many tasks the cascade removes (and stay silent when there are none).
  // -------------------------------------------------------------------------

  it('delete confirm warns how many tasks will be removed when the project has tasks', async () => {
    server.use(
      http.get('/api/external/tasks', () =>
        HttpResponse.json({
          tasks: [
            { taskId: 't1', projectId: 'proj-1' },
            { taskId: 't2', projectId: 'proj-1' },
          ],
        }),
      ),
    );
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByTestId('projects-card-proj-1-tasks'),
      ).toHaveTextContent('2 tasks');
    });
    await userEvent.click(screen.getByTestId('projects-delete-proj-1'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const msg = confirmSpy.mock.calls[0][0] as string;
    expect(msg).toContain('2 tasks belonging to this project will also be removed');
    confirmSpy.mockRestore();
  });

  it('delete confirm omits the task warning when the project has no tasks', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('projects-delete-proj-1')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('projects-delete-proj-1'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const msg = confirmSpy.mock.calls[0][0] as string;
    expect(msg).not.toContain('belonging to this project');
    confirmSpy.mockRestore();
  });
});
