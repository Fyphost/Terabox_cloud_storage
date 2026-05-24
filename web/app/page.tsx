import {
  ArrowRight,
  Download,
  HardDrive,
  Layers,
  Lock,
  PlayCircle,
} from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import UrlAnalyzer from '@/components/ingest/UrlAnalyzer';

export default function LandingPage({
  searchParams,
}: {
  searchParams?: { focus?: string };
}) {
  const autoFocus = searchParams?.focus === '1';

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_40%_at_50%_0%,hsl(var(--primary)/0.10),transparent_70%)]"
        />
        <div className="container relative max-w-4xl py-14 md:py-24">
          <div className="text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-fg-soft shadow-sm">
              Cloud media · Saved permanently · Yours forever
            </span>
            <h1 className="mt-6 text-balance text-3xl font-semibold tracking-tight text-fg md:text-5xl">
              Save TeraBox media to your own cloud library.
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-balance text-sm text-muted-fg md:text-base">
              Fyphost downloads your selected qualities into permanent storage, generates
              an HLS stream you control, and serves direct MP4 downloads with the original
              filename. Saved media keeps working even if the source link disappears.
            </p>
          </div>

          <div className="mx-auto mt-8 max-w-3xl">
            <Suspense fallback={null}>
              <UrlAnalyzer autoFocus={autoFocus} />
            </Suspense>
            <p className="mt-2 text-center text-xs text-muted-fg">
              Each analyze pulls fresh upstream metadata — no stale results.
            </p>
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section className="container max-w-5xl py-14 md:py-20">
        <h2 className="text-balance text-center text-2xl font-semibold tracking-tight md:text-3xl">
          What Fyphost actually does
        </h2>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <Feature
            icon={<HardDrive className="h-5 w-5" />}
            title="Permanent storage"
            body="Each saved video lives under its own media root with metadata, thumbnail, and HLS segments — independent of the upstream extractor."
          />
          <Feature
            icon={<Layers className="h-5 w-5" />}
            title="Multi-quality variants"
            body="Save 720p today, add 1080p next week. One library entry, multiple downloadable qualities, shared metadata."
          />
          <Feature
            icon={<PlayCircle className="h-5 w-5" />}
            title="Hosted HLS playback"
            body="Adaptive bitrate streaming served from your storage. Quality switching, scrubbing, and mobile-friendly controls."
          />
          <Feature
            icon={<Download className="h-5 w-5" />}
            title="Direct MP4 downloads"
            body="Real Content-Disposition with the original filename. Range-friendly. No download buttons that aren't downloads."
          />
          <Feature
            icon={<Lock className="h-5 w-5" />}
            title="Signed access"
            body="Saved media is served via short-lived signed URLs bound to your account. Library playback never falls back to upstream."
          />
          <Feature
            icon={<ArrowRight className="h-5 w-5" />}
            title="Survives upstream churn"
            body="Once a save completes, the upstream link can rot, expire, or get pulled. Your stream and download keep working."
          />
        </div>

        <div className="mt-12 flex flex-col items-center gap-3">
          <Link
            href="/auth/signup"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-fg-soft shadow-sm hover:bg-muted"
          >
            Create a free account <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <p className="text-xs text-muted-fg">Library access requires an account.</p>
        </div>
      </section>
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-soft">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <h3 className="mt-4 text-base font-semibold text-fg">{title}</h3>
      <p className="mt-1 text-sm text-muted-fg">{body}</p>
    </div>
  );
}
