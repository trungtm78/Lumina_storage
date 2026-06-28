import { cn } from "./utils";

interface PaginationBarProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  className?: string;
}

/**
 * Build a list of page numbers to display.
 * Always shows first, last, current, and neighbors with "…" gaps.
 */
function getPageNumbers(page: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages: (number | "…")[] = [1];

  if (page > 3) pages.push("…");

  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  for (let i = start; i <= end; i++) pages.push(i);

  if (page < totalPages - 2) pages.push("…");

  pages.push(totalPages);
  return pages;
}

export function PaginationBar({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
  className,
}: PaginationBarProps) {
  if (total === 0) return null;

  const from = Math.min((page - 1) * pageSize + 1, total);
  const to = Math.min(page * pageSize, total);
  const pageNumbers = getPageNumbers(page, totalPages);

  return (
    <div
      className={cn("flex items-center justify-between px-6 py-3", className)}
    >
      {/* Left: showing info */}
      <span className="text-sm text-gray-500">
        {total === 0 ? (
          "No results"
        ) : (
          <>
            Showing <span className="font-medium text-gray-700">{from}</span>–
            <span className="font-medium text-gray-700">{to}</span> of{" "}
            <span className="font-medium text-gray-700">{total}</span>
          </>
        )}
      </span>

      {/* Right: pagination controls */}
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          {/* Prev */}
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="flex h-8 items-center rounded-lg border border-gray-200 px-3 text-sm text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Prev
          </button>

          {/* Page numbers */}
          {pageNumbers.map((p, i) =>
            p === "…" ? (
              <span
                key={`ellipsis-${i}`}
                className="flex h-8 w-8 items-center justify-center text-sm text-gray-400"
              >
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg text-sm font-medium transition-colors",
                  p === page
                    ? "bg-gray-900 text-white"
                    : "border border-gray-200 text-gray-600 hover:bg-gray-50"
                )}
              >
                {p}
              </button>
            )
          )}

          {/* Next */}
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="flex h-8 items-center rounded-lg border border-gray-200 px-3 text-sm text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
