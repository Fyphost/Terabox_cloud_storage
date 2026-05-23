'use client';

import { Grid3x3, List, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import { cn } from '@/lib/utils/cn';
import type { LibrarySort } from '@/lib/api/library';

export type LibraryView = 'grid' | 'list';

interface Props {
  search: string;
  onSearchChange: (v: string) => void;
  view: LibraryView;
  onViewChange: (v: LibraryView) => void;
  sort: LibrarySort;
  onSortChange: (v: LibrarySort) => void;
  selectedCount: number;
  onClearSelection: () => void;
  onBulkDelete: () => void;
  bulkDeleting?: boolean;
}

const SORT_OPTIONS: SelectOption<LibrarySort>[] = [
  { value: 'recent', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'size', label: 'Largest first' },
];

export default function LibraryToolbar(props: Props) {
  const { search, onSearchChange, view, onViewChange, sort, onSortChange } = props;

  if (props.selectedCount > 0) {
    return (
      <div className="sticky top-14 z-20 -mx-4 mb-4 border-b border-border bg-bg/85 px-4 py-3 backdrop-blur md:mx-0 md:rounded-xl md:border md:bg-surface md:shadow-card">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-fg">
              {props.selectedCount} selected
            </span>
            <Button size="sm" variant="ghost" onClick={props.onClearSelection}>
              Clear
            </Button>
          </div>
          <Button
            size="sm"
            variant="danger"
            onClick={props.onBulkDelete}
            disabled={props.bulkDeleting}
          >
            <Trash2 className="h-4 w-4" aria-hidden /> Delete
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative flex-1 sm:max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-fg"
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

      <div className="flex items-center gap-2">
        <Select<LibrarySort>
          value={sort}
          options={SORT_OPTIONS}
          onChange={onSortChange}
          ariaLabel="Sort"
          align="end"
          className="min-w-[10rem]"
        />
        <div
          role="radiogroup"
          aria-label="View"
          className="inline-flex items-center rounded-md border border-border bg-surface p-0.5 shadow-sm"
        >
          <ViewButton active={view === 'grid'} onClick={() => onViewChange('grid')} label="Grid view">
            <Grid3x3 className="h-4 w-4" aria-hidden />
          </ViewButton>
          <ViewButton active={view === 'list'} onClick={() => onViewChange('list')} label="List view">
            <List className="h-4 w-4" aria-hidden />
          </ViewButton>
        </div>
      </div>
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded text-muted-fg transition-colors',
        active && 'bg-muted text-fg',
      )}
    >
      {children}
    </button>
  );
}
