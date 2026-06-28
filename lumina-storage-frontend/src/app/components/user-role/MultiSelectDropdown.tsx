import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

interface MultiSelectDropdownProps {
  options: { id: string; name: string }[];
  selected: string[];
  onToggle: (id: string) => void;
  placeholder: string;
}

export function MultiSelectDropdown({
  options,
  selected,
  onToggle,
  placeholder,
}: MultiSelectDropdownProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label =
    selected.length === 0 ? placeholder : `${selected.length} selected`;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-8 items-center gap-1 rounded-lg border px-2 text-xs outline-none ${
          selected.length > 0
            ? "border-brand-400 bg-brand-50 text-brand-700"
            : "border-gray-200 text-gray-700"
        }`}
      >
        {label}
        <ChevronRight
          className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-9 left-0 z-20 max-h-48 min-w-36 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
            {options.map((opt) => (
              <label
                key={opt.id}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt.id)}
                  onChange={() => onToggle(opt.id)}
                  className="accent-brand-500 h-3 w-3"
                />
                <span className="truncate text-xs text-gray-700">
                  {opt.name}
                </span>
              </label>
            ))}
            {options.length === 0 && (
              <p className="px-3 py-2 text-xs text-gray-400">{t("users.multiSelect.noOptions")}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
