'use client';

import { useQuery } from '@tanstack/react-query';
import { getMedia } from '@/lib/api/media';

export function useMedia(id: string | null | undefined) {
  return useQuery({
    queryKey: ['media', id],
    queryFn: ({ signal }) => getMedia(id!, signal),
    enabled: !!id,
  });
}
