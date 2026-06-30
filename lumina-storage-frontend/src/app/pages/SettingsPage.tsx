import { useState, useMemo, useEffect } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Star,
  Check,
  X,
  Zap,
  Loader2,
  Bot,
  Palette,
  Cpu,
  HardDrive,
  FileSearch,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DataTable,
  type DataTableColumn,
  type TableColor,
} from "@/app/components/ui/data-table";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/app/components/ui/tabs";
import { BrandingSettingsCard } from "@/app/components/BrandingSettingsCard";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { axiosClient } from "@/app/api/client";
import { aiModelConfigApi } from "@/app/api/endpoints/aiModelConfig";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { StorageSettingsSection } from "@/app/components/settings/StorageSettingsSection";
import { ExtractionProviderSettingsSection } from "@/app/components/settings/ExtractionProviderSettingsSection";
import type {
  AIModelConfigResponse,
  AIModelConfigCreateRequest,
  AIModelConfigUpdateRequest,
  AIModelConfigTestResponse,
} from "@/app/types/aiModelConfig";

function ModelTable({
  models,
  isLoading,
  onEdit,
  onDelete,
  onSetDefault,
  isSettingDefault,
  onShowForm,
}: {
  models: AIModelConfigResponse[];
  isLoading: boolean;
  onEdit: (model: AIModelConfigResponse) => void;
  onDelete: (id: string) => void;
  onSetDefault: (id: string) => void;
  isSettingDefault: boolean;
  onShowForm: () => void;
}) {
  const columns = useMemo<DataTableColumn<AIModelConfigResponse>[]>(
    () => [
      {
        key: "stt",
        header: "No.",
        type: "stt" as const,
        headerClassName: "w-12",
        cellClassName: "w-12",
      },
      {
        key: "name",
        header: "Name",
        render: (model) => (
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900">{model.name}</span>
            {model.is_default && (
              <Star className="h-3.5 w-3.5 fill-yellow-500 text-yellow-500" />
            )}
          </div>
        ),
      },
      {
        key: "provider",
        header: "Provider",
        type: "tag_one" as const,
        field: "provider" as const,
        color: "gray",
        cellClassName: "px-4 py-4",
      },
      {
        key: "model",
        header: "Model",
        type: "text" as const,
        field: "model_name" as const,
        cellClassName: "px-4 py-4",
      },
      {
        key: "purpose",
        header: "Purpose",
        type: "tag_one" as const,
        field: "purpose" as const,
        colorField: (model: AIModelConfigResponse): TableColor =>
          model.purpose === "chat" ? "blue" : "purple",
        cellClassName: "px-4 py-4",
      },
      {
        key: "status",
        header: "Status",
        type: "status" as const,
        field: (model: AIModelConfigResponse) =>
          model.is_active ? "Active" : "Inactive",
        colorField: (model: AIModelConfigResponse): TableColor =>
          model.is_active ? "green" : "gray",
        icon: undefined, // icon differs per row, use render
        render: (model: AIModelConfigResponse) => (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              model.is_active
                ? "bg-green-100 text-green-700"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            {model.is_active ? (
              <Check className="h-3 w-3" />
            ) : (
              <X className="h-3 w-3" />
            )}
            {model.is_active ? "Active" : "Inactive"}
          </span>
        ),
        cellClassName: "px-4 py-4",
      },
      {
        key: "actions",
        header: "Actions",
        cellClassName: "px-4 py-4",
        render: (model) => (
          <div className="flex items-center gap-2">
            {!model.is_default && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSetDefault(model.id);
                }}
                disabled={isSettingDefault}
                title="Set as default"
                className="rounded p-1 text-gray-500 hover:bg-yellow-100 hover:text-yellow-600"
              >
                <Star className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(model);
              }}
              title="Edit"
              className="rounded p-1 text-gray-500 hover:bg-blue-100 hover:text-blue-600"
            >
              <Pencil className="h-4 w-4" />
            </button>
            {!model.is_default && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(model.id);
                }}
                title="Delete"
                className="hover:bg-brand-100 hover:text-brand-600 rounded p-1 text-gray-500"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ),
      },
    ],
    [onEdit, onDelete, onSetDefault, isSettingDefault]
  );

  if (!isLoading && models.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-gray-500">No models configured yet.</p>
        <button
          onClick={onShowForm}
          className="text-brand-500 hover:text-brand-600 mt-3 text-sm font-medium"
        >
          Add your first model
        </button>
      </div>
    );
  }

  return (
    <DataTable
      columns={columns}
      data={models}
      rowKey={(model) => model.id}
      isLoading={isLoading}
      emptyMessage="No models configured"
      className="rounded-none border-0 shadow-none"
    />
  );
}

