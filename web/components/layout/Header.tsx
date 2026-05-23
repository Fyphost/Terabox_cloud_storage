'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Library, Sparkles } from 'lucide-react';
import { UserMenu } from '@/components/auth/UserMenu';
import { useCurrentUser, isRegistered } from '@/hooks/use-auth';
import { cn } from '@/lib/utils/cn';

export default function Header() {
  const pathname = usePathname();
  const { data } = useCurrentUser();
  const showLibrary = isRegistered(data?.user);

  return (
    <header className="sticky top-0 z-30 border-b border-border/80 bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
      <div className="container flex h-14 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-blue-700 text-white shadow-card">
            <Sparkles className="h-4 w-4" aria-hidden />
          </span>
          <span>Fyphost</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {showLibrary && (
            <NavLink href="/library" active={pathname.startsWith('/library')}>
              <Library className="h-4 w-4" aria-hidden /> Library
            </NavLink>
          )}
        </nav>

        <UserMenu />
      </div>
    </header>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active ? 'bg-muted text-fg' : 'text-muted-fg hover:bg-muted hover:text-fg',
      )}
    >
      {children}
    </Link>
  );
}
