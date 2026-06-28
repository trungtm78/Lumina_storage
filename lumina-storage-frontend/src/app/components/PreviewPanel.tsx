import { useTranslation } from "react-i18next";
import { X, Download, Trash2, Edit2, FileText, Save } from "lucide-react";
import { Document } from "../types/document";
import { format } from "date-fns";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { formatFileSize, getFileTypeFromExtension } from "../utils/formatters";

interface PreviewPanelProps {
  document: Document | null;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<Document>) => void;
}

export function PreviewPanel({
  document,
  onClose,
  onUpdate,
}: PreviewPanelProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(document?.title || "");

  useEffect(() => {
    if (document) {
      setEditedTitle(document.title || document.original_filename);
      setIsEditing(false);
    }
  }, [document]);

  if (!document) return null;

  const handleSave = () => {
    onUpdate(document.id, {
      title: editedTitle,
    });
    setIsEditing(false);
    toast.success(t("documents.metadataUpdated"));
  };

  const handleCancel = () => {
    setEditedTitle(document.title || document.original_filename);
    setIsEditing(false);
  };

  return (
    <div className="flex h-full w-96 flex-col border-l border-gray-200 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 p-4">
        <h2 className="font-semibold text-gray-900">{t("documents.documentDetails")}</h2>
        <button
          onClick={onClose}
          className="rounded-lg p-1 transition-colors hover:bg-gray-100"
        >
          <X className="h-5 w-5 text-gray-500" />
        </button>
      </div>

      {/* Preview */}
      <div className="border-b border-gray-200 bg-gray-50 p-4">
        <div className="flex aspect-[3/4] items-center justify-center rounded-lg border border-gray-200 bg-white">
          <FileText className="h-16 w-16 text-gray-400" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {/* Title */}
        <div>
          <Label className="mb-1.5 text-xs text-gray-500 uppercase">
            {t("documents.title")}
          </Label>
          {isEditing ? (
            <Input
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              className="text-sm"
            />
          ) : (
            <p className="text-sm font-medium text-gray-900">
              {document.title || document.original_filename}
            </p>
          )}
        </div>

        {/* File Type */}
        <div>
          <Label className="mb-1.5 text-xs text-gray-500 uppercase">
            {t("documents.fileType")}
          </Label>
          <p className="text-sm text-gray-900">
            {document.extension?.toUpperCase() || document.mime_type}
          </p>
        </div>

        {/* Created Date */}
        <div>
          <Label className="mb-1.5 text-xs text-gray-500 uppercase">
            {t("common.createdAt")}
          </Label>
          <p className="text-sm text-gray-900">
            {format(new Date(document.created_at), "MMMM d, yyyy")}
          </p>
        </div>

        {/* File Path */}
        <div>
          <Label className="mb-1.5 text-xs text-gray-500 uppercase">
            {t("documents.filePath")}
          </Label>
          <p className="font-mono text-sm text-gray-900">
            {document.file_path}
          </p>
        </div>

        {/* File Info */}
        <div>
          <Label className="mb-1.5 text-xs text-gray-500 uppercase">
            {t("documents.fileInfo")}
          </Label>
          <div className="space-y-1 text-sm text-gray-900">
            <p>{t("common.size")}: {formatFileSize(document.file_size)}</p>
            <p>
              {t("common.type")}: {getFileTypeFromExtension(document.extension).toUpperCase()}
            </p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2 border-t border-gray-200 p-4">
        {isEditing ? (
          <div className="flex gap-2">
            <Button
              onClick={handleSave}
              className="bg-brand-500 hover:bg-brand-600 flex-1 text-white"
              size="sm"
            >
              <Save className="mr-2 h-4 w-4" />
              {t("documents.saveChanges")}
            </Button>
            <Button onClick={handleCancel} variant="outline" size="sm">
              {t("common.cancel")}
            </Button>
          </div>
        ) : (
          <>
            <Button
              onClick={() => setIsEditing(true)}
              className="bg-brand-500 hover:bg-brand-600 w-full text-white"
              size="sm"
            >
              <Edit2 className="mr-2 h-4 w-4" />
              {t("documents.editMetadata")}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1">
                <Download className="mr-2 h-4 w-4" />
                {t("common.download")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-brand-600 hover:text-brand-700 flex-1"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t("common.delete")}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
