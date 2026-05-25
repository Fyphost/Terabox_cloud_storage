'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { Check, Copy, Download, Share2, Trash2 } from 'lucide-react';
import { formatBytes } from '@/lib/utils/format';
import { useDeleteFromLibrary } from '@/hooks/use-library';
import type { ApiLibraryEntry } from '@/types/api';

export default function LibraryCard({ entry }: { entry: ApiLibraryEntry }) {
  const del = useDeleteFromLibrary();
  const m = entry.media;
  const isReady = entry.state === 'COMPLETE';
  const isPending = entry.state !== 'COMPLETE' && entry.state !== 'FAILED';
  const downloadName = m.originalFilename ?? m.name;
  const shareUrl = entry.shareUrl ?? (entry.shareToken ? `/share/${entry.shareToken}` : null);

  return (
    <article className="group relative overflow-hidden rounded-xl border border-border bg-surface/40">
      <Link href={`/m/${m.id}`} className="block">
        <div className="relative aspect-video w-full bg-surface">
          {m.thumbnailUrl ? (
            <Image
              src={m.thumbnailUrl}
              alt=""
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            />
          ) : null}
          <span className="absolute right-2 top-2 inline-flex items-center rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            {entry.selectedQuality}
          </span>
          {isPending && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
              <div
                className="h-full bg-accent transition-[width]"
                style={{ width: `${Math.round(entry.progress * 100)}%` }}
              />
            </div>
          )}
        </div>
        <div className="p-3">
          <h3 className="line-clamp-2 text-sm font-medium">{m.name}</h3>
          <p className="mt-1 text-xs text-muted">
            {formatBytes(m.sourceSizeBytes ?? m.sizeBytes)} · {isReady ? 'Ready' : entry.state.toLowerCase()}
          </p>
        </div>
      </Link>

      <div className="absolute right-2 top-2 hidden flex-col items-end gap-1.5 opacity-0 transition-opacity group-hover:flex group-hover:opacity-100">
        {isReady && m.sourceDownloadUrl && (
          <a
            href={m.sourceDownloadUrl}
            download={downloadName}
            aria-label="Download"
            rel="noopener"
            className="inline-flex items-center justify-center rounded-md bg-black/60 p-1.5 text-white hover:bg-black/80"
          >
            <Download className="h-4 w-4" />
          </a>
        )}
        {isReady && shareUrl && <CopyShareButton url={shareUrl} />}
        <button
          type="button"
          aria-label="Delete from library"
          onClick={() => {
            if (confirm('Remove from library?')) del.mutate(entry.savedMediaId);
          }}
          className="inline-flex items-center justify-center rounded-md bg-black/60 p-1.5 text-white hover:bg-red-600"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}

function CopyShareButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const absolute = url.startsWith('http')
        ? url
        : typeof window !== 'undefined'
          ? `${window.location.origin}${url}`
          : url;
      await navigator.clipboard.writeText(absolute);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={copied ? 'Share link copied' : 'Copy share link'}
      className="inline-flex items-center justify-center rounded-md bg-black/60 p-1.5 text-white hover:bg-black/80"
    >
      {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
    </button>
  );
}
