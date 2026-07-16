import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// Self-hosted variable faces (A05, FR-01.48). Inter (sans) + Geist Mono (data).
// Replaces the Google-Fonts CDN <link> in index.html: a CDN font (a) silently
// degrades to Consolas/system when this local-first tool is offline and (b)
// renders as a FALLBACK inside A00's network-isolated Playwright baseline
// container while rendering the real face on the dev box — permanently
// unstable baselines. Self-hosting is what makes the visual gate trustworthy.
// Imported before index.css so the @font-face rules are registered first.
import '@fontsource-variable/inter';
import '@fontsource-variable/geist-mono';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
