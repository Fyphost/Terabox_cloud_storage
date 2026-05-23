'use client';

import { useState } from 'react';
import LibraryFilters from '@/components/library/LibraryFilters';
import LibraryGrid from '@/components/library/LibraryGrid';

export default function LibraryPage() {
  const [search, setSearch] = useState('');

  return (
    <div className="container py-6 md:py-10">
      <header className="mb-5 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold md:text-2xl">Library</h1>
        <div className="w-full max-w-xs">
          <LibraryFilters search={search} onSearchChange={setSearch} />
        </div>
      </header>
      <LibraryGrid search={search} />
    </div>
  );
}
