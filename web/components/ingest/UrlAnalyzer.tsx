'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Loader2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useIngest } from '@/hooks/use-ingest';
import { ApiError } from '@/lib/api/client';
import { toast } from '@/lib/store/ui.store';

interface Props {
  /** Auto-focus the input on mount (used when arriving from `?focus=1`). */
  autoFocus?: boolean;
}

export default function UrlAnalyzer({ autoFocus = false }: Props) {
  const router = useRouter();
  const ingest = useIngest();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleaned = url.trim();
    if (!/^https?:\/\//i.test(cleaned)) {
      setError('Paste a valid TeraBox link.');
      return;
    }
    try {
      // ALWAYS ask for fresh upstream metadata. Stale cached extractor
      // results are how dead links sneak through.
      const media = await ingest.mutateAsync({ url: cleaned, forceRefresh: true });
      if (!media?.id) {
        setError('Could not analyze that link.');
        return;
      }
      router.push(`/m/${media.id}`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to analyze.';
      setError(msg);
      toast({ variant: 'error', title: 'Analyze failed', description: msg });
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-border bg-surface p-2 shadow-card md:p-3"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <Input
          ref={inputRef}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Paste a TeraBox URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-label="TeraBox URL"
          className="h-12 flex-1 border-transparent bg-transparent shadow-none text-base focus:border-transparent focus:ring-0"
        />
        <Button type="submit" size="lg" disabled={ingest.isPending} className="sm:w-auto">
          {ingest.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Wand2 className="h-4 w-4" aria-hidden />
          )}
          Analyze
        </Button>
      </div>
      {error && (
        <p
          role="alert"
          className="mt-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}
    </form>
  );
}
