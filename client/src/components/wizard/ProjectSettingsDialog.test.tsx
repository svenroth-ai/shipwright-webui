/*
 * Iterate 3.7e-b3 (2026-04-22) — ProjectSettingsDialog smoke tests.
 *
 * Covers: render with a project, name input seeded, path read-only, color
 * picker present, error banner shows on 500.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';
import type { Project } from '../../types';

const TEST_PROJECT: Project = {
  id: 'proj-1',
  name: 'Test Project',
  path: '/tmp/test-project',
  profile: 'custom',
  status: 'active',
  lastActive: '2026-04-10T10:00:00Z',
  createdAt: '2026-04-01T00:00:00Z',
  settings: { color: '#B8A590' },
};

function renderDialog(project: Project | null = TEST_PROJECT) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectSettingsDialog project={project} open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('ProjectSettingsDialog', () => {
  // @covers FR-01.27
  it('renders name field seeded from project', () => {
    renderDialog();
    const nameInput = screen.getByTestId('project-settings-name') as HTMLInputElement;
    expect(nameInput.value).toBe('Test Project');
  });

  // @covers FR-01.27
  it('displays path read-only', () => {
    renderDialog();
    const pathDisplay = screen.getByTestId('project-settings-path');
    expect(pathDisplay).toHaveTextContent('/tmp/test-project');
    // It's a div, not an input — no form submission for path.
    expect(pathDisplay.tagName.toLowerCase()).toBe('div');
  });

  // @covers FR-01.27
  it('color picker reflects current color selection', () => {
    renderDialog();
    const selectedSwatch = screen.getByTestId('project-settings-color-b8a590');
    expect(selectedSwatch).toHaveAttribute('data-selected', 'true');
  });

  // @covers FR-01.27
  it('renders the Actions configuration section in COMPACT mode for a project with a path', () => {
    // iterate-2026-06-14-actions-config-ux — the edit modal hosts the same
    // per-project actions surface as the Settings page, but in compact mode
    // (hideProjectHeader): badge + controls, no redundant name/path (the modal
    // already shows both above).
    renderDialog();
    const section = screen.getByTestId('project-settings-actions');
    expect(section).toBeInTheDocument();
    const row = within(section);
    expect(row.getByTestId('actions-config-row-proj-1')).toBeInTheDocument();
    // Compact: badge + Upload + Reset present...
    expect(row.getByTestId('actions-config-state-proj-1')).toBeInTheDocument();
    expect(row.getByText('Upload .json')).toBeInTheDocument();
    expect(row.getByTestId('actions-config-reset-proj-1')).toBeInTheDocument();
    // ...but the redundant project name + path are NOT repeated inside the row.
    expect(row.queryByText('Test Project')).toBeNull();
    expect(row.queryByText('/tmp/test-project')).toBeNull();
  });

  // @covers FR-01.27
  it('hides the Actions section when the project has no path', () => {
    renderDialog({ ...TEST_PROJECT, path: '' });
    expect(screen.queryByTestId('project-settings-actions')).toBeNull();
  });

  // @covers FR-01.27
  it('shows error banner on PATCH failure and keeps dialog open', async () => {
    server.use(
      http.patch('/api/projects/:id', () =>
        HttpResponse.json(
          { error: 'EACCES: permission denied' },
          { status: 500 },
        ),
      ),
    );
    renderDialog();
    await userEvent.click(screen.getByTestId('project-settings-save'));
    await waitFor(() => {
      expect(screen.getByTestId('project-settings-error')).toBeInTheDocument();
    });
    // Dialog root still in DOM — save did not close it.
    expect(screen.getByTestId('project-settings-dialog')).toBeInTheDocument();
  });
});
