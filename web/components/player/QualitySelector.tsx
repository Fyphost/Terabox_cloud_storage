'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { HlsLevel } from '@/hooks/use-hls';

interface Props {
  levels: HlsLevel[];
  currentLevel: number; // -1 = auto
  onChange: (level: number) => void;
}

export default function QualitySelector({ levels, currentLevel, onChange }: Props) {
  if (levels.length <= 1) return null;
  const sorted = [...levels].sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Quality"
          className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-xs font-medium text-white/90 hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Settings2 className="h-4 w-4" aria-hidden />
          <span>
            {currentLevel === -1
              ? 'Auto'
              : (sorted.find((l) => l.index === currentLevel)?.label ?? 'Auto')}
          </span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={6}
          align="end"
          className="z-50 min-w-[10rem] overflow-hidden rounded-lg border border-white/10 bg-slate-900/95 p-1 text-white shadow-elevated backdrop-blur"
        >
          <Item label="Auto" active={currentLevel === -1} onSelect={() => onChange(-1)} />
          <DropdownMenu.Separator className="my-1 h-px bg-white/10" />
          {sorted.map((l) => (
            <Item
              key={l.index}
              label={l.label}
              active={currentLevel === l.index}
              onSelect={() => onChange(l.index)}
            />
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Item({
  label,
  active,
  onSelect,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenu.Item
      onSelect={(e) => {
        e.preventDefault();
        onSelect();
      }}
      className={cn(
        'flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-sm outline-none',
        'data-[highlighted]:bg-white/10',
      )}
    >
      <span>{label}</span>
      {active && <Check className="h-4 w-4 text-primary" aria-hidden />}
    </DropdownMenu.Item>
  );
}
