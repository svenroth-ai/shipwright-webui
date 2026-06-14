import { render, screen, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MainLayout } from './MainLayout';
import type { InboxItem } from '../lib/externalApi';

function mockViewport(opts: { phone: boolean }) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    // Phone => phone + compact queries match; pointer:coarse left false.
    matches: opts.phone && query.includes('max-width'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// Mock the inbox hook so we can drive the sidebar badge count deterministically
// (AC-7 — the badge count must include `text_question` items).
vi.mock('../hooks/useExternalInbox', () => ({
  useExternalInbox: vi.fn(),
}));
import { useExternalInbox } from '../hooks/useExternalInbox';
const mockedInbox = vi.mocked(useExternalInbox);

beforeEach(() => {
  mockedInbox.mockReturnValue({
    data: [],
  } as unknown as ReturnType<typeof useExternalInbox>);
  // Mock EventSource for useSSE
  vi.stubGlobal('EventSource', vi.fn().mockImplementation(() => ({
    onopen: null,
    onerror: null,
    onmessage: null,
    close: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
  // Mock matchMedia for sidebar
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
});

describe('MainLayout', () => {
  it('renders sidebar and outlet content', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <MainLayout />,
          children: [
            { index: true, element: <div>Page Content</div> },
          ],
        },
      ],
      { initialEntries: ['/'] },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Shipwright')).toBeInTheDocument();
    expect(screen.getByText('Page Content')).toBeInTheDocument();
  });

  it('sidebar Inbox badge count includes text_question items (AC-7)', () => {
    // One ask_tool + one text_question — the badge must count BOTH (the
    // count is `inbox.length` over the discriminated-union array; there is
    // no kind-specific filter anywhere on the path).
    const items: InboxItem[] = [
      {
        kind: 'ask_tool',
        taskId: 't-1',
        sessionUuid: 's-1',
        taskTitle: 'ask task',
        toolUseId: 'tu-1',
        toolName: 'AskUserQuestion',
        input: {},
        bestEffort: true,
      },
      {
        kind: 'text_question',
        taskId: 't-2',
        sessionUuid: 's-2',
        taskTitle: 'text task',
        questionId: 'q-1',
        questionText: 'How should I proceed?',
        bestEffort: true,
      },
    ];
    mockedInbox.mockReturnValue({
      data: items,
    } as unknown as ReturnType<typeof useExternalInbox>);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <MainLayout />,
          children: [{ index: true, element: <div>Page Content</div> }],
        },
      ],
      { initialEntries: ['/'] },
    );
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    // Badge shows "2" — both kinds counted.
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('phone: shows the top-bar hamburger and opens the overlay drawer (AC-2)', () => {
    mockViewport({ phone: true });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <MainLayout />,
          children: [{ index: true, element: <div>Page Content</div> }],
        },
      ],
      { initialEntries: ['/'] },
    );
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    // Phone top bar + hamburger present; inline sidebar is NOT in the flex flow.
    expect(screen.getByTestId('mobile-topbar')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-inline')).toBeNull();
    // Drawer starts closed.
    expect(screen.queryByTestId('mobile-nav-drawer')).toBeNull();
    // Tapping the hamburger opens the drawer.
    fireEvent.click(screen.getByTestId('mobile-nav-trigger'));
    expect(screen.getByTestId('mobile-nav-drawer')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-drawer-body')).toBeInTheDocument();
  });

  it('desktop/tablet: renders the inline sidebar, no phone top bar (up-band guard)', () => {
    mockViewport({ phone: false });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <MainLayout />,
          children: [{ index: true, element: <div>Page Content</div> }],
        },
      ],
      { initialEntries: ['/'] },
    );
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('sidebar-inline')).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-topbar')).toBeNull();
  });
});
