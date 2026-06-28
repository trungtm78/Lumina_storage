import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  FileCheck,
  Search,
  Pencil,
  Check,
  X,
  Loader2,
  FileText,
  Eye,
  Download,
  Save,
  RefreshCw,
  Upload,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  templatesApi,
  type LanguageMode,
  type TemplateResponse,
  type TemplateField,
  type TemplateSection,
} from "@/app/api/endpoints/templates";
import { generatorApi, type FieldPresets } from "@/app/api/endpoints/generator";
import {
  formatOptionsText,
  formatSectionsText,
  parseOptionsText,
  parseSectionsText,
} from "@/app/utils/templateForm";
import { axiosClient } from "@/app/api/client";
import { DocxEditor, type DocxEditorRef } from "@eigenpal/docx-js-editor";
import "@eigenpal/docx-js-editor/styles.css";

export function TemplatesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listCollapsed, setListCollapsed] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["templates", search],
    queryFn: () => templatesApi.list({ q: search || undefined, limit: 50 }),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
  const templates = data?.items ?? [];

  const selectedTemplate = templates.find((tmpl) => tmpl.id === selectedId) ?? null;

  return (
    <div
      className="flex h-full flex-col p-4 lg:flex-row lg:p-6"
      style={{ gap: listCollapsed ? 0 : 16, transition: "gap 250ms ease" }}
    >
      {/* List */}
      <div
        className="w-full shrink-0 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm lg:w-[384px] lg:min-w-[384px]"
        style={{
          width: listCollapsed ? 0 : undefined,
          minWidth: listCollapsed ? 0 : undefined,
          opacity: listCollapsed ? 0 : 1,
          borderWidth: listCollapsed ? 0 : 1,
          padding: listCollapsed ? 0 : undefined,
          transition:
            "width 250ms ease, min-width 250ms ease, opacity 200ms ease, border-width 250ms ease, padding 250ms ease",
        }}
      >
        <div className="border-b border-gray-200 p-4">
          <h2 className="mb-3 text-lg font-semibold text-gray-900">
            {t("templates.title")}
          </h2>
          <div className="relative">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={t("templates.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="focus:border-brand-400 focus:ring-brand-100 w-full rounded-lg border border-gray-200 py-2 pr-3 pl-9 text-sm outline-none focus:ring-2"
            />
          </div>
        </div>
        <div className="max-h-none overflow-y-auto lg:max-h-[calc(100vh-220px)]">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : templates.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">
              {t("templates.empty")}
              <br />
              {t("templates.emptyHint")}
            </div>
          ) : (
            templates.map((tmpl) => (
              <button
                key={tmpl.id}
                onClick={() => setSelectedId(tmpl.id)}
                className={`w-full border-b border-gray-100 px-4 py-3 text-left transition-colors hover:bg-gray-50 ${
                  selectedId === tmpl.id
                    ? "border-l-brand-500 bg-brand-50 border-l-2"
                    : ""
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <FileCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {tmpl.title}
                    </p>
                    {tmpl.description && (
                      <p className="mt-0.5 truncate text-xs text-gray-500">
                        {tmpl.description}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-gray-400">
                      {tmpl.field_count} {t("templates.fields")} &middot;{" "}
                      {format(parseISO(tmpl.created_at), "dd/MM/yyyy HH:mm")}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Detail / Editor */}
      <div className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {selectedTemplate ? (
          <TemplateDetail
            template={selectedTemplate}
            onUpdate={() =>
              queryClient.invalidateQueries({ queryKey: ["templates"] })
            }
            listCollapsed={listCollapsed}
            setListCollapsed={setListCollapsed}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-gray-400">
            <div className="text-center">
              <FileText className="mx-auto mb-3 h-12 w-12" />
              <p>{t("templates.selectToView")}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────── Template Detail with DOCX Editor ───────── */

function TemplateDetail({
  template,
  onUpdate,
  listCollapsed,
  setListCollapsed,
}: {
  template: TemplateResponse;
  onUpdate: () => void;
  listCollapsed: boolean;
  setListCollapsed: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const [editingDesc, setEditingDesc] = useState(false);
  const [desc, setDesc] = useState(template.description ?? "");
  const [fields, setFields] = useState<TemplateField[]>(
    template.template_fields
  );
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [languageMode, setLanguageMode] = useState<LanguageMode>(
    template.language_mode
  );
  const [sections, setSections] = useState<TemplateSection[]>(
    template.sections
  );
  const [sectionsDraft, setSectionsDraft] = useState<string>(
    formatSectionsText(template.sections)
  );

  const presetsQuery = useQuery({
    queryKey: ["generator", "field-presets"],
    queryFn: () => generatorApi.fieldPresets(),
    staleTime: 60 * 60 * 1000,
  });
  const presets: FieldPresets = presetsQuery.data ?? {};

  // DOCX editor state
  const [docBuffer, setDocBuffer] = useState<ArrayBuffer | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const editorRef = useRef<DocxEditorRef>(null);

  // Tab: "fields" or "editor"
  const [activeTab, setActiveTab] = useState<"fields" | "editor">("fields");

  // Reset when template changes
  useEffect(() => {
    setDesc(template.description ?? "");
    setFields(template.template_fields);
    setEditingDesc(false);
    setEditingFieldId(null);
    setDocBuffer(null);
    setShowEditor(false);
    setActiveTab("fields");
    setLanguageMode(template.language_mode);
    setSections(template.sections);
    setSectionsDraft(formatSectionsText(template.sections));
  }, [template.id]);

  const updateDesc = useMutation({
    mutationFn: () => templatesApi.update(template.id, { description: desc }),
    onSuccess: () => {
      setEditingDesc(false);
      onUpdate();
      toast.success(t("templates.updateDescSuccess"));
    },
  });

  const updateFields = useMutation({
    mutationFn: () =>
      templatesApi.updateFields(
        template.id,
        fields.map((f) => ({
          id: f.id,
          placeholder: f.placeholder,
          label: f.label,
          type: f.type,
          options: f.options ?? null,
          section_key: f.section_key ?? null,
          required: f.required ?? null,
        }))
      ),
    onSuccess: () => {
      setEditingFieldId(null);
      onUpdate();
      toast.success(t("templates.updateSuccess"));
    },
  });

  const updateMeta = useMutation({
    mutationFn: () => {
      const parsed = parseSectionsText(sectionsDraft);
      return templatesApi.update(template.id, {
        language_mode: languageMode,
        sections: parsed,
      });
    },
    onSuccess: (resp) => {
      setSections(resp.sections);
      setSectionsDraft(formatSectionsText(resp.sections));
      onUpdate();
      toast.success(t("templates.updateMetaSuccess"));
    },
  });

  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSaveFromEditor = useCallback(async () => {
    if (!editorRef.current) return;
    setSaving(true);
    try {
      const buffer = await editorRef.current.save({ selective: false });
      if (!buffer || buffer.byteLength === 0) {
        toast.error(t("templates.editorEmptyError"));
        setSaving(false);
        return;
      }

      await templatesApi.uploadFile(template.id, buffer);
      // After upload, rescan to update field list
      const rescanResp = await templatesApi.rescan(template.id);
      const newFields = rescanResp.template_fields ?? [];

      setFields(newFields);
      setDocBuffer(buffer);
      setActiveTab("fields");
      toast.success(t("templates.savedSuccess", { count: newFields.length }));
      onUpdate();
    } catch (err) {
      console.error("Save error:", err);
      toast.error(t("templates.saveError"));
    }
    setSaving(false);
  }, [template.id, onUpdate]);

  const handleRescan = useCallback(async () => {
    setSaving(true);
    try {
      const resp = await templatesApi.rescan(template.id);
      const newFields = resp.template_fields ?? [];
      setFields(newFields);
      toast.success(t("templates.syncSuccess", { count: newFields.length }));
      onUpdate();
    } catch {
      toast.error(t("templates.syncError"));
    }
    setSaving(false);
  }, [template.id, onUpdate]);

  const handleReupload = useCallback(
    async (file: File) => {
      setSaving(true);
      try {
        const buffer = await file.arrayBuffer();
        await templatesApi.uploadFile(template.id, buffer);
        const rescanResp = await templatesApi.rescan(template.id);
        const newFields = rescanResp.template_fields ?? [];

        setFields(newFields);
        setDocBuffer(buffer);
        setActiveTab("fields");
        toast.success(t("templates.savedSuccess", { count: newFields.length }));
        onUpdate();
      } catch {
        toast.error(t("templates.reuploadError"));
      }
      setSaving(false);
    },
    [template.id, onUpdate]
  );

  const loadDocx = useCallback(async () => {
    setDocLoading(true);
    try {
      const resp = await axiosClient.get<Blob>(
        `/documents/${template.id}/download`,
        { responseType: "blob" }
      );
      const buffer = await resp.data.arrayBuffer();
      setDocBuffer(buffer);
      setShowEditor(true);
      setActiveTab("editor");
      // Collapse list after a short delay so transitions don't fight
      requestAnimationFrame(() => setListCollapsed(true));
    } catch {
      toast.error(t("templates.loadError"));
    }
    setDocLoading(false);
  }, [template.id, setListCollapsed]);

  const handleDownload = useCallback(async () => {
    try {
      const resp = await axiosClient.get<Blob>(
        `/documents/${template.id}/download`,
        { responseType: "blob" }
      );
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = template.original_filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("templates.downloadError"));
    }
  }, [template.id, template.original_filename]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-gray-200 px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            {/* Toggle list panel */}
            <button
              onClick={() => setListCollapsed(!listCollapsed)}
              className="mt-0.5 shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              title={listCollapsed ? t("templates.showList") : t("templates.hideList")}
            >
              {listCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-gray-900">
                {template.title}
              </h2>
              <p className="text-xs text-gray-400">
                {template.original_filename} &middot; {template.field_count}{" "}
                {t("templates.fields")} &middot;{" "}
                {template.extraction_status === "completed"
                  ? t("templates.extracted")
                  : (template.extraction_status ?? "")}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={handleRescan}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              title={t("templates.rescanTooltip")}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span className="hidden xl:inline">{t("templates.sync")}</span>
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              title={t("common.download")}
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">{t("common.download")}</span>
            </button>
            <button
              onClick={
                showEditor
                  ? () => {
                      setShowEditor(false);
                      setActiveTab("fields");
                      setListCollapsed(false);
                    }
                  : loadDocx
              }
              disabled={docLoading}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm ${
                showEditor
                  ? "border border-gray-200 text-gray-600 hover:bg-gray-50"
                  : "bg-brand-500 hover:bg-brand-600 text-white"
              }`}
            >
              {docLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : showEditor ? (
                <X className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
              {showEditor ? t("templates.closeEditor") : t("templates.openEditor")}
            </button>
          </div>
        </div>

        {/* Description */}
        <div className="mt-3">
          {editingDesc ? (
            <div className="flex items-center gap-2">
              <input
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                className="focus:border-brand-400 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none"
                placeholder={t("templates.descPlaceholder")}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") updateDesc.mutate();
                  if (e.key === "Escape") {
                    setEditingDesc(false);
                    setDesc(template.description ?? "");
                  }
                }}
              />
              <button
                onClick={() => updateDesc.mutate()}
                disabled={updateDesc.isPending}
                className="bg-brand-500 hover:bg-brand-600 rounded-lg p-1.5 text-white"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  setEditingDesc(false);
                  setDesc(template.description ?? "");
                }}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div
              onClick={() => setEditingDesc(true)}
              className="group flex cursor-pointer items-center gap-2 text-sm text-gray-600"
            >
              <span>
                {template.description || t("templates.noDesc")}
              </span>
              <Pencil className="h-3 w-3 text-gray-400 opacity-0 group-hover:opacity-100" />
            </div>
          )}
        </div>

        {/* Tabs + editor actions */}
        {showEditor && (
          <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3">
            <button
              onClick={() => setActiveTab("fields")}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === "fields"
                  ? "bg-brand-50 text-brand-600 shadow-sm"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
              }`}
            >
              {t("templates.tabs.fields", { count: fields.length })}
            </button>
            <button
              onClick={() => setActiveTab("editor")}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === "editor"
                  ? "bg-brand-50 text-brand-600 shadow-sm"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
              }`}
            >
              {t("templates.tabs.editor")}
            </button>
            <div className="flex-1" />
            <div
              className={`flex shrink-0 gap-2 transition-opacity ${
                activeTab === "editor"
                  ? "opacity-100"
                  : "pointer-events-none opacity-0"
              }`}
            >
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                <Upload className="h-3.5 w-3.5" />
                {t("templates.uploadOtherFile")}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleReupload(file);
                  e.target.value = "";
                }}
              />
              <button
                onClick={handleSaveFromEditor}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg bg-green-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                {t("common.save")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 overflow-hidden">
          {activeTab === "fields" ? (
            <FieldsTable
              fields={fields}
              setFields={setFields}
              editingFieldId={editingFieldId}
              setEditingFieldId={setEditingFieldId}
              updateFields={updateFields}
              sections={sections}
              presets={presets}
              languageMode={languageMode}
              setLanguageMode={setLanguageMode}
              sectionsDraft={sectionsDraft}
              setSectionsDraft={setSectionsDraft}
              updateMeta={updateMeta}
            />
          ) : docBuffer ? (
            <DocxEditor
              ref={editorRef}
              documentBuffer={docBuffer}
              mode="editing"
              onChange={() => {}}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────── Fields Table ───────── */

const FIELD_TYPE_VALUES = [
  "blank",
  "placeholder",
  "label_empty",
  "date",
  "number",
  "textarea",
  "select",
] as const;

function FieldsTable({
  fields,
  setFields,
  editingFieldId,
  setEditingFieldId,
  updateFields,
  sections,
  presets,
  languageMode,
  setLanguageMode,
  sectionsDraft,
  setSectionsDraft,
  updateMeta,
}: {
  fields: TemplateField[];
  setFields: (f: TemplateField[]) => void;
  editingFieldId: string | null;
  setEditingFieldId: (id: string | null) => void;
  updateFields: { mutate: () => void; isPending: boolean };
  sections: TemplateSection[];
  presets: FieldPresets;
  languageMode: LanguageMode;
  setLanguageMode: (m: LanguageMode) => void;
  sectionsDraft: string;
  setSectionsDraft: (s: string) => void;
  updateMeta: { mutate: () => void; isPending: boolean };
}) {
  const { t } = useTranslation();
  const fieldTypeOptions = FIELD_TYPE_VALUES.map((v) => ({
    value: v,
    label: t(`templates.fieldTypeOptions.${v}`),
  }));
  const sectionKeys = sections.map((s) => s.key);
  const presetKeys = Object.keys(presets);

  const setField = (idx: number, patch: Partial<TemplateField>) => {
    const updated = [...fields];
    updated[idx] = { ...fields[idx], ...patch };
    setFields(updated);
  };

  return (
    <div className="h-full overflow-y-auto px-6 py-4">
      {/* Template-level meta controls */}
      <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
            {t("templates.config")}
          </h3>
          <button
            onClick={() => updateMeta.mutate()}
            disabled={updateMeta.isPending}
            className="bg-brand-500 hover:bg-brand-600 flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium text-white disabled:opacity-60"
          >
            {updateMeta.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Check className="h-3 w-3" />
            )}
            {t("templates.saveConfig")}
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-gray-600">
              {t("templates.templateLang")}
            </label>
            <select
              value={languageMode}
              onChange={(e) => setLanguageMode(e.target.value as LanguageMode)}
              className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm outline-none"
            >
              <option value="single">{t("templates.singleLang")}</option>
              <option value="bilingual">{t("templates.bilingualLang")}</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-gray-600">
              {t("templates.sectionsLabel")}
            </label>
            <textarea
              rows={3}
              value={sectionsDraft}
              onChange={(e) => setSectionsDraft(e.target.value)}
              placeholder={
                "customer:Thông tin Khách hàng\ncontract:Thông tin Hợp đồng"
              }
              className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 font-mono text-xs outline-none"
            />
          </div>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">
          {t("templates.fieldListCount", { count: fields.length })}
        </h3>
        <button
          onClick={() => updateFields.mutate()}
          disabled={updateFields.isPending}
          className="flex items-center gap-1.5 rounded-lg bg-green-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-600 disabled:opacity-60"
        >
          {updateFields.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Check className="h-3 w-3" />
          )}
          {t("templates.saveFields")}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {fields.map((f, i) => (
          <div
            key={f.id}
            className="rounded-lg border border-gray-200 bg-white p-3"
          >
            <div className="grid gap-2 sm:grid-cols-12">
              <div className="sm:col-span-3">
                <label className="mb-0.5 block text-[10px] font-medium text-gray-400 uppercase">
                  {t("templates.placeholder")}
                </label>
                {editingFieldId === f.id ? (
                  <input
                    value={f.placeholder}
                    onChange={(e) =>
                      setField(i, { placeholder: e.target.value })
                    }
                    className="border-brand-300 focus:ring-brand-400 w-full rounded border px-2 py-1 text-xs outline-none focus:ring-1"
                  />
                ) : (
                  <code
                    onClick={() => setEditingFieldId(f.id)}
                    className="text-brand-600 hover:bg-brand-50 block cursor-pointer truncate rounded bg-gray-100 px-1.5 py-1 text-xs"
                  >
                    {"{"}
                    {f.placeholder}
                    {"}"}
                  </code>
                )}
              </div>
              <div className="sm:col-span-3">
                <label className="mb-0.5 block text-[10px] font-medium text-gray-400 uppercase">
                  {t("templates.label")}
                </label>
                <input
                  value={f.label}
                  onChange={(e) => setField(i, { label: e.target.value })}
                  className="focus:border-brand-300 w-full rounded border border-gray-200 px-2 py-1 text-xs outline-none"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-0.5 block text-[10px] font-medium text-gray-400 uppercase">
                  {t("templates.fieldType")}
                </label>
                <select
                  value={f.type}
                  onChange={(e) => setField(i, { type: e.target.value })}
                  className="w-full rounded border border-gray-200 bg-white px-1 py-1 text-xs outline-none"
                >
                  {fieldTypeOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-0.5 block text-[10px] font-medium text-gray-400 uppercase">
                  {t("templates.section")}
                </label>
                <input
                  list={`section-suggestions-${f.id}`}
                  value={f.section_key ?? ""}
                  onChange={(e) =>
                    setField(i, {
                      section_key: e.target.value.trim() || null,
                    })
                  }
                  placeholder={t("templates.noSection")}
                  className="focus:border-brand-300 w-full rounded border border-gray-200 px-2 py-1 text-xs outline-none"
                />
                <datalist id={`section-suggestions-${f.id}`}>
                  {sectionKeys.map((k) => (
                    <option key={k} value={k} />
                  ))}
                </datalist>
              </div>
              <div className="flex items-end pb-1 sm:col-span-2">
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={f.required ?? f.type !== "blank"}
                    onChange={(e) =>
                      setField(i, { required: e.target.checked })
                    }
                  />
                  {t("templates.required")}
                </label>
              </div>
            </div>

            {f.type === "select" && (
              <div className="mt-2 border-t border-gray-100 pt-2">
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-[10px] font-medium text-gray-400 uppercase">
                    {t("templates.optionsLabel")}
                  </label>
                  {presetKeys.length > 0 && (
                    <select
                      value=""
                      onChange={(e) => {
                        const key = e.target.value;
                        if (!key) return;
                        const preset = presets[key] ?? [];
                        if (preset.length > 0) setField(i, { options: preset });
                      }}
                      className="rounded border border-gray-200 bg-white px-1 py-0.5 text-[10px] text-gray-600"
                    >
                      <option value="">{t("templates.usePreset")}</option>
                      {presetKeys.map((k) => (
                        <option key={k} value={k}>
                          {k} ({(presets[k] ?? []).length})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <textarea
                  rows={Math.min(6, Math.max(2, (f.options ?? []).length + 1))}
                  value={formatOptionsText(f.options)}
                  onChange={(e) =>
                    setField(i, { options: parseOptionsText(e.target.value) })
                  }
                  placeholder={"Trả trước\nTrả sau\nTrả theo đợt"}
                  className="w-full rounded border border-gray-200 px-2 py-1 font-mono text-xs outline-none"
                />
              </div>
            )}

            <div className="mt-1 text-[10px] text-gray-400">{f.location}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
