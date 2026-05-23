'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, Link2, Share2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/store/ui.store';

interface Props {
  shareUrl: string;
  title: string;
}

export default function ShareMenu({ shareUrl, title }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast({ variant: 'success', title: 'Link copied' });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ variant: 'error', title: 'Could not copy' });
    }
  };

  const nativeShare = async () => {
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share({ title, url: shareUrl });
      } catch {
        /* user cancelled */
      }
    } else {
      void copy();
    }
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="secondary" size="md">
          <Share2 className="h-4 w-4" aria-hidden /> Share
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-[14rem] overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-elevated"
        >
          <DropdownMenu.Item
            onSelect={(e) => {
              e.preventDefault();
              void copy();
            }}
            className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-muted"
          >
            <span className="flex items-center gap-2">
              <Link2 className="h-4 w-4" aria-hidden /> Copy link
            </span>
            {copied && <Check className="h-4 w-4 text-success" aria-hidden />}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={(e) => {
              e.preventDefault();
              void nativeShare();
            }}
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-muted"
          >
            <Share2 className="h-4 w-4" aria-hidden /> System share…
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
