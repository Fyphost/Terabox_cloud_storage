'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown } from 'lucide-react';
import { type ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  description?: string;
  icon?: ReactNode;
}

interface Props<V extends string = string> {
  value: V;
  options: SelectOption<V>[];
  onChange: (v: V) => void;
  ariaLabel: string;
  className?: string;
  align?: 'start' | 'end';
}

export function Select<V extends string = string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  align = 'start',
}: Props<V>) {
  const current = options.find((o) => o.value === value);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            'inline-flex h-10 items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 text-sm text-fg shadow-sm',
            'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
        >
          <span className="flex items-center gap-2 truncate">
            {current?.icon}
            <span>{current?.label ?? '—'}</span>
          </span>
          <ChevronDown className="h-4 w-4 text-muted-fg" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          className="z-50 min-w-[12rem] overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-elevated"
        >
          {options.map((o) => (
            <DropdownMenu.Item
              key={o.value}
              onSelect={(e) => {
                e.preventDefault();
                onChange(o.value);
              }}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-fg outline-none',
                'data-[highlighted]:bg-muted',
              )}
            >
              <span className="flex items-center gap-2">
                {o.icon}
                <span>
                  <span className="block">{o.label}</span>
                  {o.description && <span className="block text-xs text-muted-fg">{o.description}</span>}
                </span>
              </span>
              {o.value === value && <Check className="h-4 w-4 text-primary" aria-hidden />}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
