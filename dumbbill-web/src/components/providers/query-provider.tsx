'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';

/**
 * Gives every screen access to TanStack Query: the library that fetches server data, caches it, and
 * keeps screens fresh without each screen writing its own loading and refresh logic.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  // Created once per browser tab (useState keeps the same instance across re-renders).
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data counts as fresh for 30 seconds: no needless refetching when moving between screens.
            staleTime: 30_000,
            // Retry reads a couple of times, but never when the server clearly said "no" (4xx):
            // asking again will not change a 404 or a validation error.
            retry: (failureCount, error) => {
              if (error instanceof ApiError && error.status >= 400 && error.status < 500)
                return false;
              return failureCount < 2;
            },
          },
          mutations: {
            // NEVER retry a write automatically. Repeating "create bill" or "take payment" could charge twice.
            // Retrying writes is a deliberate decision made per action, with an Idempotency-Key.
            retry: false,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
