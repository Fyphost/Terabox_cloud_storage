import Link from 'next/link';
import { Library, Sparkles } from 'lucide-react';

export default function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-bg/80 backdrop-blur supports-[backdrop-filter]:bg-bg/60">
      <div className="container flex h-14 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <Sparkles className="h-5 w-5 text-accent" aria-hidden />
          <span>Fyphost</span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          <Link
            href="/library"
            className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted hover:bg-surface hover:text-fg"
          >
            <Library className="h-4 w-4" aria-hidden /> Library
          </Link>
        </nav>
      </div>
    </header>
  );
}
