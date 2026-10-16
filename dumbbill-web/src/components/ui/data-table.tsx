'use client';

import {
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  tableFeatures,
  useTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { useMemo, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { ChevronDownIcon, ChevronUpIcon, ChevronsUpDownIcon } from './icons';
import { Skeleton } from './skeleton';

/**
 * A data table for lists of records (products, stock, invoices, retailers).
 *
 * The sorting engine is TanStack Table, but screens never see it: they describe columns with our own
 * `DataColumn` type below. If TanStack changes, only this file changes.
 *
 *   <DataTable
 *     caption="Products"
 *     rows={products}
 *     getRowId={(p) => p.id}
 *     columns={[
 *       { id: 'name', header: 'Product', value: (p) => p.name, sortable: true },
 *       { id: 'price', header: 'Price', value: (p) => p.pricePaise, align: 'right', mono: true,
 *         cell: (p) => <MoneyText paise={p.pricePaise} />, sortable: true },
 *     ]}
 *   />
 *
 * Built for people who work in tables all day:
 *   - compact 32 px rows by default (44 px "comfortable" for touch screens), sticky header that stays visible when scrolling
 *   - a 2px hard rule under the header, hairlines between rows, no zebra stripes
 *   - sortable columns are real buttons: Tab to them, Enter or Space to sort; the sort order is announced (aria-sort)
 *   - numbers right-aligned in a monospaced font so digits line up
 *   - loading shows placeholder rows (the table keeps its shape) and is announced as busy; an empty table shows a message
 */
export interface DataColumn<T extends object> {
  /** Unique id for the column. */
  id: string;
  /** Column title. */
  header: string;
  /** The value used for sorting (and shown, unless `cell` is given). */
  value: (row: T) => string | number | null;
  /** Custom content for the cell, for example a MoneyText or a Badge. */
  cell?: (row: T) => ReactNode;
  /** Text alignment. Right for numbers and amounts. */
  align?: 'left' | 'right' | 'center';
  /** Allow sorting by this column. */
  sortable?: boolean;
  /** Use the monospaced font (prices, SKUs, barcodes). */
  mono?: boolean;
}

export interface DataTableProps<T extends object> {
  /** What the table contains. REQUIRED: it names the table for screen readers (it is not shown on screen). */
  caption: string;
  columns: readonly DataColumn<T>[];
  rows: readonly T[];
  /** A stable unique id for each row (the record's id). */
  getRowId: (row: T) => string;
  /** Show placeholder rows instead of data. */
  loading?: boolean;
  /** Shown instead of the rows when there are none (usually an <EmptyState>). */
  empty?: ReactNode;
  density?: 'compact' | 'comfortable';
  className?: string;
}

// Table features are registered once at module level (TanStack requires stable identities).
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric },
});

const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;
const LOADING_ROWS = 5;

export function DataTable<T extends object>({
  caption,
  columns,
  rows,
  getRowId,
  loading = false,
  empty,
  density = 'compact',
  className,
}: DataTableProps<T>) {
  // Translate our column description into TanStack's. Rebuilt only when the columns change.
  const tableColumns = useMemo<ColumnDef<typeof features, T>[]>(
    () =>
      columns.map((column) => ({
        id: column.id,
        header: column.header,
        accessorFn: column.value,
        enableSorting: column.sortable ?? false,
        // TanStack sorts numbers DESCENDING on the first click. People expect "smallest first", so every column starts ascending.
        sortDescFirst: false,
      })),
    [columns],
  );

  const table = useTable({
    features,
    columns: tableColumns,
    data: rows as T[],
    getRowId: (row) => getRowId(row),
  });

  const byId = new Map(columns.map((column) => [column.id, column]));
  const rowHeight = density === 'compact' ? 'h-(--size-row-compact)' : 'h-(--size-row-comfortable)';
  const bodyRows = table.getRowModel().rows;

  return (
    <div className={cn('overflow-auto rounded-card border border-line bg-surface', className)}>
      <table className="w-full border-collapse text-small" aria-busy={loading || undefined}>
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-10 bg-surface">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} className="border-b-2 border-rule">
              {group.headers.map((header) => {
                const column = byId.get(header.column.id);
                if (!column) return null;
                const sorted = header.column.getIsSorted();
                const label = (
                  <>
                    {column.header}
                    {column.sortable &&
                      (sorted === 'asc' ? (
                        <ChevronUpIcon className="size-4" />
                      ) : sorted === 'desc' ? (
                        <ChevronDownIcon className="size-4" />
                      ) : (
                        <ChevronsUpDownIcon className="size-4 text-muted" />
                      ))}
                  </>
                );
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={
                      sorted === 'asc'
                        ? 'ascending'
                        : sorted === 'desc'
                          ? 'descending'
                          : column.sortable
                            ? 'none'
                            : undefined
                    }
                    className={cn(
                      'px-3 py-2 text-micro font-medium tracking-wider whitespace-nowrap text-muted uppercase',
                      alignClass[column.align ?? 'left'],
                    )}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-control uppercase hover:text-ink',
                          column.align === 'right' && 'flex-row-reverse',
                        )}
                      >
                        {label}
                      </button>
                    ) : (
                      label
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: LOADING_ROWS }, (_, index) => (
                <tr key={index} className={cn('border-b border-line', rowHeight)}>
                  {columns.map((column) => (
                    <td key={column.id} className="px-3">
                      <Skeleton
                        className={cn('h-4', column.align === 'right' ? 'ml-auto w-16' : 'w-3/4')}
                      />
                    </td>
                  ))}
                </tr>
              ))
            : bodyRows.map((row) => (
                <tr
                  key={row.id}
                  className={cn('border-b border-line last:border-b-0 hover:bg-hover', rowHeight)}
                >
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      className={cn(
                        'px-3',
                        alignClass[column.align ?? 'left'],
                        column.mono && 'font-mono tabular-nums',
                      )}
                    >
                      {column.cell ? column.cell(row.original) : column.value(row.original)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
      {loading && (
        <p className="sr-only" role="status">
          Loading
        </p>
      )}
      {!loading && bodyRows.length === 0 && empty && <div className="p-4">{empty}</div>}
    </div>
  );
}
