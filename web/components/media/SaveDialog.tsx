'use client';

import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { useSaveQualities } from '@/hooks/use-save';
import { formatBytes } from '@/lib/utils/format';
import type { ApiMedia } from '@/types/api';

interface Props {
  media: ApiMedia;
  trigger: React.ReactNode;
}

export default function SaveDialog({ media, trigger }: Props) {
  const save = useSaveQualities();
  const initial = useMemo(() => {
    // Default-select the highest non-PERSISTED quality.
    const v = [...media.variants].reverse().find((x) => x.state !== 'PERSISTED') ?? media.variants[0];
    return v ? new Set([v.quality]) : new Set<string>();
  }, [media.variants]);
  const [selected, setSelected] = useState<Set<string>>(initial);
  const [submitted, setSubmitted] = useState(false);

  const toggle = (quality: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(quality)) next.delete(quality);
      else next.add(quality);
      return next;
    });
  };

  const onSave = async () => {
    if (selected.size === 0) return;
    await save.mutateAsync({ mediaId: media.id, qualities: Array.from(selected) });
    setSubmitted(true);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title="Save to library"
        description="Pick the qualities you want stored permanently. Persisted variants stream from Fyphost."
      >
        <ul className="flex flex-col gap-2">
          {media.variants.map((v) => {
            const isPersisted = v.state === 'PERSISTED';
            const checked = selected.has(v.quality);
            return (
              <li key={v.id}>
                <label
                  className={`flex cursor-pointer items-center justify-between rounded-md border border-border px-3 py-2 text-sm ${
                    checked ? 'bg-white/5' : ''
                  } ${isPersisted ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={checked || isPersisted}
                      disabled={isPersisted}
                      onChange={() => toggle(v.quality)}
                      className="h-4 w-4 accent-accent"
                    />
                    <span className="font-medium">{v.quality}</span>
                    {isPersisted && (
                      <span className="text-xs text-muted">already saved</span>
                    )}
                  </div>
                  <span className="text-xs text-muted">{formatBytes(v.sizeBytes)}</span>
                </label>
              </li>
            );
          })}
        </ul>

        <div className="mt-4 flex items-center justify-end gap-2">
          {submitted && !save.isPending && (
            <p className="mr-auto text-xs text-muted">Queued. Check your library.</p>
          )}
          <Button
            onClick={onSave}
            disabled={selected.size === 0 || save.isPending}
            size="md"
          >
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save {selected.size > 0 ? `(${selected.size})` : ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
