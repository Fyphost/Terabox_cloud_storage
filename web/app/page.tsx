import UrlAnalyzer from '@/components/ingest/UrlAnalyzer';

export default function LandingPage() {
  return (
    <div className="container py-10 md:py-16">
      <section className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight md:text-5xl">
          Stream TeraBox media. Cleanly.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm text-muted md:text-base">
          Paste a link. Pick your quality. Watch instantly. Save what you want for later — no ads,
          no fake download buttons, no throttled cloud-host UX.
        </p>
        <div className="mt-8">
          <UrlAnalyzer />
        </div>
      </section>

      <section className="mx-auto mt-14 grid max-w-3xl gap-3 md:grid-cols-3">
        <Feature title="Instant playback" body="HLS straight to your player. No waiting, no redirects." />
        <Feature title="Pick your quality" body="Select what to stream and what to keep. We persist only what you save." />
        <Feature title="Library that lasts" body="Saved media streams from Fyphost storage — independent of upstream links." />
      </section>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface/50 p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs text-muted">{body}</p>
    </div>
  );
}
