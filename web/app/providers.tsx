'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ensureAnon } from '@/lib/api/auth';
import { Toaster } from '@/components/ui/toast';
import { LoginModal } from '@/components/auth/LoginModal';

export default function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
          mutations: { retry: 0 },
        },
      }),
  );

  useEffect(() => {
    // Ensure an anonymous device-bound session exists for ingest/streaming
    // before the user has signed up. This sets a short-lived access cookie.
    void ensureAnon().catch(() => undefined);
  }, []);

  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster />
      <LoginModal />
    </QueryClientProvider>
  );
}
