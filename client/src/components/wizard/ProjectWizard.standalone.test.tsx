// @covers FR-01.03
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { ProjectWizard } from './ProjectWizard';

// iterate-2026-10-29-standalone-mode — the registration checkbox decides
// whether the POST carries `standalone: true`.

function renderWizard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectWizard open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

async function createWith(tickStandalone: boolean): Promise<Record<string, unknown>> {
  let posted: Record<string, unknown> | null = null;
  server.use(
    http.post('/api/projects', async ({ request }) => {
      posted = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json(
        {
          data: {
            id: 'p-new',
            name: 'Test',
            path: '/tmp/test',
            profile: 'custom',
            status: 'active',
            createdAt: '2026-05-01T00:00:00Z',
            lastActive: '2026-05-01T00:00:00Z',
          },
        },
        { status: 201 },
      );
    }),
  );
  renderWizard();
  await userEvent.type(screen.getByPlaceholderText('My Awesome App'), 'Test');
  await userEvent.type(screen.getByPlaceholderText(/Users|home|projects/), '/tmp/test');
  if (tickStandalone) await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(screen.getByTestId('wizard-next')); // 0→1
  await userEvent.click(screen.getByTestId('wizard-next')); // 1→2
  await userEvent.click(screen.getByTestId('wizard-next')); // 2→3
  await userEvent.click(screen.getByTestId('wizard-next')); // Create
  await waitFor(() => expect(posted).not.toBeNull());
  return posted as unknown as Record<string, unknown>;
}

describe('ProjectWizard — standalone registration', () => {
  it('offers the Standalone checkbox, unticked by default', () => {
    renderWizard();
    const box = screen.getByRole('checkbox') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(screen.getByText(/don.t touch this repository/i)).toBeInTheDocument();
  });

  it('sends standalone: true when ticked', async () => {
    const body = await createWith(true);
    expect(body.standalone).toBe(true);
  });

  it('omits the field when left unticked', async () => {
    const body = await createWith(false);
    expect('standalone' in body).toBe(false);
  });
});