const PROVIDERS = ["azure", "openai", "anthropic", "google", "ollama"] as const;
const PURPOSES = ["chat", "embedding"] as const;

const PROVIDER_HINTS: Record<
  string,
  {
    model_name: string;
    model_hint: string;
    base_url: string;
    base_url_hint: string;
    api_key: string;
    note?: string;
  }
> = {
  azure: {
    model_name: "e.g. gpt-4.1",
    model_hint: "Azure deployment name (prefix azure/ is added automatically)",
    base_url: "https://<resource>.openai.azure.com/",
    base_url_hint: "Azure OpenAI endpoint URL (required)",
    api_key: "Azure API key",
    note: 'Add api_version in Extra Config: {"api_version": "2025-01-01-preview"}',
  },
  openai: {
    model_name: "e.g. gpt-4o, gpt-4-turbo",
    model_hint: "OpenAI model ID",
    base_url: "Leave blank for api.openai.com",
    base_url_hint: "Optional: custom OpenAI-compatible endpoint",
    api_key: "sk-...",
  },
  anthropic: {
    model_name: "e.g. claude-3-5-sonnet-20241022",
    model_hint: "Anthropic model ID",
    base_url: "Leave blank for default",
    base_url_hint: "Optional: custom endpoint",
    api_key: "sk-ant-...",
  },
  google: {
    model_name: "e.g. gemini-2.0-flash",
    model_hint:
      "Google Gemini model ID (prefix gemini/ is added automatically)",
    base_url: "Leave blank for default",
    base_url_hint: "Optional: custom endpoint",
    api_key: "Google AI Studio API key",
  },
  ollama: {
    model_name: "e.g. llama3, mistral, qwen2.5",
    model_hint: "Ollama model name (prefix ollama/ is added automatically)",
    base_url: "http://localhost:11434",
    base_url_hint: "Ollama server URL (required)",
    api_key: "Leave blank (not required for Ollama)",
  },
};

function useAIModelConfigs() {
  return useQuery({
    queryKey: ["aiModelConfigs", "admin"],
    queryFn: () => aiModelConfigApi.listAll(),
  });
}

interface ModelFormData {
  name: string;
  provider: string;
  model_name: string;
  purpose: string;
  api_key: string;
  base_url: string;
  extra_config: string; // raw JSON string
  is_default: boolean;
  is_active: boolean;
}

const defaultFormData: ModelFormData = {
  name: "",
  provider: "azure",
  model_name: "",
  purpose: "chat",
  api_key: "",
  base_url: "",
  extra_config: "",
  is_default: false,
  is_active: true,
};

interface ModelFormDialogProps {
  isOpen: boolean;
  editModel: AIModelConfigResponse | null;
  onClose: () => void;
  onSaved: () => void;
}

