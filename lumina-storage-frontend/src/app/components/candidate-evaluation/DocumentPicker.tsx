import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { axiosClient } from "@/app/api/client";
import { API_ENDPOINTS } from "@/app/api/endpoints";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { FileText, Folder, ArrowLeft, Search, Check } from "lucide-react";

interface DocumentItem {
  id: string;
  title: string;
  original_filename: string;
  extension: string;
  mime_type: string;
  file_size: number;
}

interface FolderItem {
  id: string;
  name: string;
}

interface DocumentPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (documentIds: string[]) => void;
  multiple?: boolean;
  extensions?: string[];
  title?: string;
}

export function DocumentPicker({
  open,
  onClose,
  onSelect,
  multiple = false,
  extensions,
  title,
}: DocumentPickerProps) {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t("candidateEvaluation.documentPicker.defaultTitle");
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [folderHistory, setFolderHistory] = useState<(string | null)[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchItems = useCallback(
    async (folderId: string | null) => {
      setLoading(true);
      try {
        // BE uses `page_size` (not `limit`). Max allowed by BE is 100.
        // `extensions` must be repeated params (list[str] in FastAPI), not comma-joined.
        const params: Record<string, unknown> = { page_size: "100" };
        if (folderId) params.folder_id = folderId;
        if (extensions?.length) params.extensions = extensions; // send as array → axios repeats: extensions=.pdf&extensions=.docx

        const [docsRes, foldersRes] = await Promise.all([
          axiosClient.get(API_ENDPOINTS.documents.list, { params }),
          axiosClient.get(API_ENDPOINTS.folders.list, {
            params: folderId ? { parent_id: folderId } : {},
          }),
        ]);

        setDocuments(docsRes.data?.items || docsRes.data || []);
        setFolders(foldersRes.data?.items || foldersRes.data || []);
      } catch {
        setDocuments([]);
        setFolders([]);
        toast.error(t("candidateEvaluation.documentPicker.loadError"));
      } finally {
        setLoading(false);
      }
    },
    [extensions]
  );

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setSearch("");
      setCurrentFolder(null);
      setFolderHistory([]);
      fetchItems(null);
    }
  }, [open, fetchItems]);

  const handleFolderClick = (folderId: string) => {
    setFolderHistory((prev) => [...prev, currentFolder]);
    setCurrentFolder(folderId);
    fetchItems(folderId);
  };

  const handleBack = () => {
    const prev = folderHistory[folderHistory.length - 1] ?? null;
    setFolderHistory((h) => h.slice(0, -1));
    setCurrentFolder(prev);
    fetchItems(prev);
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (!multiple) next.clear();
        next.add(id);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    onSelect(Array.from(selected));
    onClose();
  };

  const filtered = search
    ? documents.filter(
        (d) =>
          d.title.toLowerCase().includes(search.toLowerCase()) ||
          d.original_filename.toLowerCase().includes(search.toLowerCase())
      )
    : documents;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{resolvedTitle}</DialogTitle>
        </DialogHeader>

        <div className="mb-3 flex items-center gap-2">
          {folderHistory.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBack}
              className="shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="relative flex-1">
            <Search className="absolute top-2.5 left-2.5 h-4 w-4 text-gray-400" />
            <Input
              placeholder={t("candidateEvaluation.documentPicker.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {loading ? (
            <p className="py-8 text-center text-base text-gray-500">
              {t("candidateEvaluation.documentPicker.loading")}
            </p>
          ) : (
            <>
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-base hover:bg-gray-100"
                  onClick={() => handleFolderClick(folder.id)}
                >
                  <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                  <span className="truncate">{folder.name}</span>
                </button>
              ))}
              {filtered.map((doc) => {
                const isSelected = selected.has(doc.id);
                return (
                  <button
                    key={doc.id}
                    type="button"
                    className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-base transition-colors ${
                      isSelected
                        ? "border border-blue-200 bg-blue-50"
                        : "hover:bg-gray-100"
                    }`}
                    onClick={() => toggleSelect(doc.id)}
                  >
                    {isSelected ? (
                      <Check className="h-4 w-4 shrink-0 text-blue-600" />
                    ) : (
                      <FileText className="h-4 w-4 shrink-0 text-gray-400" />
                    )}
                    <span className="flex-1 truncate">
                      {doc.original_filename || doc.title}
                    </span>
                    <span className="shrink-0 text-sm text-gray-400 uppercase">
                      {doc.extension}
                    </span>
                  </button>
                );
              })}
              {!loading && filtered.length === 0 && folders.length === 0 && (
                <p className="py-8 text-center text-base text-gray-400">
                  {t("candidateEvaluation.documentPicker.noFiles")}
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose}>
            {t("candidateEvaluation.documentPicker.cancel")}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={selected.size === 0}
            className="bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50"
          >
            {t("candidateEvaluation.documentPicker.selectButton", { count: selected.size })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
