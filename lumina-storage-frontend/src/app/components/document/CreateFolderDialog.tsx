import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Input } from "@/app/components/ui/input";

interface CreateFolderDialogProps {
  open: boolean;
  onClose: () => void;
  onCreateFolder: (name: string) => void;
  initialName?: string;
  title?: string;
  placeholder?: string;
  submitLabel?: string;
}

export function CreateFolderDialog({
  open,
  onClose,
  onCreateFolder,
  initialName,
  title,
  placeholder,
  submitLabel,
}: CreateFolderDialogProps) {
  const { t } = useTranslation();
  const [folderName, setFolderName] = useState(initialName ?? "");

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (folderName.trim()) {
      onCreateFolder(folderName.trim());
      setFolderName("");
      onClose();
    }
  };

  const handleCancel = () => {
    setFolderName("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-md rounded-lg bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-medium text-gray-900">{title ?? t("documents.newFolder")}</h2>
          <button
            onClick={handleCancel}
            className="text-gray-400 transition-colors hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-6">
            <Input
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder={placeholder ?? t("documents.folderNamePlaceholder")}
              autoFocus
              className="h-auto py-3"
            />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-6 py-4">
            <button
              type="button"
              onClick={handleCancel}
              className="rounded px-6 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={!folderName.trim()}
              className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {submitLabel ?? t("documents.createFolderAction")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
