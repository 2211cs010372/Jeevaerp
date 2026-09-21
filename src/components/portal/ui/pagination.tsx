"use client";

import { Icon } from "@/components/portal/ui/icons";

export interface PaginationProps {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  itemLabel?: string;
}

export function Pagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 15, 25, 50, 100],
  itemLabel = "items",
}: PaginationProps) {
  if (totalItems === 0) return null;

  const startItem = (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, totalItems);

  // Generate array of page numbers to render
  const pages: (number | "...")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("...");

    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);
    for (let i = start; i <= end; i++) pages.push(i);

    if (page < totalPages - 2) pages.push("...");
    pages.push(totalPages);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--p-border)] bg-[var(--p-bg)] px-6 py-3 text-[12.5px] text-[var(--p-muted)]">
      <div className="flex flex-wrap items-center gap-3">
        <span>
          Showing <strong className="font-semibold text-[var(--p-ink)]">{startItem}</strong>–
          <strong className="font-semibold text-[var(--p-ink)]">{endItem}</strong> of{" "}
          <strong className="font-semibold text-[var(--p-ink)]">{totalItems}</strong> {itemLabel}
        </span>

        {onPageSizeChange && (
          <div className="flex items-center gap-1.5 pl-2">
            <span className="text-[11.5px] text-[var(--p-muted)]">Per page:</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="rounded-md border border-[var(--p-border)] bg-white px-2 py-0.5 text-[12px] font-medium text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]"
            >
              {pageSizeOptions.map((sz) => (
                <option key={sz} value={sz}>
                  {sz}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--p-border)] bg-white px-2.5 py-1 text-[12px] font-medium text-[var(--p-ink)] transition-colors hover:border-[var(--p-teal)] disabled:opacity-40 disabled:hover:border-[var(--p-border)]"
        >
          <Icon name="chevron" size={12} className="rotate-180" /> Prev
        </button>

        {pages.map((p, idx) =>
          p === "..." ? (
            <span key={`dots-${idx}`} className="px-1.5 text-[12px] text-[var(--p-muted)]">
              …
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`min-w-[28px] rounded-md px-2 py-1 text-[12px] font-medium transition-colors ${
                p === page
                  ? "bg-[var(--p-teal)] font-semibold text-white"
                  : "border border-[var(--p-border)] bg-white text-[var(--p-ink)] hover:border-[var(--p-teal)]"
              }`}
            >
              {p}
            </button>
          ),
        )}

        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--p-border)] bg-white px-2.5 py-1 text-[12px] font-medium text-[var(--p-ink)] transition-colors hover:border-[var(--p-teal)] disabled:opacity-40 disabled:hover:border-[var(--p-border)]"
        >
          Next <Icon name="chevron" size={12} />
        </button>
      </div>
    </div>
  );
}
