import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import {
  X,
  Upload,
  Cloud,
  Link2,
  FolderUp,
  File,
  FileText,
  Trash2,
  Loader2,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useUploadDocuments, useUploadFolder } from "../../hooks/useDocuments";
import { useGoogleDriveImport } from "../../hooks/useGoogleDrive";
import { toast } from "sonner";
import { Input } from "@/app/components/ui/input";
import { formatFileSize, UPLOAD_ALLOWED_FORMATS_LABEL, UPLOAD_MAX_SIZE_MB } from "../../utils/formatters";
import { storageInfoApi } from "@/app/api/endpoints/storage";

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  uploadType: "file" | "folder";
  folderId?: string | null;
}

export function UploadModal({
  isOpen,
  onClose,
  uploadType,
  folderId,
}: UploadModalProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"local" | "storage" | "link">(
    "local"
  );
  const [linkUrl, setLinkUrl] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isTemplate, setIsTemplate] = useState(false);
  const navigate = useNavigate();

  const { data: uploadLimits } = useQuery({
    queryKey: ["storage-upload-limits"],
    queryFn: () => storageInfoApi.uploadLimits(),
    staleTime: 5 * 60 * 1000,
  });
  const maxSizeMb = uploadLimits?.max_upload_size_mb ?? UPLOAD_MAX_SIZE_MB;

  const uploadDocuments = useUploadDocuments();
  const uploadFolder = useUploadFolder(folderId);
  const googleDriveImport = useGoogleDriveImport();

  const isUploading =
    uploadDocuments.isPending ||
    uploadFolder.isPending ||
    googleDriveImport.isPending;

  const handleFileSelect = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";

    if (uploadType === "folder") {
      input.setAttribute("webkitdirectory", "");
      input.setAttribute("directory", "");
    } else {
      input.multiple = true;
    }

    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        setSelectedFiles(Array.from(files));
      }
    };

    input.click();
  }, [uploadType]);

  const handleRemoveFile = useCallback((index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleUploadLocal = useCallback(async () => {
    if (selectedFiles.length === 0) return;

    const formData = new FormData();

    if (uploadType === "folder") {
      // Extract folder name from the first file's relative path
      const firstPath =
        (selectedFiles[0] as File & { webkitRelativePath?: string })
          .webkitRelativePath || "";
      const folderName = firstPath.split("/")[0] || "Uploaded Folder";

      selectedFiles.forEach((file) => {
        formData.append("files", file);
        formData.append(
          "paths",
          (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
            file.name
        );
      });
      if (folderId) {
        formData.append("parent_folder_id", folderId);
      }

      const promise = uploadFolder.mutateAsync({ formData, folderName });
      toast.promise(promise, {
        loading: t("documents.uploadingFolder"),
        success: t("documents.uploadFolderSuccess"),
        error: t("documents.uploadFolderFailed"),
      });
      await promise;
    } else {
      selectedFiles.forEach((file) => {
        formData.append("files", file);
      });
      if (folderId) {
        formData.append("folder_id", folderId);
      }
      if (isTemplate) {
        formData.append("is_template", "true");
      }

      const promise = uploadDocuments.mutateAsync(formData);
      toast.promise(promise, {
        loading: t("documents.uploadingFiles", { count: selectedFiles.length }),
        success: isTemplate
          ? t("documents.uploadTemplateSuccess")
          : t("documents.uploadFilesSuccess", { count: selectedFiles.length }),
        error: t("documents.uploadFilesFailed"),
      });
      await promise;

      if (isTemplate) {
        toast.info(t("documents.templateProcessing"), {
          action: {
            label: t("documents.openGenerator"),
            onClick: () => navigate("/generator"),
          },
          duration: 8000,
        });
      }
    }

    setSelectedFiles([]);
    setIsTemplate(false);
    onClose();
  }, [
    selectedFiles,
    uploadType,
    folderId,
    uploadDocuments,
    uploadFolder,
    onClose,
  ]);

  const handleGoogleDriveImport = useCallback(async () => {
    if (!linkUrl.trim()) return;

    const toastId = toast.loading(t("documents.importingFromDrive"));
    try {
      const results = await googleDriveImport.mutateAsync({
        url: linkUrl.trim(),
        folder_id: folderId ?? undefined,
      });

      const failed = results.filter((r) => r.status === "failed");
      const succeeded = results.filter((r) => r.status === "done");

      if (failed.length > 0) {
        toast.warning(
          t("documents.importPartialSuccess", {
            succeeded: succeeded.length,
            total: results.length,
          }),
          { id: toastId }
        );
      } else {
        toast.success(t("documents.importSuccess"), { id: toastId });
      }

      setLinkUrl("");
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("documents.importFailed"),
        { id: toastId }
      );
    }
  }, [linkUrl, folderId, googleDriveImport, onClose, t]);

  if (!isOpen) return null;

  const tabs = [
    { id: "local" as const, label: "Local", icon: Upload },
    { id: "storage" as const, label: "Google Drive", icon: Cloud },
    { id: "link" as const, label: "Link", icon: Link2 },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 p-6">
          <div className="flex items-center gap-3">
            {uploadType === "folder" ? (
              <FolderUp className="text-brand-500 h-6 w-6" />
            ) : (
              <File className="text-brand-500 h-6 w-6" />
            )}
            <h2 className="text-xl font-semibold text-gray-900">
              {uploadType === "folder"
                ? t("documents.uploadFolderTitle")
                : t("documents.uploadFileTitle")}
            </h2>
          </div>

          <button
            onClick={onClose}
            disabled={isUploading}
            className="rounded-lg p-2 transition-colors hover:bg-gray-100"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-1 items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? "border-brand-600 text-brand-600 border-b-2"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="max-h-[calc(90vh-140px)] min-h-[300px] overflow-y-auto p-6">
          {activeTab === "local" && (
            <div className="space-y-4">
              {/* Drop zone / file picker */}
              {selectedFiles.length === 0 ? (
                <div
                  className="hover:border-brand-400 cursor-pointer rounded-xl border-2 border-dashed border-gray-300 p-12 text-center transition-colors"
                  onClick={handleFileSelect}
                >
                  <Upload className="mx-auto mb-4 h-12 w-12 text-gray-400" />
                  <h3 className="mb-2 text-lg font-medium text-gray-900">
                    {uploadType === "folder"
                      ? t("documents.chooseFolder")
                      : t("documents.chooseFiles")}
                  </h3>
                  <p className="mb-4 text-sm text-gray-500">
                    {uploadType === "folder"
                      ? t("documents.dragDropFolder")
                      : t("documents.dragDropFiles")}
                  </p>
                  <button className="bg-brand-500 hover:bg-brand-600 rounded-lg px-4 py-2 text-white transition-colors">
                    {uploadType === "folder"
                      ? t("documents.selectFolder")
                      : t("documents.selectFiles")}
                  </button>
                </div>
              ) : (
                /* Selected files preview */
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-gray-700">
                      {t("documents.filesSelected", { count: selectedFiles.length })}
                    </h3>
                    <button
                      onClick={handleFileSelect}
                      className="text-brand-600 hover:text-brand-700 text-sm"
                    >
                      {t("documents.reselect")}
                    </button>
                  </div>
                  <div className="max-h-[200px] space-y-1 overflow-y-auto rounded-lg border border-gray-200">
                    {selectedFiles.map((file, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between px-3 py-2 hover:bg-gray-50"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <FileText className="h-4 w-4 shrink-0 text-gray-400" />
                          <span className="truncate text-sm text-gray-700">
                            {file.name}
                          </span>
                          <span className="shrink-0 text-xs text-gray-400">
                            {formatFileSize(file.size)}
                          </span>
                        </div>
                        <button
                          onClick={() => handleRemoveFile(index)}
                          className="rounded p-1 hover:bg-gray-200"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-gray-400" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Template toggle */}
              {selectedFiles.length > 0 && uploadType === "file" && (
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 transition-colors hover:bg-gray-100">
                  <input
                    type="checkbox"
                    checked={isTemplate}
                    onChange={(e) => setIsTemplate(e.target.checked)}
                    className="text-brand-500 focus:ring-brand-400 h-4 w-4 rounded border-gray-300"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-700">
                      {t("documents.createTemplate")}
                    </span>
                    <p className="text-xs text-gray-500">
                      {t("documents.createTemplateDesc")}
                    </p>
                  </div>
                </label>
              )}

              <div className="text-xs text-gray-500">
                <p>• {t("documents.maxFileSizeNote", { size: `${maxSizeMb}MB` })}</p>
                <p>• {t("documents.supportedFormatsNote", { formats: UPLOAD_ALLOWED_FORMATS_LABEL })}</p>
              </div>
            </div>
          )}

          {activeTab === "storage" && (
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  {t("documents.googleDriveUrl")}
                </label>
                <Input
                  type="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://drive.google.com/file/d/..."
                  className="h-auto py-3"
                />
              </div>

              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                <p className="text-sm text-blue-800">
                  <strong>{t("documents.noteLabel")}:</strong> {t("documents.googleDriveNote")}
                </p>
              </div>

              <button
                onClick={handleGoogleDriveImport}
                disabled={!linkUrl.trim() || isUploading}
                className="bg-brand-500 hover:bg-brand-600 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-white transition-colors disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {googleDriveImport.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {t("documents.importFromDrive")}
              </button>
            </div>
          )}

          {activeTab === "link" && (
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  {t("documents.enterUrl")}
                </label>
                <Input
                  type="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://drive.google.com/file/d/... hoặc link trực tiếp"
                  className="h-auto py-3"
                />
              </div>

              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p className="mb-2 text-sm text-gray-700">
                  <strong>{t("documents.supportedSources")}:</strong>
                </p>
                <ul className="list-inside list-disc space-y-1 text-sm text-gray-600">
                  <li>{t("documents.googleDriveLinks")}</li>
                  <li>{t("documents.directFileLinks")}</li>
                </ul>
              </div>

              <button
                onClick={handleGoogleDriveImport}
                disabled={!linkUrl.trim() || isUploading}
                className="bg-brand-500 hover:bg-brand-600 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-white transition-colors disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {googleDriveImport.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {t("documents.uploadFromLink")}
              </button>
            </div>
          )}
        </div>

        {/* Footer - only for local tab with files selected */}
        {activeTab === "local" && (
          <div className="flex justify-end gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4">
            <button
              onClick={onClose}
              disabled={isUploading}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
            >
              {t("common.cancel")}
            </button>

            {selectedFiles.length > 0 ? (
              <button
                onClick={handleUploadLocal}
                disabled={isUploading}
                className="bg-brand-500 hover:bg-brand-600 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:bg-gray-300"
              >
                {isUploading && <Loader2 className="h-4 w-4 animate-spin" />}
                {isTemplate
                  ? t("documents.uploadAndCreateTemplate", {
                      count: selectedFiles.length,
                    })
                  : t("documents.uploadFilesAction", {
                      count: selectedFiles.length,
                    })}
              </button>
            ) : (
              <button
                onClick={handleFileSelect}
                className="bg-brand-500 hover:bg-brand-600 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
              >
                {uploadType === "folder"
                  ? t("documents.browseFolder")
                  : t("documents.browseFiles")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
