'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Library, User } from 'lucide-react';
import { useCurrentUser, isRegistered } from '@/hooks/use-auth';
import { cn } from '@/lib/utils/cn';

export default function MobileNav() {
  const pathname = usePathname();
  const { data } = useCurrentUser();
  const registered = isRegistered(data?.user);

  const tabs = registered
    ? [
        { href: '/', label: 'Home', icon: Home },
        { href: '/library', label: 'Library', icon: Library },
        { href: '/account', label: 'Account', icon: User },
      ]
    : [
        { href: '/', label: 'Home', icon: Home },
        { href: '/auth/login', label: 'Sign in', icon: User },
      ];

  return (
    <nav className="pb-safe fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-bg/95 backdrop-blur md:hidden">
      <ul className={cn('grid', `grid-cols-${tabs.length}`)} style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0,1fr))` }}>
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  'flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors',
                  active ? 'text-primary' : 'text-muted-fg',
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
