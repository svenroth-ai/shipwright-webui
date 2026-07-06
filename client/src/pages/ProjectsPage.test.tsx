import { render, screen, waitFor } from '@testing-library/react';
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

  it('renders project list from API', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Test Project')).toBeInTheDocument();
    });
  });

  // Iterate 14.8.2 — gear icon aria-label preserved in 3.7e-b3 table rebuild.
  it('gear icon has aria-label "Project settings"', async () => {
    renderPage();
    await waitFor(() => {
      const gearBtn = screen.getByLabelText('Project settings');
      expect(gearBtn).toBeInTheDocument();
    });
  });

  // Iterate 3.7e-b3 — table structure.
  it('renders projects as a <table> with header row', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('projects-table')).toBeInTheDocument();
    });
    // Column headers (uppercase + displayed in the <th> cells).
    expect(screen.getByText(/Name/i)).toBeInTheDocument();
    expect(screen.getByText(/Path/i)).toBeInTheDocument();
    expect(screen.getByText(/Tasks/i)).toBeInTheDocument();
    expect(screen.getByText(/Actions/i)).toBeInTheDocument();
  });

  // AC-5 (iterate-2026-06-15) — the Path column is hidden on the compact band
  // (≤1023px) via `hidden lg:table-cell` so the table fits without a bottom
  // horizontal scrollbar; it returns on desktop.
  it("Path column header + cells carry hidden lg:table-cell (compact-band hide)", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("projects-cell-proj-1-path")).toBeInTheDocument();
    });
    const pathHeader = screen.getByText("Path");
    expect(pathHeader.className).toContain("hidden");
    expect(pathHeader.className).toContain("lg:table-cell");
    const pathCell = screen.getByTestId("projects-cell-proj-1-path");
    expect(pathCell.className).toContain("hidden");
    expect(pathCell.className).toContain("lg:table-cell");
  });

  // Iterate 3.7e-b3 — the project row has color + path + delete affordances.
  it('renders color swatch + path + delete button for each project', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('projects-row-proj-1')).toBeInTheDocument();
    });
    expect(screen.getByTestId('projects-cell-proj-1-color')).toBeInTheDocument();
    expect(screen.getByTestId('projects-cell-proj-1-path')).toBeInTheDocument();
    expect(screen.getByTestId('projects-settings-proj-1')).toBeInTheDocument();
    expect(screen.getByTestId('projects-delete-proj-1')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // iterate-20260501-projects-row-click-navigates — row click → TaskBoard
  // with that project preselected. Previously opened the Settings dialog;
  // settings now lives behind the gear icon only.
  // -------------------------------------------------------------------------

  /** Inline location echo so the assertion can read URL post-navigation. */
  function LocationEcho() {
    const loc = useLocation();
    return (
      <div data-testid="loc">{loc.pathname + loc.search}</div>
    );
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
            <Route path="/" element={<LocationEcho />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('row click navigates to TaskBoard with projectId in the URL', async () => {
    renderWithRouter();
    const row = await screen.findByTestId('projects-row-proj-1');
    // Click the name cell — the row's onClick handles it.
    await userEvent.click(row);
    const echo = await screen.findByTestId('loc');
    expect(echo.textContent).toBe('/?projectId=proj-1');
  });

  it('clicking the gear icon does NOT navigate; it opens Settings instead', async () => {
    renderWithRouter();
    const gear = await screen.findByTestId('projects-settings-proj-1');
    await userEvent.click(gear);
    // Settings dialog opens — root testid present.
    expect(
      await screen.findByTestId('project-settings-dialog'),
    ).toBeInTheDocument();
    // No location echo means we did NOT navigate to "/".
    expect(screen.queryByTestId('loc')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // iterate-2026-07-06-project-delete-cascades-tasks — deleting a project now
  // cascade-removes its tasks, so the confirm dialog must warn how many are
  // affected (and stay silent when there are none).
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
    // Wait until the task-count column reflects the 2 tasks so the memoized
    // count is populated before we click delete.
    await waitFor(() => {
      expect(
        screen.getByTestId('projects-cell-proj-1-tasks').textContent,
      ).toBe('2');
    });
    await userEvent.click(screen.getByTestId('projects-delete-proj-1'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const msg = confirmSpy.mock.calls[0][0] as string;
    expect(msg).toContain('2 tasks belonging to this project will also be removed');
    confirmSpy.mockRestore();
  });

  it('delete confirm omits the task warning when the project has no tasks', async () => {
    // Default handler returns { tasks: [] } → proj-1 has 0 tasks.
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
