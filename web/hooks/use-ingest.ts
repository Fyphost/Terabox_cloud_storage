'use client';

import { useMutation } from '@tanstack/react-query';
import { ingestUrl } from '@/lib/api/ingest';
import type { ApiMedia } from '@/types/api';

export function useIngest() {
  return useMutation<ApiMedia, Error, { url: string; forceRefresh?: boolean }>({
    mutationFn: ({ url, forceRefresh }) => ingestUrl(url, { forceRefresh }),
  });
}
