'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Library } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

const tabs = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/library', label: 'Library', icon: Library },
];

export default function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="pb-safe fixed bottom-0 left-0 right-0 z-30 border-t border-border/60 bg-bg/95 backdrop-blur md:hidden">
      <ul className="grid grid-cols-2">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/' && pathname.startsWith(href));
          return (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  'flex flex-col items-center gap-0.5 py-2.5 text-xs',
                  active ? 'text-accent' : 'text-muted',
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
