'use client';

import { Loader2, Lock } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { useCurrentUser, isRegistered } from '@/hooks/use-auth';
import { useSaveQualities } from '@/hooks/use-save';
import { ApiError } from '@/lib/api/client';
import { toast, useUIStore } from '@/lib/store/ui.store';
import { formatBytes } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import type { ApiMedia } from '@/types/api';

interface Props {
  media: ApiMedia;
  trigger: React.ReactNode;
}

export default function SaveDialog({ media, trigger }: Props) {
  const { data: me } = useCurrentUser();
  const openLogin = useUIStore((s) => s.openLoginModal);
  const save = useSaveQualities();

  const [open, setOpen] = useState(false);

  const initial = useMemo(() => {
    const v =
      [...media.variants].reverse().find((x) => x.state !== 'PERSISTED') ?? media.variants[0];
    return v ? new Set([v.quality]) : new Set<string>();
  }, [media.variants]);
  const [selected, setSelected] = useState<Set<string>>(initial);

  const handleTriggerClick = (e: React.MouseEvent) => {
    if (!isRegistered(me?.user)) {
      e.preventDefault();
      openLogin(`/m/${media.id}`);
      return;
    }
    setOpen(true);
  };

  const toggle = (quality: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(quality)) next.delete(quality);
      else next.add(quality);
      return next;
    });

  const onSubmit = async () => {
    if (selected.size === 0) return;
    try {
      const result = await save.mutateAsync({ mediaId: media.id, qualities: Array.from(selected) });
      const total = result.jobs.length;
      const completed = result.jobs.filter((j) => j.state === 'COMPLETE').length;
      toast({
        variant: 'success',
        title: 'Save started',
        description:
          completed === total
            ? 'All selected qualities are already in your library.'
            : `Queued ${total - completed} variant${total - completed === 1 ? '' : 's'}. Check your library for progress.`,
      });
      setOpen(false);
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Save failed',
        description: err instanceof ApiError ? err.message : 'Try again.',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <span onClick={handleTriggerClick} className="contents">
        {trigger}
      </span>
      <DialogContent
        title="Save to library"
        description="Pick the qualities to keep in Fyphost storage. Saved media streams without ads."
      >
        <ul className="flex flex-col gap-2">
          {media.variants.map((v) => {
            const isPersisted = v.state === 'PERSISTED';
            const checked = selected.has(v.quality) || isPersisted;
            return (
              <li key={v.id}>
                <label
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 transition-colors',
                    isPersisted
                      ? 'border-success/40 bg-success/5 cursor-default'
                      : checked
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-muted',
                  )}
                >
                  <span className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isPersisted}
                      onChange={() => toggle(v.quality)}
                      className="h-4 w-4 accent-primary"
                    />
                    <span>
                      <span className="block text-sm font-medium text-fg">{v.quality}</span>
                      {v.width && v.height && (
                        <span className="block text-xs text-muted-fg">
                          {v.width}×{v.height}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-sm tabular-nums text-fg-soft">
                      {formatBytes(v.sizeBytes)}
                    </span>
                    {isPersisted && (
                      <span className="block text-[10px] font-medium uppercase tracking-wide text-success">
                        in library
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        <div className="mt-5 flex items-center justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost" size="md">
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={onSubmit} size="md" disabled={selected.size === 0 || save.isPending}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save {selected.size > 0 ? `(${selected.size})` : ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SaveLoginGate({ media }: { media: ApiMedia }) {
  const openLogin = useUIStore((s) => s.openLoginModal);
  return (
    <Button variant="primary" size="md" onClick={() => openLogin(`/m/${media.id}`)}>
      <Lock className="h-4 w-4" aria-hidden /> Sign in to save
    </Button>
  );
}
