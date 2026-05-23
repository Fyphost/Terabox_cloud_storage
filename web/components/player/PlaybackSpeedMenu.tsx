'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, Gauge } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

const SPEEDS: number[] = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

interface Props {
  current: number;
  onChange: (rate: number) => void;
}

export default function PlaybackSpeedMenu({ current, onChange }: Props) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Playback speed"
          className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-xs font-medium text-white/90 hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Gauge className="h-4 w-4" aria-hidden />
          <span>{current === 1 ? '1×' : `${current}×`}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={6}
          align="end"
          className="z-50 min-w-[7rem] overflow-hidden rounded-lg border border-white/10 bg-slate-900/95 p-1 text-white shadow-elevated backdrop-blur"
        >
          {SPEEDS.map((s) => (
            <DropdownMenu.Item
              key={s}
              onSelect={(e) => {
                e.preventDefault();
                onChange(s);
              }}
              className={cn(
                'flex cursor-pointer items-center justify-between rounded-md px-3 py-1.5 text-sm outline-none',
                'data-[highlighted]:bg-white/10',
              )}
            >
              <span>{s === 1 ? 'Normal' : `${s}×`}</span>
              {current === s && <Check className="h-4 w-4 text-primary" aria-hidden />}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
