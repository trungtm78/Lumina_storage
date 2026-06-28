import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "./utils";

/* ── Color palette ─────────────────────────────────────────── */

export type TableColor =
  | "gray"
  | "red"
  | "green"
  | "blue"
  | "yellow"
  | "purple"
  | "brand"
  | "pink"
  | "orange";

const COLOR_MAP: Record<TableColor, string> = {
  gray: "bg-gray-100 text-gray-600",
  red: "bg-red-100 text-red-700",
  green: "bg-green-100 text-green-700",
  blue: "bg-blue-100 text-blue-700",
  yellow: "bg-yellow-100 text-yellow-700",
  purple: "bg-purple-100 text-purple-700",
  brand: "bg-brand-100 text-brand-700",
  pink: "bg-pink-100 text-pink-700",
  orange: "bg-orange-100 text-orange-700",
};

/* ── Column types ──────────────────────────────────────────── */

export type ColumnType =
  | "text"
  | "number"
  | "status"
  | "tag_one"
  | "tag_multiple"
  | "time"
  | "stt"
  | "link"
  | "checkbox";

/**
 * Alignment rules by type:
 * - right:  "number", "time"
 * - center: "status", "tag_one", "stt"
 * - left:   everything else ("text", "tag_multiple", "link", custom)
 */
function alignmentForType(type?: ColumnType): "left" | "center" | "right" {
  if (!type) return "left";
  if (type === "number" || type === "time") return "right";
  if (
    type === "status" ||
    type === "tag_one" ||
    type === "stt" ||
    type === "checkbox"
  )
    return "center";
  return "left";
}

const ALIGN_CLASSES = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
} as const;

/* ── Tag item shape ────────────────────────────────────────── */

export interface TagItem {
  label: string;
  color?: TableColor;
  icon?: React.ComponentType<{ className?: string }>;
}

/* ── Column definition ─────────────────────────────────────── */

/**
 * A column can use **either** `type` + `field` (declarative) **or** `render` (custom).
 * When `render` is provided it always wins.
 */
export interface DataTableColumn<T> {
  /** Unique key */
  key: string;
  /** Header label */
  header: React.ReactNode;

  /* ── Type-based rendering ────────────────────────────────── */

  /** Column type — controls alignment & built-in cell rendering */
  type?: ColumnType;
  /** Data accessor: string key of T, or function returning the value */
  field?: keyof T | ((row: T, index: number) => unknown);

  /* ── Style options ───────────────────────────────────────── */

  minWidth?: number;
  maxWidth?: number;
  /** Truncate width in px — enables ellipsis and shows full text as title on hover */
  truncate?: number;
  /** Offset added to "stt" row number (e.g. (page-1)*pageSize for correct numbering across pages) */
  sttOffset?: number;
  /** Render text in font-semibold */
  semiBold?: boolean;
  /** Static color for status / tag_one */
  color?: TableColor;
  /** Dynamic color resolver per row (overrides `color`) */
  colorField?: (row: T) => TableColor;
  /** Icon rendered inside tag_one badge */
  icon?: React.ComponentType<{ className?: string }>;
  /** URL builder for "link" type */
  urlLink?: (row: T) => string;
  /** Tag mapper for "tag_multiple" — converts row value to TagItem[] */
  tagMapper?: (row: T) => TagItem[];

  /* ── Custom render (overrides type) ──────────────────────── */

  render?: (row: T, index: number) => React.ReactNode;

  /* ── Layout ──────────────────────────────────────────────── */

  /** Extra className for <th> */
  headerClassName?: string;
  /** Extra className for <td> */
  cellClassName?: string;
  /** Hide on mobile, show from md: */
  hiddenOnMobile?: boolean;
}

/* ── Built-in cell renderer ────────────────────────────────── */

