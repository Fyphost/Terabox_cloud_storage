'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ensureAnon } from '@/lib/api/auth';

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
        },
      }),
  );

  useEffect(() => {
    // Ensure an anonymous device-bound session exists (cookie-set by backend).
    ensureAnon().catch(() => undefined);
  }, []);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
