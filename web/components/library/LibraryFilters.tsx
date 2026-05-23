'use client';

import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface Props {
  search: string;
  onSearchChange: (v: string) => void;
}

export default function LibraryFilters({ search, onSearchChange }: Props) {
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
        aria-hidden
      />
      <Input
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search your library"
        className="pl-9"
        aria-label="Search library"
      />
    </div>
  );
}