function renderTypedCell<T>(
  col: DataTableColumn<T>,
  row: T,
  index: number
): React.ReactNode {
  // Custom render always wins
  if (col.render) return col.render(row, index);

  // Resolve the raw value
  const raw =
    typeof col.field === "function"
      ? col.field(row, index)
      : col.field != null
        ? (row as Record<string, unknown>)[col.field as string]
        : undefined;

  const resolvedColor = col.colorField ? col.colorField(row) : col.color;

  switch (col.type) {
    /* ── stt (row number) ─────────────────────────────────── */
    case "stt":
      return (
        <span className="text-sm text-gray-500">
          {(col.sttOffset ?? 0) + index + 1}
        </span>
      );

    /* ── number ───────────────────────────────────────────── */
    case "number":
      return (
        <span
          className={cn(
            "text-sm text-gray-900 tabular-nums",
            col.semiBold && "font-semibold"
          )}
        >
          {raw != null ? String(raw) : "—"}
        </span>
      );

    /* ── time ─────────────────────────────────────────────── */
    case "time":
      return (
        <span className="text-sm text-gray-500 tabular-nums">
          {raw != null ? String(raw) : "—"}
        </span>
      );

    /* ── status badge ─────────────────────────────────────── */
    case "status": {
      const label = raw != null ? String(raw) : "—";
      const colorCls = resolvedColor
        ? COLOR_MAP[resolvedColor]
        : COLOR_MAP.gray;
      return (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
            colorCls
          )}
        >
          {col.icon && React.createElement(col.icon, { className: "h-3 w-3" })}
          {label}
        </span>
      );
    }

    /* ── tag_one ──────────────────────────────────────────── */
    case "tag_one": {
      const label = raw != null ? String(raw) : "—";
      const colorCls = resolvedColor
        ? COLOR_MAP[resolvedColor]
        : COLOR_MAP.gray;
      return (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
            colorCls
          )}
        >
          {col.icon && React.createElement(col.icon, { className: "h-3 w-3" })}
          {label}
        </span>
      );
    }

    /* ── tag_multiple ─────────────────────────────────────── */
    case "tag_multiple": {
      const tags = col.tagMapper ? col.tagMapper(row) : [];
      if (tags.length === 0) {
        return <span className="text-sm text-gray-400">—</span>;
      }
      return (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag, i) => {
            const tagColor = tag.color ? COLOR_MAP[tag.color] : COLOR_MAP.gray;
            return (
              <span
                key={i}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                  tagColor
                )}
              >
                {tag.icon &&
                  React.createElement(tag.icon, {
                    className: "h-2.5 w-2.5",
                  })}
                {tag.label}
              </span>
            );
          })}
        </div>
      );
    }

    /* ── link ─────────────────────────────────────────────── */
    case "link": {
      const label = raw != null ? String(raw) : "—";
      const href = col.urlLink ? col.urlLink(row) : "#";
      return (
        <a
          href={href}
          title={col.truncate ? label : undefined}
          className={cn(
            "text-brand-600 text-sm hover:underline",
            col.semiBold && "font-semibold",
            col.truncate && "block truncate"
          )}
          style={col.truncate ? { maxWidth: col.truncate } : undefined}
          onClick={(e) => e.stopPropagation()}
        >
          {label}
        </a>
      );
    }

    /* ── text (default) ───────────────────────────────────── */
    case "text":
    default: {
      const label = raw != null ? String(raw) : "—";
      return (
        <span
          title={col.truncate ? label : undefined}
          className={cn(
            "text-sm text-gray-900",
            col.semiBold && "font-semibold",
            col.truncate && "block truncate"
          )}
          style={col.truncate ? { maxWidth: col.truncate } : undefined}
        >
          {label}
        </span>
      );
    }
  }
}

/* ── Component props ───────────────────────────────────────── */

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: (row: T, index: number) => string;
  isLoading?: boolean;
  emptyMessage?: React.ReactNode;
  colSpan?: number;
  className?: string;
  rowClassName?: string | ((row: T, index: number) => string);
  onRowClick?: (row: T, index: number) => void;
  footer?: React.ReactNode;
  /** Set of selected row keys (controlled). Required when using checkbox columns. */
  selectedKeys?: Set<string>;
  /** Called when selection changes. Receives the new Set of selected keys. */
  onSelectedKeysChange?: (keys: Set<string>) => void;
  /** Return true to disable the checkbox for a specific row */
  isRowDisabled?: (row: T) => boolean;
  /**
   * Override the header checkbox "all selected" state with global knowledge.
   * - `true`: header checkbox is fully checked (all items globally selected)
   * - `false`: header checkbox is indeterminate if any page items are selected
   * - `undefined` (default): auto-detect from current page's selectedKeys
   */
  isAllSelectedOverride?: boolean;
}

/* ── Component ─────────────────────────────────────────────── */

