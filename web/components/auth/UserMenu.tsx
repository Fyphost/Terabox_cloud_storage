'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import Link from 'next/link';
import { LogOut, Settings, ShieldCheck, User as UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCurrentUser, useLogout, isRegistered } from '@/hooks/use-auth';
import { cn } from '@/lib/utils/cn';

function initials(input: string | null | undefined): string {
  if (!input) return 'U';
  const parts = input.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join('') || 'U';
}

export function UserMenu() {
  const { data, isLoading } = useCurrentUser();
  const logout = useLogout();
  const user = data?.user;

  if (isLoading) {
    return <div className="h-9 w-20 animate-pulse rounded-md bg-muted" aria-hidden />;
  }

  if (!isRegistered(user)) {
    return (
      <div className="flex items-center gap-1.5">
        <Button asChild variant="ghost" size="sm">
          <Link href="/auth/login">Sign in</Link>
        </Button>
        <Button asChild size="sm">
          <Link href="/auth/signup">Sign up</Link>
        </Button>
      </div>
    );
  }

  const label = user.displayName || user.email || 'Account';

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-9 items-center gap-2 rounded-full border border-border bg-surface pl-1 pr-3 text-sm font-medium text-fg shadow-sm',
            'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          aria-label="Account menu"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-primary to-blue-700 text-xs font-semibold text-white">
            {initials(user.displayName || user.email)}
          </span>
          <span className="max-w-[10rem] truncate">{label}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-[14rem] overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-elevated"
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium text-fg">{user.displayName || user.email}</p>
            {user.displayName && user.email && (
              <p className="truncate text-xs text-muted-fg">{user.email}</p>
            )}
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <Item href="/account" icon={<UserIcon className="h-4 w-4" />} label="Account" />
          <Item href="/library" icon={<Settings className="h-4 w-4" />} label="Library" />
          {user.role === 'ADMIN' && (
            <Item href="/admin" icon={<ShieldCheck className="h-4 w-4" />} label="Admin" />
          )}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            onSelect={(e) => {
              e.preventDefault();
              void logout.mutate();
            }}
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-fg outline-none data-[highlighted]:bg-muted"
          >
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Item({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <DropdownMenu.Item asChild>
      <Link
        href={href}
        className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-fg outline-none data-[highlighted]:bg-muted"
      >
        {icon} {label}
      </Link>
    </DropdownMenu.Item>
  );
}
