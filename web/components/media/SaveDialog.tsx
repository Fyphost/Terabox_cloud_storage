'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { useSaveQuality, useSaveStatus } from '@/hooks/use-save';
import { formatBytes } from '@/lib/utils/format';
import type { ApiMedia } from '@/types/api';

interface Props {
  media: ApiMedia;
  trigger: React.ReactNode;
}

const QUALITY_PREFERENCE = ['720p', '1080p', '480p', '360p', '1440p', '2160p'];

/**
 * Single-quality save UX.
 *
 * The previous component allowed multi-quality checkboxes, which encoded the
 * "save many qualities" architectural defect into the UI. The radio-group
 * design here makes it impossible to request more than one quality.
 *
 * After save completes, the dialog surfaces the permanent share URL with a
 * one-click copy button. The shareToken is returned by the save API.
 */
export default function SaveDialog({ media, trigger }: Props) {
  const save = useSaveQuality();

  const defaultQuality = useMemo(() => {
    const available = new Set(media.variants.map((v) => v.quality));
    for (const q of QUALITY_PREFERENCE) if (available.has(q)) return q;
    return media.variants[0]?.quality ?? '';
  }, [media.variants]);

  const [selected, setSelected] = useState<string>(defaultQuality);
  const [savedMediaId, setSavedMediaId] = useState<string | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);

  // Live job-progress polling once we have a savedMediaId.
  const status = useSaveStatus(savedMediaId);

  useEffect(() => {
    if (!selected && defaultQuality) setSelected(defaultQuality);
  }, [defaultQuality, selected]);

  const onSave = async () => {
    if (!selected) return;
    const result = await save.mutateAsync({ mediaId: media.id, quality: selected });
    setSavedMediaId(result.savedMediaId);
    setShareToken(result.shareToken);
  };

  const shareUrl = shareToken ? buildShareUrl(shareToken) : null;
  const isComplete = status.data?.state === 'COMPLETE';
  const isFailed = status.data?.state === 'FAILED';
  const progressPct = Math.round((status.data?.progress ?? 0) * 100);

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title="Save to library"
        description="Pick the quality you want to keep. The original file is downloadable from your library; the chosen quality streams instantly."
      >
        <fieldset className="flex flex-col gap-2" disabled={save.isPending || !!savedMediaId}>
          <legend className="sr-only">Pick a quality</legend>
          {media.variants.map((v) => {
            const checked = selected === v.quality;
            return (
              <label
                key={v.id}
                className={`flex cursor-pointer items-center justify-between rounded-md border border-border px-3 py-2 text-sm ${
                  checked ? 'bg-white/5' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="save-quality"
                    value={v.quality}
                    checked={checked}
                    onChange={() => setSelected(v.quality)}
                    className="h-4 w-4 accent-accent"
                  />
                  <span className="font-medium">{v.quality}</span>
                </div>
                <span className="text-xs text-muted">{formatBytes(v.sizeBytes)}</span>
              </label>
            );
          })}
        </fieldset>

        {savedMediaId ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-md border border-border bg-bg/40 p-3 text-sm">
              {isComplete ? (
                <p className="font-medium text-fg">Saved. Available in your library.</p>
              ) : isFailed ? (
                <p className="font-medium text-red-400">
                  {status.data?.error ?? 'Save failed. Please try again.'}
                </p>
              ) : (
                <>
                  <p className="font-medium">{labelForState(status.data?.state)}</p>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full bg-accent transition-[width]"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted">{progressPct}%</p>
                </>
              )}
            </div>

            {shareUrl && (
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-muted">Permanent share link</p>
                <ShareLinkCopy url={shareUrl} />
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button
              onClick={onSave}
              disabled={!selected || save.isPending}
              size="md"
            >
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function labelForState(s: string | undefined): string {
  switch (s) {
    case 'PENDING':
      return 'Queued…';
    case 'DOWNLOADING':
      return 'Downloading…';
    case 'COMPLETE':
      return 'Saved.';
    case 'FAILED':
      return 'Failed.';
    default:
      return 'Working…';
  }
}

function buildShareUrl(token: string): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}/share/${token}`;
}

function ShareLinkCopy({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore — fallback below */
    }
  };
  return (
    <div className="flex items-stretch overflow-hidden rounded-md border border-border bg-surface">
      <input
        readOnly
        value={url}
        className="flex-1 bg-transparent px-3 text-xs text-fg outline-none"
        onFocus={(e) => e.currentTarget.select()}
      />
      <button
        type="button"
        onClick={onCopy}
        aria-label="Copy share link"
        className="inline-flex items-center gap-1 border-l border-border px-3 text-xs hover:bg-white/5"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
