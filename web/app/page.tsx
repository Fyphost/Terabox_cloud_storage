import { ArrowRight, Bookmark, PlayCircle, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import UrlAnalyzer from '@/components/ingest/UrlAnalyzer';

export default function LandingPage() {
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
              <span className="h-1.5 w-1.5 rounded-full bg-success" /> No ads · No fake buttons · No throttle
            </span>
            <h1 className="mt-6 text-balance text-3xl font-semibold tracking-tight text-fg md:text-5xl">
              Stream TeraBox media. Cleanly.
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-balance text-sm text-muted-fg md:text-base">
              Paste a link. Pick your quality. Watch instantly. Save what you want for later — saved
              media streams from Fyphost storage and never depends on the original link.
            </p>
          </div>

          <div className="mx-auto mt-8 max-w-3xl">
            <UrlAnalyzer />
            <p className="mt-2 text-center text-xs text-muted-fg">
              Try a 1024terabox.com URL. Streaming starts in seconds.
            </p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="container max-w-5xl py-14 md:py-20">
        <h2 className="text-balance text-center text-2xl font-semibold tracking-tight md:text-3xl">
          Built for streaming, not for ads
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-muted-fg md:text-base">
          Fyphost replaces the painful download-host UX with a clean, mobile-first player and a
          library that lasts.
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <Feature
            icon={<PlayCircle className="h-5 w-5" />}
            title="Instant playback"
            body="HLS straight to your player. No redirects, no fake download buttons."
          />
          <Feature
            icon={<Bookmark className="h-5 w-5" />}
            title="Save your way"
            body="Pick the qualities to keep. We persist only what you save."
          />
          <Feature
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Library that lasts"
            body="Saved media streams from Fyphost storage — independent of upstream links."
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
