import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { StackProfileStep } from './StackProfileStep';

function renderStep(initialProfile = 'custom') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onProfileChange = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <StackProfileStep profile={initialProfile} onProfileChange={onProfileChange} />
    </QueryClientProvider>,
  );
  return { ...utils, onProfileChange };
}

describe('StackProfileStep — dynamic profile rendering (iterate-2026-05-13)', () => {
  it('renders every profile returned by GET /api/profiles (not just supabase)', async () => {
    server.use(
      http.get('/api/profiles', () =>
        HttpResponse.json({
          data: [
            {
              name: 'python-plugin-monorepo',
              label: 'Python Plugin Monorepo',
              description: 'Multi-package Python monorepo with uv',
            },
            {
              name: 'supabase-nextjs',
              label: 'Next.js + Supabase',
              description: 'Full-stack TypeScript with Supabase',
            },
            {
              name: 'vite-hono',
              label: 'Vite + Hono',
              description: 'React frontend + Hono backend monorepo',
            },
          ],
        }),
      ),
    );

    renderStep();

    // All three server-returned profiles must surface as selectable cards.
    expect(await screen.findByText('Python Plugin Monorepo')).toBeInTheDocument();
    expect(await screen.findByText('Next.js + Supabase')).toBeInTheDocument();
    expect(await screen.findByText('Vite + Hono')).toBeInTheDocument();
    // Plus the always-present Custom sentinel.
    expect(screen.getByText('Custom')).toBeInTheDocument();
  });

  it('invokes onProfileChange with the profile name when a card is clicked', async () => {
    server.use(
      http.get('/api/profiles', () =>
        HttpResponse.json({
          data: [
            {
              name: 'vite-hono',
              label: 'Vite + Hono',
              description: 'React + Hono monorepo',
            },
          ],
        }),
      ),
    );

    const { onProfileChange } = renderStep();

    const card = await screen.findByText('Vite + Hono');
    await userEvent.click(card);

    expect(onProfileChange).toHaveBeenCalledWith('vite-hono');
  });

  it('shows loading state before the API response arrives', () => {
    // No MSW override — defaults to a single supabase profile but TanStack
    // Query still goes through a loading tick. We assert the skeleton is
    // present synchronously after render.
    renderStep();
    expect(screen.getByTestId('stack-profile-loading')).toBeInTheDocument();
  });

  it('falls back to Custom-only with an inline error hint when /api/profiles 500s', async () => {
    server.use(
      http.get('/api/profiles', () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
    );

    renderStep();

    // Error hint surfaces after the query settles.
    expect(await screen.findByTestId('stack-profile-error')).toBeInTheDocument();
    // Custom is still selectable.
    expect(screen.getByText('Custom')).toBeInTheDocument();
  });
});
