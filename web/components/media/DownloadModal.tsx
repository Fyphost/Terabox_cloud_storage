'use client';

import { Download, FileVideo } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogClose } from '@/components/ui/dialog';
import { formatBytes } from '@/lib/utils/format';
import type { ApiMedia, ApiVariant } from '@/types/api';
import { cn } from '@/lib/utils/cn';

interface Props {
  media: ApiMedia;
  trigger: React.ReactNode;
}

const QUALITY_BANDWIDTH: Record<string, number> = {
  '240p': 300_000,
  '360p': 500_000,
  '480p': 900_000,
  '720p': 2_000_000,
  '1080p': 4_500_000,
  '1440p': 8_000_000,
  '2160p': 16_000_000,
};

function pickDefaultVariant(variants: ApiVariant[]): ApiVariant | null {
  // Prefer 720p, fall back to highest available.
  const seven = variants.find((v) => v.quality === '720p');
  if (seven) return seven;
  return variants[variants.length - 1] ?? null;
}

function fmtBitrate(bps: number | null | undefined, fallbackQuality: string): string {
  const v = bps ?? QUALITY_BANDWIDTH[fallbackQuality] ?? null;
  if (!v) return '—';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} Mbps`;
  return `${Math.round(v / 1000)} kbps`;
}

function estimateBytes(v: ApiVariant, fallbackDurationSec: number | null): number | null {
  if (v.sizeBytes && v.sizeBytes > 0) return v.sizeBytes;
  const bps = v.bitrateBps ?? QUALITY_BANDWIDTH[v.quality];
  if (bps && fallbackDurationSec) return Math.round((bps * fallbackDurationSec) / 8);
  return null;
}

export default function DownloadModal({ media, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const sortedVariants = useMemo(
    () => [...media.variants].sort((a, b) => (b.height ?? 0) - (a.height ?? 0)),
    [media.variants],
  );
  const [selected, setSelected] = useState<string>(() => pickDefaultVariant(sortedVariants)?.id ?? '');

  const variant = sortedVariants.find((v) => v.id === selected) ?? sortedVariants[0];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <span onClick={() => setOpen(true)} className="contents">
        {trigger}
      </span>
      <DialogContent
        title="Download"
        description="Pick a quality. The file keeps its original name."
        size="md"
      >
        <ul className="flex flex-col gap-2">
          {sortedVariants.map((v) => {
            const active = selected === v.id;
            const bytes = estimateBytes(v, media.durationSec);
            return (
              <li key={v.id}>
                <label
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 transition-colors',
                    active ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <input
                      type="radio"
                      name="dl-quality"
                      checked={active}
                      onChange={() => setSelected(v.id)}
                      className="h-4 w-4 accent-primary"
                    />
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-fg">
                      <FileVideo className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-fg">
                        {v.quality}
                        {v.width && v.height ? (
                          <span className="ml-2 text-xs font-normal text-muted-fg">
                            {v.width}×{v.height}
                          </span>
                        ) : null}
                      </span>
                      <span className="block text-xs text-muted-fg">
                        {v.container} · {fmtBitrate(v.bitrateBps, v.quality)}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-sm tabular-nums">
                    <span className={cn('block font-medium', active ? 'text-primary' : 'text-fg')}>
                      {bytes != null ? formatBytes(bytes) : '—'}
                    </span>
                    {!v.sizeBytes && bytes != null && (
                      <span className="block text-[10px] uppercase tracking-wide text-muted-fg">est.</span>
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
          <Button asChild size="md" disabled={!variant}>
            <a
              href={variant?.downloadUrl ?? '#'}
              rel="noopener"
              onClick={() => setOpen(false)}
            >
              <Download className="h-4 w-4" aria-hidden /> Download
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
