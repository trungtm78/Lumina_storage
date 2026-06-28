import { useState } from "react";
import { X, Save, RefreshCw } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { storageApi } from "@/app/api/endpoints/storage";
import { Input } from "@/app/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import type {
  StorageConfigResponse,
  StorageConfigCreateRequest,
  StorageConfigUpdateRequest,
} from "@/app/types/api";

interface StorageConfigModalProps {
  config: StorageConfigResponse | null;
  onClose: () => void;
  onSaved: () => void;
}

export function StorageConfigModal({
  config,
  onClose,
  onSaved,
}: StorageConfigModalProps) {
  const { t } = useTranslation();
  const isEditing = !!config;

  const [name, setName] = useState(config?.name || "");
  const [backendType, setBackendType] = useState<"local" | "s3" | "minio">(
    (config?.backend_type as any) || "s3"
  );

  // S3 Specific
  const [bucket, setBucket] = useState(
    (config?.config as any)?.bucket_name ||
      (config?.config as any)?.bucket ||
      ""
  );
  const [endpointUrl, setEndpointUrl] = useState(
    (config?.config as any)?.endpoint_url || ""
  );
  const [accessKey, setAccessKey] = useState(
    (config?.config as any)?.access_key || ""
  );
  const [secretKey, setSecretKey] = useState(
    (config?.config as any)?.secret_key || ""
  );
  const [region, setRegion] = useState(
    (config?.config as any)?.region_name || "us-east-1"
  );

  // Per-storage upload size cap (backend defaults to 100MB if unset)
  const [maxUploadSizeMb, setMaxUploadSizeMb] = useState<string>(
    String((config?.config as any)?.max_upload_size_mb ?? 100)
  );

  const [isDefault, setIsDefault] = useState(config?.is_default || false);

  const mutation = useMutation({
    mutationFn: (
      data: StorageConfigCreateRequest | StorageConfigUpdateRequest
    ) => {
      if (isEditing) {
        return storageApi.update(config.id, data as StorageConfigUpdateRequest);
      }
      return storageApi.create(data as StorageConfigCreateRequest);
    },
    onSuccess: () => {
      toast.success(
        isEditing ? t("settings.storage.configUpdated") : t("settings.storage.configCreated")
      );
      onSaved();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || t("settings.storage.operationFailed"));
    },
  });

  const testConnectionMutation = useMutation({
    mutationFn: (data: Partial<StorageConfigCreateRequest>) =>
      storageApi.testConnection(data),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(res.message || t("settings.storage.connectionSuccess"));
      } else {
        toast.error(res.message || t("settings.storage.connectionFailed"));
      }
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || t("settings.storage.testConnectionFailed"));
    },
  });

  const getFormPayload = () => {
    const payloadConfig: Record<string, any> = {};

    if (backendType === "local") {
    } else {
      if (!bucket) {
        toast.error(t("settings.storage.bucketRequired"));
        return null;
      }
      payloadConfig.bucket_name = bucket; // using bucket_name for consistency in backend
      payloadConfig.endpoint_url = endpointUrl || undefined;
      payloadConfig.access_key = accessKey || undefined;
      payloadConfig.secret_key = secretKey || undefined;
      payloadConfig.region_name = region || undefined;
    }

    // Validate + serialize max upload size. Backend coerces invalid values to
    // its default but we surface the problem here so admins don't quietly save
    // a string they thought was a number.
    const sizeNum = Number.parseInt(maxUploadSizeMb, 10);
    if (Number.isNaN(sizeNum) || sizeNum < 1) {
      toast.error(t("settings.storage.maxUploadSizeInvalid"));
      return null;
    }
    if (sizeNum > 5120) {
      toast.error(t("settings.storage.maxUploadSizeCapped"));
      return null;
    }
    payloadConfig.max_upload_size_mb = sizeNum;

    return {
      name: name || "Test",
      backend_type: backendType,
      config: payloadConfig,
      is_default: isDefault,
    };
  };

  const handleTestConnection = () => {
    const payload = getFormPayload();
    if (!payload) return;
    testConnectionMutation.mutate(payload);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) {
      toast.error(t("settings.storage.nameRequired"));
      return;
    }

    const payload = getFormPayload();
    if (!payload) return;

    mutation.mutate(payload as StorageConfigCreateRequest);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-xl font-semibold text-gray-900">
            {isEditing ? t("settings.storage.editConfig") : t("settings.storage.addConfig")}
          </h2>
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5">
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                {t("settings.storage.displayName")}
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. AWS Production S3"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                {t("settings.storage.backendType")}
              </label>
              <Select
                value={backendType}
                onValueChange={(val: any) => setBackendType(val)}
                disabled={isEditing} // usually we don't change backend type after creation
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select backend type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="s3">Amazon S3</SelectItem>
                  <SelectItem value="minio">MinIO (S3 Compatible)</SelectItem>
                  <SelectItem value="local">Local Storage</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {backendType === "local" ? null : (
              <>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
                    {t("settings.storage.bucketName")}
                  </label>
                  <Input
                    value={bucket}
                    onChange={(e) => setBucket(e.target.value)}
                    placeholder="my-app-documents"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
                    {t("settings.storage.endpointUrl")}
                  </label>
                  <Input
                    value={endpointUrl}
                    onChange={(e) => setEndpointUrl(e.target.value)}
                    placeholder="https://s3.amazonaws.com"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
                    {t("settings.storage.regionName")}
                  </label>
                  <Input
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    placeholder="us-east-1"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                      {t("settings.storage.accessKey")}
                    </label>
                    <Input
                      value={accessKey}
                      onChange={(e) => setAccessKey(e.target.value)}
                      type="password"
                      placeholder="••••••••"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                      {t("settings.storage.secretKey")}
                    </label>
                    <Input
                      value={secretKey}
                      onChange={(e) => setSecretKey(e.target.value)}
                      type="password"
                      placeholder="••••••••"
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                {t("settings.storage.maxUploadSize")}
              </label>
              <Input
                type="number"
                min={1}
                max={5120}
                value={maxUploadSizeMb}
                onChange={(e) => setMaxUploadSizeMb(e.target.value)}
                placeholder="100"
              />
              <p className="mt-1 text-xs text-gray-500">
                {t("settings.storage.maxUploadSizeHint")}
              </p>
            </div>

            {!config?.is_default && (
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="makeDefault"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="text-brand-600 focus:ring-brand-500 h-4 w-4 rounded border-gray-300"
                />
                <label htmlFor="makeDefault" className="text-sm text-gray-700">
                  {t("settings.storage.setAsDefault")}
                </label>
              </div>
            )}
          </div>

          <div className="mt-8 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testConnectionMutation.isPending}
              className="focus:ring-brand-500 inline-flex items-center gap-2 rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:opacity-50"
            >
              {testConnectionMutation.isPending ? (
                t("settings.storage.testing")
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  {t("settings.storage.testConnection")}
                </>
              )}
            </button>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={mutation.isPending}
                className="bg-brand-500 hover:bg-brand-600 inline-flex items-center gap-2 rounded-xl px-6 py-2 text-sm font-medium text-white shadow-sm transition-all hover:shadow disabled:opacity-50"
              >
                {mutation.isPending ? (
                  t("common.saving")
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    {t("settings.storage.saveConfig")}
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