function ModelFormDialog({
  isOpen,
  editModel,
  onClose,
  onSaved,
}: ModelFormDialogProps) {
  const [form, setForm] = useState<ModelFormData>(defaultFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] =
    useState<AIModelConfigTestResponse | null>(null);
  const [extraConfigError, setExtraConfigError] = useState("");

  const hints = PROVIDER_HINTS[form.provider] ?? PROVIDER_HINTS.openai;

  useEffect(() => {
    if (!isOpen) return;
    if (editModel) {
      setForm({
        name: editModel.name,
        provider: editModel.provider,
        model_name: editModel.model_name,
        purpose: editModel.purpose,
        api_key: "",
        base_url: editModel.base_url ?? "",
        extra_config: editModel.extra_config
          ? JSON.stringify(editModel.extra_config, null, 2)
          : "",
        is_default: editModel.is_default,
        is_active: editModel.is_active,
      });
    } else {
      setForm({ ...defaultFormData });
    }
    setTestResult(null);
    setExtraConfigError("");
  }, [editModel, isOpen]);

  const parseExtraConfig = (): Record<string, unknown> | undefined => {
    if (!form.extra_config.trim()) return undefined;
    try {
      return JSON.parse(form.extra_config) as Record<string, unknown>;
    } catch {
      setExtraConfigError("Invalid JSON");
      return undefined;
    }
  };

  if (!isOpen) return null;

  const handleTest = async () => {
    if (!form.model_name || extraConfigError) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await aiModelConfigApi.test({
        model_name: form.model_name,
        provider: form.provider,
        purpose: form.purpose,
        api_key: form.api_key || undefined,
        base_url: form.base_url || undefined,
        extra_config: parseExtraConfig(),
        config_id: editModel?.id,
      });
      setTestResult(result);
    } catch {
      setTestResult({
        success: false,
        message: "Request failed",
        response_preview: null,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const extra = parseExtraConfig();
      if (editModel) {
        const data: AIModelConfigUpdateRequest = {
          name: form.name,
          provider: form.provider,
          model_name: form.model_name,
          base_url: form.base_url || undefined,
          extra_config: extra,
          is_active: form.is_active,
        };
        if (form.api_key) data.api_key = form.api_key;
        await aiModelConfigApi.update(editModel.id, data);
        toast.success("Model updated");
      } else {
        const data: AIModelConfigCreateRequest = {
          name: form.name,
          provider: form.provider,
          model_name: form.model_name,
          purpose: form.purpose,
          base_url: form.base_url || undefined,
          extra_config: extra,
          is_default: form.is_default,
        };
        if (form.api_key) data.api_key = form.api_key;
        await aiModelConfigApi.create(data);
        toast.success("Model created");
      }
      onSaved();
    } catch {
      toast.error(
        editModel ? "Failed to update model" : "Failed to create model"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const update = (field: keyof ModelFormData, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setTestResult(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            {editModel ? "Edit Model" : "Add Model"}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Name <span className="text-brand-500">*</span>
            </label>
            <Input
              required
              type="text"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="e.g. GPT-4.1 Azure"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Provider <span className="text-brand-500">*</span>
              </label>
              <Select
                value={form.provider}
                onValueChange={(v) => {
                  update("provider", v);
                  setForm((prev) => ({
                    ...prev,
                    provider: v,
                    model_name: "",
                    base_url: "",
                  }));
                  setTestResult(null);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Purpose <span className="text-brand-500">*</span>
              </label>
              <Select
                value={form.purpose}
                onValueChange={(v) => update("purpose", v)}
                disabled={!!editModel}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select purpose" />
                </SelectTrigger>
                <SelectContent>
                  {PURPOSES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Model Name <span className="text-brand-500">*</span>
            </label>
            <Input
              required
              type="text"
              value={form.model_name}
              onChange={(e) => update("model_name", e.target.value)}
              placeholder={hints.model_name}
            />
            <p className="mt-1 text-xs text-gray-400">{hints.model_hint}</p>
            {form.purpose === "embedding" && (
              <p className="mt-1 text-xs text-amber-600">
                Embedding dim must match QDRANT_VECTOR_SIZE (e.g. 3072). Use
                Test Connection to verify.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              API Key{" "}
              {editModel && (
                <span className="font-normal text-gray-400">
                  (leave blank to keep existing)
                </span>
              )}
            </label>
            <Input
              type="password"
              value={form.api_key}
              onChange={(e) => update("api_key", e.target.value)}
              placeholder={editModel ? "••••••••" : hints.api_key}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Base URL
            </label>
            <Input
              type="text"
              value={form.base_url}
              onChange={(e) => update("base_url", e.target.value)}
              placeholder={hints.base_url}
            />
            <p className="mt-1 text-xs text-gray-400">{hints.base_url_hint}</p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Extra Config
              <span className="ml-1 font-normal text-gray-400">(JSON)</span>
            </label>
            <Textarea
              rows={3}
              value={form.extra_config}
              onChange={(e) => {
                update("extra_config", e.target.value);
                const val = e.target.value.trim();
                if (!val) {
                  setExtraConfigError("");
                  return;
                }
                try {
                  JSON.parse(val);
                  setExtraConfigError("");
                } catch {
                  setExtraConfigError("Invalid JSON");
                }
              }}
              placeholder={'{\n  "api_version": "2025-01-01-preview"\n}'}
              className={`font-mono text-xs ${extraConfigError ? "border-destructive" : ""}`}
            />
            {extraConfigError ? (
              <p className="text-brand-500 mt-1 text-xs">{extraConfigError}</p>
            ) : (
              <p className="mt-1 text-xs text-gray-400">
                Additional LiteLLM kwargs as a JSON object
              </p>
            )}
          </div>

          {hints.note && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="text-xs text-amber-700">
                <span className="font-medium">Note: </span>
                {hints.note}
              </p>
            </div>
          )}

          <div className="flex gap-4">
            {!editModel && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.is_default}
                  onChange={(e) => update("is_default", e.target.checked)}
                  className="rounded"
                />
                Set as default
              </label>
            )}
            {editModel && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => update("is_active", e.target.checked)}
                  className="rounded"
                />
                Active
              </label>
            )}
          </div>

          {/* Test result */}
          {testResult && (
            <div
              className={`rounded-lg border px-4 py-3 text-sm ${
                testResult.success
                  ? "border-green-200 bg-green-50 text-green-800"
                  : "border-brand-200 bg-brand-50 text-brand-800"
              }`}
            >
              <div className="flex items-center gap-2 font-medium">
                {testResult.success ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <X className="text-brand-600 h-4 w-4" />
                )}
                {testResult.success
                  ? "Connection successful"
                  : "Connection failed"}
              </div>
              {testResult.success && testResult.response_preview && (
                <p className="mt-1 text-xs opacity-70">
                  Response:{" "}
                  <span className="font-mono">
                    {testResult.response_preview}
                  </span>
                </p>
              )}
              {!testResult.success && (
                <p className="mt-1 text-xs break-all opacity-80">
                  {testResult.message}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={handleTest}
              disabled={isTesting || !form.model_name}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {isTesting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Zap className="h-4 w-4 text-yellow-500" />
              )}
              {isTesting ? "Testing..." : "Test Connection"}
            </button>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !!extraConfigError}
                className="bg-brand-500 hover:bg-brand-600 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {isSubmitting ? "Saving..." : editModel ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: models = [], isLoading } = useAIModelConfigs();
  const [showForm, setShowForm] = useState(false);
  const [editModel, setEditModel] = useState<AIModelConfigResponse | null>(
    null
  );
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => aiModelConfigApi.setDefault(id),
    onSuccess: () => {
      toast.success("Default model updated");
      queryClient.invalidateQueries({ queryKey: ["aiModelConfigs"] });
    },
    onError: () => toast.error("Failed to set default"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => aiModelConfigApi.delete(id),
    onSuccess: () => {
      toast.success("Model deleted");
      queryClient.invalidateQueries({ queryKey: ["aiModelConfigs"] });
      setDeleteConfirmId(null);
    },
    onError: () => toast.error("Failed to delete model"),
  });

  const handleSaved = () => {
    setShowForm(false);
    setEditModel(null);
    queryClient.invalidateQueries({ queryKey: ["aiModelConfigs"] });
  };

  const handleEdit = (model: AIModelConfigResponse) => {
    setEditModel(model);
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setEditModel(null);
  };

  return (
    <div className="h-full w-full overflow-auto p-4 sm:p-6 lg:p-8">
      <div className="mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            {t("settings.pageTitle")}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {t("settings.pageSubtitle")}
          </p>
        </div>

        <Tabs defaultValue="llm-models" className="w-full">
          <TabsList className="mb-6 h-auto flex-wrap">
            <TabsTrigger value="llm-models" className="flex items-center gap-2">
              <Bot className="h-4 w-4" />
              <span className="hidden sm:inline">
                {t("settings.tabs.llmModels")}
              </span>
              <span className="sm:hidden">{t("settings.tabs.llmShort")}</span>
            </TabsTrigger>
            <TabsTrigger
              value="skill-models"
              className="flex items-center gap-2"
            >
              <Cpu className="h-4 w-4" />
              <span className="hidden sm:inline">
                {t("settings.tabs.skillModels")}
              </span>
              <span className="sm:hidden">
                {t("settings.tabs.skillShort")}
              </span>
            </TabsTrigger>
            <TabsTrigger value="extraction" className="flex items-center gap-2">
              <FileSearch className="h-4 w-4" />
              <span className="hidden sm:inline">Extraction</span>
            </TabsTrigger>
            <TabsTrigger value="storage" className="flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              {t("settings.tabs.storage")}
            </TabsTrigger>
            <TabsTrigger value="branding" className="flex items-center gap-2">
              <Palette className="h-4 w-4" />
              {t("settings.tabs.branding")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="llm-models">
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-gray-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    {t("settings.sections.llmModels.title")}
                  </h2>
                  <p className="text-sm text-gray-500">
                    {t("settings.sections.llmModels.description")}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setEditModel(null);
                    setShowForm(true);
                  }}
                  className="bg-brand-500 hover:bg-brand-600 inline-flex w-fit items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  Add Model
                </button>
              </div>
              <ModelTable
                models={models}
                isLoading={isLoading}
                onEdit={handleEdit}
                onDelete={setDeleteConfirmId}
                onSetDefault={(id) => setDefaultMutation.mutate(id)}
                isSettingDefault={setDefaultMutation.isPending}
                onShowForm={() => setShowForm(true)}
              />
            </div>
          </TabsContent>

          <TabsContent value="skill-models">
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <SkillModelSection models={models} />
            </div>
          </TabsContent>

          <TabsContent value="extraction">
            <ExtractionProviderSettingsSection />
          </TabsContent>

          <TabsContent value="storage">
            <StorageSettingsSection />
          </TabsContent>

          <TabsContent value="branding">
            <BrandingSettingsCard />
          </TabsContent>
        </Tabs>
      </div>

      {/* Form dialog */}
      <ModelFormDialog
        isOpen={showForm}
        editModel={editModel}
        onClose={handleCloseForm}
        onSaved={handleSaved}
      />

      {/* Delete confirmation dialog */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-2 text-lg font-semibold text-gray-900">
              Delete Model
            </h3>
            <p className="mb-6 text-sm text-gray-500">
              Are you sure you want to delete this model? This action cannot be
              undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteConfirmId)}
                disabled={deleteMutation.isPending}
                className="bg-brand-500 hover:bg-brand-600 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────── Skill Model Config Section ────────── */

interface SkillModelEntry {
  name: string;
  description: string;
  model_config_id: string | null;
}

function SkillModelSection({ models }: { models: AIModelConfigResponse[] }) {
  const [skills, setSkills] = useState<SkillModelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const chatModels = models.filter(
    (m) => m.is_active && m.purpose !== "embedding"
  );

  useEffect(() => {
    axiosClient
      .get<{ skills: SkillModelEntry[] }>("/system/skill-model-config")
      .then((res) => {
        setSkills(res.data.skills);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleChange = (skillName: string, modelConfigId: string | null) => {
    setSkills((prev) =>
      prev.map((s) =>
        s.name === skillName ? { ...s, model_config_id: modelConfigId } : s
      )
    );
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const config: Record<string, string | null> = {};
      for (const s of skills) {
        config[s.name] = s.model_config_id || null;
      }
      await axiosClient.put("/system/skill-model-config", { config });
      toast.success("Đã lưu cấu hình model cho skills");
      setDirty(false);
    } catch {
      toast.error("Lưu thất bại");
    }
    setSaving(false);
  };

  return (
    <>
      <div className="flex flex-col gap-3 border-b border-gray-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Skill Models</h2>
          <p className="text-sm text-gray-500">
            Chọn model AI cho từng skill. Mặc định = dùng model trong chat.
          </p>
        </div>
        {dirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-brand-500 hover:bg-brand-600 inline-flex w-fit items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-60"
          >
            {saving ? "Đang lưu..." : "Lưu thay đổi"}
          </button>
        )}
      </div>

      <div className="overflow-x-auto px-4 py-4 sm:px-6">
        {loading ? (
          <p className="py-4 text-center text-sm text-gray-400">Đang tải...</p>
        ) : skills.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-400">
            Chưa có skill nào
          </p>
        ) : (
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                <th className="pb-2 font-medium">Skill</th>
                <th className="pb-2 font-medium">Mô tả</th>
                <th className="pb-2 font-medium">Model</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((skill) => (
                <tr
                  key={skill.name}
                  className="border-b border-gray-100 hover:bg-gray-50"
                >
                  <td className="py-3 pr-4 font-medium text-gray-900">
                    {skill.name}
                  </td>
                  <td className="py-3 pr-4 text-xs text-gray-500">
                    {skill.description}
                  </td>
                  <td className="py-3">
                    <select
                      value={skill.model_config_id ?? ""}
                      onChange={(e) =>
                        handleChange(skill.name, e.target.value || null)
                      }
                      className="focus:border-brand-400 focus:ring-brand-100 w-full max-w-xs rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:ring-1"
                    >
                      <option value="">Mặc định (model chat)</option>
                      {chatModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.provider}/{m.model_name})
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
