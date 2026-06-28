import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/app/components/ui/utils";
import { Button } from "@/app/components/ui/button";
import { usersApi } from "@/app/api/endpoints/users";
import type { UserSearchResult } from "@/app/types/documentPermission";

export interface DocumentFilterState {
  fileTypes: string[];
  owner: UserSearchResult | null;
  fromDate: string;
  toDate: string;
}

const FILE_TYPE_OPTIONS = ["DOCX", "PDF", "XLSX", "IMG", "VIDEO"];

interface FilterDocumentsDialogProps {
  open: boolean;
  initial: DocumentFilterState;
  onClose: () => void;
  onApply: (filters: DocumentFilterState) => void;
}

export function FilterDocumentsDialog({
  open,
  initial,
  onClose,
  onApply,
}: FilterDocumentsDialogProps) {
  const { t } = useTranslation();
  const [fileTypes, setFileTypes] = useState<string[]>(initial.fileTypes);
  const [owner, setOwner] = useState<UserSearchResult | null>(initial.owner);
  const [ownerQuery, setOwnerQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [ownerFocused, setOwnerFocused] = useState(false);
  const [fromDate, setFromDate] = useState(initial.fromDate);
  const [toDate, setToDate] = useState(initial.toDate);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(ownerQuery), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [ownerQuery]);

  const { data: ownerResults = [], isFetching: ownerLoading } = useQuery({
    queryKey: ["users-search", debouncedQuery],
    queryFn: () => usersApi.search(debouncedQuery),
    enabled: open && ownerFocused && !owner,
  });

  if (!open) return null;

  const toggleFileType = (type: string) => {
    setFileTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const handleReset = () => {
    setFileTypes([]);
    setOwner(null);
    setOwnerQuery("");
    setDebouncedQuery("");
    setOwnerFocused(false);
    setFromDate("");
    setToDate("");
  };

  const handleApply = () => {
    onApply({ fileTypes, owner, fromDate, toDate });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5">
          <h2 className="text-base font-semibold text-gray-900">
            {t("documents.filterDialogTitle")}
          </h2>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-6 pb-6">
          {/* FILE TYPE */}
          <div>
            <p className="mb-2.5 text-xs font-semibold uppercase tracking-widest text-gray-500">
              {t("documents.filterFileType")}
            </p>
            <div className="flex flex-wrap gap-2">
              {FILE_TYPE_OPTIONS.map((type) => (
                <button
                  key={type}
                  onClick={() => toggleFileType(type)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                    fileTypes.includes(type)
                      ? "border-brand-500 bg-brand-50 text-brand-600"
                      : "border-gray-300 bg-white text-gray-600 hover:border-gray-400"
                  )}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* OWNER */}
          <div>
            <p className="mb-2.5 text-xs font-semibold uppercase tracking-widest text-gray-500">
              {t("documents.filterOwner")}
            </p>
            {owner ? (
              <div className="flex items-center justify-between rounded-lg border border-brand-300 bg-brand-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-800">{owner.full_name}</p>
                  <p className="truncate text-xs text-gray-500">{owner.email}</p>
                </div>
                <button
                  onClick={() => { setOwner(null); setOwnerQuery(""); }}
                  className="ml-2 flex-shrink-0 text-gray-400 hover:text-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={ownerQuery}
                  onChange={(e) => setOwnerQuery(e.target.value)}
                  onFocus={() => setOwnerFocused(true)}
                  onBlur={() => setTimeout(() => setOwnerFocused(false), 150)}
                  placeholder={t("documents.filterOwnerPlaceholder")}
                  className="h-9 w-full rounded-lg border border-gray-300 bg-white px-3 pr-8 text-sm placeholder:text-gray-400 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-200"
                />
                {ownerLoading && (
                  <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-gray-400" />
                )}
                {ownerFocused && !ownerLoading && ownerResults.length === 0 && debouncedQuery.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg">
                    <p className="text-sm text-gray-400">{t("documents.noUsersFound")}</p>
                  </div>
                )}
                {ownerFocused && ownerResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                    {ownerResults.map((user) => (
                      <button
                        key={user.id}
                        onMouseDown={() => { setOwner(user); setOwnerQuery(""); setOwnerFocused(false); }}
                        className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-gray-50"
                      >
                        <span className="text-sm font-medium text-gray-800">{user.full_name}</span>
                        <span className="text-xs text-gray-500">{user.email}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* FROM / TO */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-2.5 text-xs font-semibold uppercase tracking-widest text-gray-500">
                {t("documents.filterFrom")}
              </p>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-200"
              />
            </div>
            <div>
              <p className="mb-2.5 text-xs font-semibold uppercase tracking-widest text-gray-500">
                {t("documents.filterTo")}
              </p>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-200"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <Button variant="outline" className="h-10 w-full" onClick={handleReset}>
              {t("common.reset")}
            </Button>
            <Button
              className="h-10 w-full bg-brand-500 text-white hover:bg-brand-600"
              onClick={handleApply}
            >
              {t("common.apply")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
