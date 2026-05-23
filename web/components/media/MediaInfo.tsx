import Image from 'next/image';
import { formatBytes } from '@/lib/utils/format';

interface Props {
  name: string;
  sizeBytes: number | null;
  thumbnailUrl: string | null;
  qualities: string[];
}

export default function MediaInfo({ name, sizeBytes, thumbnailUrl, qualities }: Props) {
  return (
    <div className="flex gap-4">
      <div className="relative h-20 w-32 shrink-0 overflow-hidden rounded-lg bg-surface md:h-24 md:w-40">
        {thumbnailUrl ? (
          <Image
            src={thumbnailUrl}
            alt=""
            fill
            sizes="(max-width: 768px) 128px, 160px"
            className="object-cover"
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold md:text-lg">{name}</h1>
        <p className="mt-1 text-xs text-muted">{formatBytes(sizeBytes)}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {qualities.map((q) => (
            <span
              key={q}
              className="inline-flex items-center rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted"
            >
              {q}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
