import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { ProjectWizard } from './ProjectWizard';

function renderWizard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectWizard open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('ProjectWizard', () => {
  it('renders step 1 with name and path fields', () => {
    renderWizard();
    expect(screen.getByText('New Project')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('My Awesome App')).toBeInTheDocument();
    // Phase B5 — step label is now "Step 1 of 4 — Project Info" (one span).
    expect(screen.getByText(/Step 1 of 4/)).toBeInTheDocument();
    expect(screen.getByText(/Project Info/)).toBeInTheDocument();
  });

  it('navigates to step 2 on Next', async () => {
    renderWizard();
    await userEvent.type(screen.getByPlaceholderText('My Awesome App'), 'Test');
    // Path input placeholder changed
    const pathInput = screen.getByPlaceholderText(/Users|home|projects/);
    await userEvent.type(pathInput, '/tmp/test');
    await userEvent.click(screen.getByTestId('wizard-next'));
    // Phase B5 — step label contains "Stack & Profile"; match it via regex.
    expect(screen.getByText(/Stack & Profile/)).toBeInTheDocument();
  });

  it('disables Next when name is empty', () => {
    renderWizard();
    expect(screen.getByTestId('wizard-next')).toBeDisabled();
  });

  // Iterate 14.7.1 — the old "Browse" button was renamed to "Paste" (the
  // File System Access API never returned a usable absolute path; we now
  // paste from the clipboard instead).
  it('shows paste button for the project directory field', () => {
    renderWizard();
    expect(screen.getByTestId('project-path-paste')).toBeInTheDocument();
    expect(screen.getByText('Paste')).toBeInTheDocument();
  });

  // Iterate 3.7e-b3 — color picker appears on the confirmation step so a
  // color can be set at create time. Navigate wizard to step 3 (index 3).
  it('shows color picker on confirmation step', async () => {
    renderWizard();
    await userEvent.type(screen.getByPlaceholderText('My Awesome App'), 'Test');
    const pathInput = screen.getByPlaceholderText(/Users|home|projects/);
    await userEvent.type(pathInput, '/tmp/test');
    // Step 1 → Step 2
    await userEvent.click(screen.getByTestId('wizard-next'));
    // Step 2 → Step 3
    await userEvent.click(screen.getByTestId('wizard-next'));
    // Step 3 → Step 4 (confirmation)
    await userEvent.click(screen.getByTestId('wizard-next'));
    expect(screen.getByTestId('wizard-color-section')).toBeInTheDocument();
    expect(screen.getByTestId('project-color-picker')).toBeInTheDocument();
    // Auto swatch is preset by default.
    const autoSwatch = screen.getByTestId('wizard-color-swatch-auto');
    expect(autoSwatch).toHaveAttribute('data-selected', 'true');
  });

  // -------------------------------------------------------------------------
  // iterate-20260501-wizard-actions-upload — file picker in Advanced step.
  // -------------------------------------------------------------------------

  /** Drive the wizard from step 0 to the confirmation step, including
   *  opening Advanced and switching to the Custom workflow choice. */
  async function gotoAdvancedCustom() {
    await userEvent.type(screen.getByPlaceholderText('My Awesome App'), 'Test');
    const pathInput = screen.getByPlaceholderText(/Users|home|projects/);
    await userEvent.type(pathInput, '/tmp/test');
    await userEvent.click(screen.getByTestId('wizard-next')); // 0→1
    await userEvent.click(screen.getByTestId('wizard-next')); // 1→2
    await userEvent.click(screen.getByTestId('wizard-next')); // 2→3
    // Open Advanced + pick Custom.
    await userEvent.click(
      screen.getByText(/Show advanced options/),
    );
    await userEvent.click(screen.getByTestId('wizard-workflow-custom'));
  }

  it('renders the actions-upload picker only when Custom is selected', async () => {
    renderWizard();
    await userEvent.type(screen.getByPlaceholderText('My Awesome App'), 'Test');
    const pathInput = screen.getByPlaceholderText(/Users|home|projects/);
    await userEvent.type(pathInput, '/tmp/test');
    await userEvent.click(screen.getByTestId('wizard-next'));
    await userEvent.click(screen.getByTestId('wizard-next'));
    await userEvent.click(screen.getByTestId('wizard-next'));
    await userEvent.click(screen.getByText(/Show advanced options/));
    // Default radio is "shipwright" → no upload box.
    expect(screen.queryByTestId('wizard-actions-upload')).toBeNull();
    await userEvent.click(screen.getByTestId('wizard-workflow-custom'));
    expect(screen.getByTestId('wizard-actions-upload')).toBeInTheDocument();
  });

  it('rejects an unparseable JSON file at pick time + disables Create', async () => {
    renderWizard();
    await gotoAdvancedCustom();

    const fileInput = screen.getByTestId('wizard-actions-file') as HTMLInputElement;
    const bad = new File(['{ not json'], 'broken.json', {
      type: 'application/json',
    });
    await userEvent.upload(fileInput, bad);

    expect(
      await screen.findByTestId('wizard-actions-pre-error'),
    ).toBeInTheDocument();
    // Filename indicator must NOT show — the file was rejected.
    expect(screen.queryByTestId('wizard-actions-filename')).toBeNull();
    // Create button is gated.
    const createBtn = screen.getByTestId('wizard-next') as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);
  });

  it('uploads the picked file via POST /actions-upload after project creation', async () => {
    let createdId: string | null = null;
    let uploadedBody: string | null = null;
    server.use(
      http.post('/api/projects', async () => {
        createdId = 'proj-new';
        return HttpResponse.json({
          data: {
            id: createdId,
            name: 'Test',
            path: '/tmp/test',
            profile: 'custom',
            status: 'active',
            createdAt: '2026-05-01T00:00:00Z',
            lastActive: '2026-05-01T00:00:00Z',
          },
        });
      }),
      http.post('/api/projects/:id/actions-upload', async ({ request, params }) => {
        if (params.id !== 'proj-new') {
          return HttpResponse.json({ error: 'wrong_project' }, { status: 500 });
        }
        uploadedBody = await request.text();
        return HttpResponse.json({
          path: '/tmp/test/.webui/actions.json',
          written: true,
        });
      }),
    );

    renderWizard();
    await gotoAdvancedCustom();

    const fileInput = screen.getByTestId('wizard-actions-file') as HTMLInputElement;
    const valid = JSON.stringify({
      schemaVersion: 1,
      defaults: { autonomy: 'guided' },
      actions: [],
      phases: [{ id: 'content', label: 'Content' }],
      preview: { enabled: 'auto' },
    });
    await userEvent.upload(
      fileInput,
      new File([valid], 'good.json', { type: 'application/json' }),
    );
    expect(
      await screen.findByTestId('wizard-actions-filename'),
    ).toHaveTextContent('good.json');

    // Click Create.
    await userEvent.click(screen.getByTestId('wizard-next'));

    await waitFor(() => {
      expect(createdId).toBe('proj-new');
      expect(uploadedBody).not.toBeNull();
    });
    expect(uploadedBody).toContain('"schemaVersion"');
  });

  it('keeps the wizard open and surfaces an error when post-create upload fails', async () => {
    server.use(
      http.post('/api/projects', () =>
        HttpResponse.json({
          data: {
            id: 'proj-new',
            name: 'Test',
            path: '/tmp/test',
            profile: 'custom',
            status: 'active',
            createdAt: '2026-05-01T00:00:00Z',
            lastActive: '2026-05-01T00:00:00Z',
          },
        }),
      ),
      http.post('/api/projects/:id/actions-upload', () =>
        HttpResponse.json(
          {
            error: 'invalid_placeholder',
            placeholder: 'task.priority',
            actionId: 'new-content-creator',
          },
          { status: 400 },
        ),
      ),
    );

    renderWizard();
    await gotoAdvancedCustom();

    const fileInput = screen.getByTestId('wizard-actions-file') as HTMLInputElement;
    const validButServerRejects = JSON.stringify({
      schemaVersion: 1,
      defaults: { autonomy: 'guided' },
      actions: [],
      phases: [{ id: 'content', label: 'Content' }],
      preview: { enabled: 'auto' },
    });
    await userEvent.upload(
      fileInput,
      new File([validButServerRejects], 'rejected.json', {
        type: 'application/json',
      }),
    );

    await userEvent.click(screen.getByTestId('wizard-next'));

    const banner = await screen.findByTestId('wizard-actions-upload-error');
    expect(banner).toHaveTextContent(/upload failed/i);
    expect(banner).toHaveTextContent(/task\.priority/);
    // Wizard root still open.
    expect(screen.getByTestId('wizard-modal')).toBeInTheDocument();
  });
});
