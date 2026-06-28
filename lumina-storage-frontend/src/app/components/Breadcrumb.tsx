import { ChevronRight } from "lucide-react";
import { BreadcrumbItem } from "../types/folder";

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  onNavigate: (id: string) => void;
}

export function Breadcrumb({ items, onNavigate }: BreadcrumbProps) {
  return (
    <div className="flex items-center gap-1 border-b border-gray-200 bg-white px-6 py-3">
      {items.map((item, index) => (
        <div key={item.id} className="flex items-center gap-1">
          <button
            onClick={() => onNavigate(item.id)}
            className={`text-sm transition-colors ${
              index === items.length - 1
                ? "font-medium text-gray-900"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {item.name}
          </button>
          {index < items.length - 1 && (
            <ChevronRight className="h-4 w-4 text-gray-400" />
          )}
        </div>
      ))}
    </div>
  );
}
