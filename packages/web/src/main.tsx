import '@fontsource-variable/ibm-plex-sans';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './index.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { ActivityProvider } from './components/ActivityLog.js';
import { ToastProvider } from './components/Toaster.js';

/**
 * Fonts are bundled rather than loaded from a font CDN: no third-party request
 * on page load, no layout shift when the face arrives, and the app still looks
 * right offline.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Reads are free and the list is shared, so refetching is cheap and the
      // data is worth keeping fresh. Retry once: public RPCs rate-limit, and a
      // single retry clears most of it without hammering a failing endpoint.
      staleTime: 5_000,
      retry: 1,
    },
  },
});

const container = document.getElementById('root');

if (!container) {
  throw new Error('Missing #root element in index.html');
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ActivityProvider>
          <App />
        </ActivityProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