export function DataTable<T>({
  columns,
  data,
  rowKey,
  isLoading = false,
  emptyMessage = "No data found",
  colSpan,
  className,
  rowClassName,
  onRowClick,
  footer,
  selectedKeys,
  onSelectedKeysChange,
  isRowDisabled,
  isAllSelectedOverride,
}: DataTableProps<T>) {
  const spanCount = colSpan ?? columns.length;

  /* ── Checkbox helpers ──────────────────────────────────────── */

  const hasCheckboxColumn = columns.some((c) => c.type === "checkbox");

  const selectableKeys = React.useMemo(() => {
    if (!hasCheckboxColumn) return [];
    return data
      .map((row, idx) => ({ key: rowKey(row, idx), row }))
      .filter(({ row }) => !isRowDisabled?.(row))
      .map(({ key }) => key);
  }, [data, hasCheckboxColumn, rowKey, isRowDisabled]);

  const isAllPageSelected =
    hasCheckboxColumn &&
    selectableKeys.length > 0 &&
    selectedKeys != null &&
    selectableKeys.every((k) => selectedKeys.has(k));

  // Use override when provided, otherwise fall back to page-level detection
  const isAllSelected =
    isAllSelectedOverride !== undefined
      ? isAllSelectedOverride
      : isAllPageSelected;

  const isSomeSelected =
    hasCheckboxColumn &&
    !isAllSelected &&
    selectedKeys != null &&
    selectableKeys.some((k) => selectedKeys.has(k));

  const handleSelectAll = React.useCallback(() => {
    if (!onSelectedKeysChange || !selectedKeys) return;
    const next = new Set(selectedKeys);
    // Use page-level state (not override) to decide toggle direction:
    // if all page items are selected → deselect them, otherwise → select them
    if (isAllPageSelected) {
      selectableKeys.forEach((k) => next.delete(k));
    } else {
      selectableKeys.forEach((k) => next.add(k));
    }
    onSelectedKeysChange(next);
  }, [onSelectedKeysChange, selectedKeys, isAllPageSelected, selectableKeys]);

  const handleRowSelect = React.useCallback(
    (key: string) => {
      if (!onSelectedKeysChange || !selectedKeys) return;
      const next = new Set(selectedKeys);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      onSelectedKeysChange(next);
    },
    [onSelectedKeysChange, selectedKeys]
  );

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm",
        className
      )}
    >
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              {columns.map((col) => {
                const align = alignmentForType(col.type);
                return (
                  <th
                    key={col.key}
                    className={cn(
                      "px-6 py-4 text-xs font-semibold tracking-wide text-gray-600 uppercase",
                      ALIGN_CLASSES[align],
                      col.hiddenOnMobile && "hidden md:table-cell",
                      col.headerClassName
                    )}
                    style={{
                      minWidth: col.minWidth,
                      maxWidth: col.maxWidth,
                    }}
                  >
                    {col.type === "checkbox" ? (
                      <div className="flex items-center justify-center">
                        <input
                          type="checkbox"
                          className="accent-brand-500 h-4 w-4 cursor-pointer"
                          checked={isAllSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = !!isSomeSelected;
                          }}
                          onChange={handleSelectAll}
                          disabled={data.length === 0}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {isLoading ? (
              <tr>
                <td colSpan={spanCount} className="px-6 py-10 text-center">
                  <Loader2 className="text-brand-500 mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td
                  colSpan={spanCount}
                  className="px-6 py-10 text-center text-sm text-gray-500"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((row, idx) => {
                const rClassName =
                  typeof rowClassName === "function"
                    ? rowClassName(row, idx)
                    : rowClassName;
                return (
                  <tr
                    key={rowKey(row, idx)}
                    onClick={
                      onRowClick ? () => onRowClick(row, idx) : undefined
                    }
                    className={cn(
                      "transition-colors hover:bg-gray-50",
                      onRowClick && "cursor-pointer",
                      rClassName
                    )}
                  >
                    {columns.map((col) => {
                      const align = alignmentForType(col.type);
                      return (
                        <td
                          key={col.key}
                          className={cn(
                            "px-6 py-4",
                            ALIGN_CLASSES[align],
                            col.hiddenOnMobile && "hidden md:table-cell",
                            col.cellClassName
                          )}
                          style={{
                            minWidth: col.minWidth,
                            maxWidth: col.maxWidth,
                          }}
                        >
                          {col.type === "checkbox" ? (
                            <div className="flex items-center justify-center">
                              <input
                                type="checkbox"
                                className={cn(
                                  "accent-brand-500 h-4 w-4",
                                  isRowDisabled?.(row)
                                    ? "cursor-not-allowed opacity-50"
                                    : "cursor-pointer"
                                )}
                                checked={
                                  selectedKeys?.has(rowKey(row, idx)) ?? false
                                }
                                onChange={(e) => {
                                  e.stopPropagation();
                                  handleRowSelect(rowKey(row, idx));
                                }}
                                onClick={(e) => e.stopPropagation()}
                                disabled={isRowDisabled?.(row)}
                              />
                            </div>
                          ) : (
                            renderTypedCell(col, row, idx)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {footer}
    </div>
  );
}
