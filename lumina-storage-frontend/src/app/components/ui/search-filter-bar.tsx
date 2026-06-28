import * as React from "react";
import { Search } from "lucide-react";
import { cn } from "./utils";
import { Input } from "./input";

interface SearchFilterBarProps {
  /** Current search input value */
  searchValue?: string;
  /** Called when the search input changes */
  onSearchChange?: (value: string) => void;
  /** Placeholder for the search input */
  searchPlaceholder?: string;
  /** Hide the search input entirely */
  hideSearch?: boolean;
  /** Filter controls rendered after the search input */
  filters?: React.ReactNode;
  /** Extra content rendered at the end (e.g. total count) */
  trailing?: React.ReactNode;
  /** Extra className on the outer wrapper */
  className?: string;
}

export function SearchFilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search...",
  hideSearch = false,
  filters,
  trailing,
  className,
}: SearchFilterBarProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm",
        className
      )}
    >
      {!hideSearch && (
        <div className="relative min-w-0 flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            type="text"
            value={searchValue ?? ""}
            onChange={(e) => onSearchChange?.(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 pl-9"
          />
        </div>
      )}
      {filters}
      {trailing && <div className="ml-auto flex items-center">{trailing}</div>}
    </div>
  );
}
