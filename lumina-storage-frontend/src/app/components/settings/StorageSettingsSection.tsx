import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Check, Zap, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { storageApi } from "@/app/api/endpoints/storage";
import {
  DataTable,
  type DataTableColumn,
} from "@/app/components/ui/data-table";
import { StorageConfigModal } from "./StorageConfigModal";
import { StorageQuotaCard } from "./StorageQuotaCard";
import type { StorageConfigResponse } from "@/app/types/api";

export function StorageSettingsSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editConfig, setEditConfig] = useState<StorageConfigResponse | null>(
    null
  );

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ["storageConfigs"],
    queryFn: () => storageApi.list(),
  });

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => storageApi.setDefault(id),
    onSuccess: () => {
      toast.success(t("settings.storage.defaultUpdated"));
      queryClient.invalidateQueries({ queryKey: ["storageConfigs"] });
    },
    onError: () => toast.error(t("settings.storage.defaultUpdateFailed")),
  });

  const handleSaved = () => {
    setShowForm(false);
    setEditConfig(null);
    queryClient.invalidateQueries({ queryKey: ["storageConfigs"] });
  };

  const columns: DataTableColumn<StorageConfigResponse>[] = [
    {
      header: t("common.name"),
      key: "name",
      render: (config) => (
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50 text-purple-600 ring-1 ring-purple-100">
            <Server className="h-5 w-5" />
          </div>
          <div>
            <p className="font-medium text-gray-900">{config.name}</p>
            <p className="text-xs text-gray-500 uppercase">
              {config.backend_type}
            </p>
          </div>
        </div>
      ),
    },
    {
      header: t("common.status"),
      key: "is_default",
      render: (config) => (
        <div className="flex items-center gap-2">
          {config.is_default ? (
            <span className="bg-brand-50 text-brand-700 ring-brand-600/20 inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset">
              <Check className="h-3 w-3" />
              {t("settings.storage.statusDefault")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-gray-500/20 ring-inset">
              {t("settings.storage.statusStandby")}
            </span>
          )}
        </div>
      ),
    },
    {
      header: t("settings.storage.maxUpload"),
      key: "config",
      render: (config) => {
        const sizeMb = (config.config as Record<string, unknown>)
          ?.max_upload_size_mb;
        const display = typeof sizeMb === "number" ? `${sizeMb} MB` : "100 MB";
        return <span className="text-sm text-gray-600">{display}</span>;
      },
    },
    {
      header: t("common.actions"),
      key: "id",
      render: (config) => (
        <div className="flex items-center justify-end gap-2">
          {!config.is_default && (
            <button
              onClick={() => setDefaultMutation.mutate(config.id)}
              disabled={setDefaultMutation.isPending}
              className="flex h-8 items-center gap-1.5 rounded-lg pr-3 pl-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
              title={t("settings.storage.setDefault")}
            >
              <Zap className="h-4 w-4 text-amber-500" />
              {t("settings.storage.setDefault")}
            </button>
          )}
          <button
            onClick={() => {
              setEditConfig(config);
              setShowForm(true);
            }}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            title="Edit"
          >
            <Pencil className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <StorageQuotaCard />
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-gray-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {t("settings.storage.sectionTitle")}
          </h2>
          <p className="text-sm text-gray-500">
            {t("settings.storage.sectionDescription")}
          </p>
        </div>
        <button
          onClick={() => {
            setEditConfig(null);
            setShowForm(true);
          }}
          className="bg-brand-500 hover:bg-brand-600 inline-flex w-fit items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:shadow"
        >
          <Plus className="h-4 w-4" />
          {t("settings.storage.addStorage")}
        </button>
      </div>

      <div className="p-0">
        {configs.length === 0 && !isLoading ? (
          <div className="p-8 text-center text-gray-500">{t("settings.storage.noConfigs")}</div>
        ) : (
          <DataTable
            columns={columns}
            data={configs}
            rowKey={(c) => c.id}
            isLoading={isLoading}
            emptyMessage={t("settings.storage.noConfigsAvailable")}
            className="rounded-none border-0 shadow-none"
          />
        )}
      </div>

      {showForm && (
        <StorageConfigModal
          config={editConfig}
          onClose={() => setShowForm(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
    </div>
  );
}
