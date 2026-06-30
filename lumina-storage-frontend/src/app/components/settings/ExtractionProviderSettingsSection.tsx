// Phase 5b — UI admin cấu hình Extraction Provider (mirror AI Model Config). Tự chứa: table +
// form dialog + test-connection + set-default + delete. Provider dropdown chỉ provider /available.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  DataTable,
  type DataTableColumn,
} from "@/app/components/ui/data-table";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { extractionProviderConfigApi } from "@/app/api/endpoints/extractionProviderConfig";
import type {
  ExtractionProviderConfigResponse,
  ExtractionProviderConfigTestResponse,
} from "@/app/types/extractionProviderConfig";

const QK = ["extractionProviderConfigs", "admin"];

interface FormData {
  name: string;
  provider: string;
  api_key: string;
  base_url: string;
  options: string; // JSON text
  applies_to: string; // comma-separated mime/ext
  priority: number;
  is_default: boolean;
  is_active: boolean;
}

const emptyForm: FormData = {
  name: "",
  provider: "local_hybrid",
  api_key: "",
  base_url: "",
  options: "",
  applies_to: "",
  priority: 100,
  is_default: false,
  is_active: true,
};

function ExtractionFormDialog({
  isOpen,
  editConfig,
  onClose,
  onSaved,
}: {
  isOpen: boolean;
  editConfig: ExtractionProviderConfigResponse | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormData>(emptyForm);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] =
    useState<ExtractionProviderConfigTestResponse | null>(null);
  const [optionsError, setOptionsError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: available = [] } = useQuery({
    queryKey: ["extractionProviderConfigs", "available"],
    queryFn: () => extractionProviderConfigApi.available(),
    enabled: isOpen,
  });

  useEffect(() => {
    if (!isOpen) return;
    if (editConfig) {
      setForm({
        name: editConfig.name,
        provider: editConfig.provider,
        api_key: "",
        base_url: editConfig.base_url ?? "",
        options: editConfig.options
          ? JSON.stringify(editConfig.options, null, 2)
          : "",
        applies_to: (editConfig.applies_to ?? []).join(", "),
        priority: editConfig.priority,
        is_default: editConfig.is_default,
        is_active: editConfig.is_active,
      });
    } else {
      setForm({ ...emptyForm });
    }
    setTestResult(null);
    setOptionsError("");
  }, [editConfig, isOpen]);

  const update = <K extends keyof FormData>(key: K, value: FormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Trả {ok, value}: ok=false khi JSON lỗi → handler chặn ngay (không đọc state stale).
  const parseOptions = (): { ok: boolean; value?: Record<string, unknown> } => {
    if (!form.options.trim()) return { ok: true, value: undefined };
    try {
      return { ok: true, value: JSON.parse(form.options) as Record<string, unknown> };
    } catch {
      setOptionsError("Options không phải JSON hợp lệ");
      return { ok: false };
    }
  };

  const parseAppliesTo = (): string[] | undefined => {
    const items = form.applies_to
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return items.length ? items : undefined;
  };

  const handleTest = async () => {
    setOptionsError("");
    const parsed = parseOptions();
    if (!parsed.ok) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await extractionProviderConfigApi.test({
        provider: form.provider,
        api_key: form.api_key || undefined,
        base_url: form.base_url || undefined,
        options: parsed.value,
        config_id: editConfig?.id,
      });
      setTestResult(result);
    } catch {
      setTestResult({ success: false, message: "Request failed" });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setOptionsError("");
    const parsed = parseOptions();
    if (!parsed.ok) return;
    setIsSubmitting(true);
    try {
      if (editConfig) {
        await extractionProviderConfigApi.update(editConfig.id, {
          name: form.name,
          provider: form.provider,
          api_key: form.api_key || undefined,
          base_url: form.base_url || undefined,
          options: parsed.value,
          applies_to: parseAppliesTo(),
          priority: form.priority,
          is_active: form.is_active,
        });
      } else {
        await extractionProviderConfigApi.create({
          name: form.name,
          provider: form.provider,
          api_key: form.api_key || undefined,
          base_url: form.base_url || undefined,
          options: parsed.value,
          applies_to: parseAppliesTo(),
          priority: form.priority,
          is_default: form.is_default,
        });
      }
      toast.success(editConfig ? "Đã cập nhật provider" : "Đã tạo provider");
      onSaved();
    } catch {
      // axios interceptor đã toast lỗi
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">
          {editConfig ? "Sửa Extraction Provider" : "Thêm Extraction Provider"}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Tên <span className="text-brand-500">*</span>
            </label>
            <Input
              required
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="VD: Gemini PDF"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Provider <span className="text-brand-500">*</span>
            </label>
            <Select
              value={form.provider}
              onValueChange={(v) => update("provider", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {available.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-gray-400">
              Chỉ provider đã cài SDK hiện ở đây. local_hybrid luôn khả dụng (mặc định).
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              API Key
            </label>
            <Input
              type="password"
              value={form.api_key}
              onChange={(e) => update("api_key", e.target.value)}
              placeholder={editConfig ? "Để trống nếu không đổi" : ""}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Base URL / Endpoint
            </label>
            <Input
              value={form.base_url}
              onChange={(e) => update("base_url", e.target.value)}
              placeholder="VD: https://<resource>.cognitiveservices.azure.com (Azure DI)"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Áp dụng cho (mime/ext)
              </label>
              <Input
                value={form.applies_to}
                onChange={(e) => update("applies_to", e.target.value)}
                placeholder="application/pdf, .pdf"
              />
              <p className="mt-1 text-xs text-gray-400">
                Cách nhau dấu phẩy. Trống = mọi loại.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Priority
              </label>
              <Input
                type="number"
                value={form.priority}
                onChange={(e) =>
                  update("priority", Number(e.target.value) || 0)
                }
              />
              <p className="mt-1 text-xs text-gray-400">Nhỏ = ưu tiên cao.</p>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Options (JSON)
            </label>
            <Textarea
              rows={3}
              value={form.options}
              onChange={(e) => update("options", e.target.value)}
              placeholder='{"model": "gemini-2.0-flash"}'
            />
            {optionsError && (
              <p className="mt-1 text-xs text-red-500">{optionsError}</p>
            )}
          </div>

          {editConfig ? (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => update("is_active", e.target.checked)}
              />
              Đang bật (is_active)
            </label>
          ) : (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.is_default}
                onChange={(e) => update("is_default", e.target.checked)}
              />
              Đặt làm mặc định
            </label>
          )}

          {testResult && (
            <div
              className={`rounded-lg px-3 py-2 text-xs ${
                testResult.success
                  ? "bg-green-50 text-green-700"
                  : "bg-red-50 text-red-700"
              }`}
            >
              {testResult.message}
            </div>
          )}

          <div className="flex justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={handleTest}
              disabled={isTesting}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {isTesting ? "Đang test..." : "Test connection"}
            </button>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !!optionsError}
                className="bg-brand-500 hover:bg-brand-600 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {isSubmitting ? "Đang lưu..." : "Lưu"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ExtractionProviderSettingsSection() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editConfig, setEditConfig] =
    useState<ExtractionProviderConfigResponse | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { data: configs = [], isLoading } = useQuery({
    queryKey: QK,
    queryFn: () => extractionProviderConfigApi.listAll(),
  });

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => extractionProviderConfigApi.setDefault(id),
    onSuccess: () => {
      toast.success("Đã đặt provider mặc định");
      queryClient.invalidateQueries({ queryKey: QK });
    },
    onError: () => toast.error("Đặt mặc định thất bại"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => extractionProviderConfigApi.delete(id),
    onSuccess: () => {
      toast.success("Đã xóa provider");
      queryClient.invalidateQueries({ queryKey: QK });
      setDeleteConfirmId(null);
    },
    onError: () => toast.error("Xóa thất bại"),
  });

  const columns = useMemo<DataTableColumn<ExtractionProviderConfigResponse>[]>(
    () => [
      { key: "stt", header: "No.", type: "stt" as const, headerClassName: "w-12" },
      {
        key: "name",
        header: "Tên",
        render: (c) => (
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900">{c.name}</span>
            {c.is_default && (
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
        color: "gray" as const,
      },
      {
        key: "applies_to",
        header: "Áp dụng",
        render: (c) => (
          <span className="text-sm text-gray-600">
            {(c.applies_to ?? []).join(", ") || "Mọi loại"}
          </span>
        ),
      },
      {
        key: "priority",
        header: "Priority",
        render: (c) => <span className="text-sm">{c.priority}</span>,
      },
      {
        key: "is_active",
        header: "Trạng thái",
        render: (c) => (
          <span
            className={`text-xs ${c.is_active ? "text-green-600" : "text-gray-400"}`}
          >
            {c.is_active ? "Bật" : "Tắt"}
          </span>
        ),
      },
      {
        key: "actions",
        header: "Thao tác",
        render: (c) => (
          <div className="flex items-center gap-2">
            {!c.is_default && (
              <button
                title="Đặt mặc định"
                onClick={() => setDefaultMutation.mutate(c.id)}
                disabled={setDefaultMutation.isPending}
                className="text-gray-400 hover:text-yellow-500"
              >
                <Star className="h-4 w-4" />
              </button>
            )}
            <button
              title="Sửa"
              onClick={() => {
                setEditConfig(c);
                setShowForm(true);
              }}
              className="text-gray-400 hover:text-brand-500"
            >
              <Pencil className="h-4 w-4" />
            </button>
            {!c.is_default && (
              <button
                title="Xóa"
                onClick={() => setDeleteConfirmId(c.id)}
                className="text-gray-400 hover:text-red-500"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ),
      },
    ],
    [setDefaultMutation],
  );

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-gray-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            Extraction Providers
          </h2>
          <p className="text-sm text-gray-500">
            Cấu hình engine trích xuất tài liệu (LocalHybrid mặc định; Gemini /
            Mistral / Azure DI / Landing AI). Routing theo loại tài liệu +
            fallback.
          </p>
        </div>
        <button
          onClick={() => {
            setEditConfig(null);
            setShowForm(true);
          }}
          className="bg-brand-500 hover:bg-brand-600 inline-flex w-fit items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
        >
          <Plus className="h-4 w-4" />
          Thêm Provider
        </button>
      </div>

      <DataTable
        columns={columns}
        data={configs}
        isLoading={isLoading}
        rowKey={(c) => c.id}
      />

      <ExtractionFormDialog
        isOpen={showForm}
        editConfig={editConfig}
        onClose={() => {
          setShowForm(false);
          setEditConfig(null);
        }}
        onSaved={() => {
          setShowForm(false);
          setEditConfig(null);
          queryClient.invalidateQueries({ queryKey: QK });
        }}
      />

      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-2 text-lg font-semibold text-gray-900">
              Xóa Provider
            </h3>
            <p className="mb-6 text-sm text-gray-500">
              Bạn chắc chắn xóa cấu hình provider này? Không thể hoàn tác.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Hủy
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteConfirmId)}
                disabled={deleteMutation.isPending}
                className="bg-brand-500 hover:bg-brand-600 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {deleteMutation.isPending ? "Đang xóa..." : "Xóa"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
