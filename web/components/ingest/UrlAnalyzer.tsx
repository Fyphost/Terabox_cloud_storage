'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useIngest } from '@/hooks/use-ingest';

export default function UrlAnalyzer() {
  const router = useRouter();
  const ingest = useIngest();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^https?:\/\//i.test(url.trim())) {
      setError('Paste a valid TeraBox link.');
      return;
    }
    try {
      const media = await ingest.mutateAsync(url.trim());
      router.push(`/m/${media.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze.');
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
      <Input
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder="Paste a TeraBox URL"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        aria-label="TeraBox URL"
      />
      <Button type="submit" size="lg" disabled={ingest.isPending} className="sm:w-auto">
        {ingest.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Wand2 className="h-4 w-4" aria-hidden />
        )}
        Analyze
      </Button>
      {error && (
        <p role="alert" className="text-sm text-red-400 sm:basis-full">
          {error}
        </p>
      )}
    </form>
  );
}
