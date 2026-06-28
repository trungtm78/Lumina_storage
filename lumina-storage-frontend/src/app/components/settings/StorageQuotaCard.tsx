import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { HardDrive, Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { storageQuotaApi } from "@/app/api/endpoints/system";

export function StorageQuotaCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["storageQuota"],
    queryFn: () => storageQuotaApi.get(),
  });

  useEffect(() => {
    if (data) setInputValue(String(data.max_gb));
  }, [data]);

  const mutation = useMutation({
    mutationFn: (max_gb: number) => storageQuotaApi.update(max_gb),
    onSuccess: () => {
      toast.success(t("settings.storage.quotaUpdated"));
      queryClient.invalidateQueries({ queryKey: ["storageQuota"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "stats"] });
    },
    onError: () => toast.error(t("settings.storage.quotaUpdateFailed")),
  });

  const handleSave = () => {
    const num = Number(inputValue);
    if (!inputValue || isNaN(num) || num < 1) {
      setError(t("settings.storage.quotaInvalid"));
      return;
    }
    setError("");
    mutation.mutate(num);
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50">
          <HardDrive className="h-4 w-4 text-blue-500" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            {t("settings.storage.quotaTitle")}
          </h2>
          <p className="text-sm text-gray-500">
            {t("settings.storage.quotaDescription")}
          </p>
        </div>
      </div>

      <div className="px-6 py-5">
        <div className="flex max-w-xs flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">
            {t("settings.storage.quotaLabel")}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setError("");
              }}
              disabled={isLoading || mutation.isPending}
              className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
              placeholder="100"
            />
            <span className="text-sm text-gray-500">GB</span>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <button
          onClick={handleSave}
          disabled={isLoading || mutation.isPending}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {mutation.isPending ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </div>
  );
}
