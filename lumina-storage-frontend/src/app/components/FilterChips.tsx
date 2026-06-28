import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Badge } from "./ui/badge";

interface FilterChip {
  id: string;
  label: string;
  value: string;
  category: "tag" | "correspondent" | "documentType" | "date";
}

interface FilterChipsProps {
  filters: FilterChip[];
  onRemove: (id: string) => void;
  onClearAll: () => void;
}

export function FilterChips({
  filters,
  onRemove,
  onClearAll,
}: FilterChipsProps) {
  const { t } = useTranslation();
  if (filters.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-gray-500">{t("common.filters")}:</span>
      {filters.map((filter) => (
        <Badge
          key={filter.id}
          variant="secondary"
          className="bg-brand-50 text-brand-700 hover:bg-brand-100 rounded-full py-1.5 pr-2 pl-3"
        >
          <span className="text-xs font-medium">{filter.label}</span>
          <button
            onClick={() => onRemove(filter.id)}
            className="hover:bg-brand-200 ml-1.5 rounded-full p-0.5"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      {filters.length > 1 && (
        <button
          onClick={onClearAll}
          className="ml-1 text-xs text-gray-500 underline hover:text-gray-700"
        >
          {t("common.clearAll")}
        </button>
      )}
    </div>
  );
}
