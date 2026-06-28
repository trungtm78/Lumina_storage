import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Folder, HardDrive, Check, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/app/components/ui/dialog";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/components/ui/utils";
import { foldersApi } from "@/app/api/endpoints/folders";
import type { Document } from "@/app/types/document";
import { useMoveDocument } from "@/app/hooks/useDocuments";
import { toast } from "sonner";

interface MoveToFolderDialogProps {
  document: Document | null;
  open: boolean;
  onClose: () => void;
}

const ROOT_ID = "__root__";

export function MoveToFolderDialog({ document, open, onClose }: MoveToFolderDialogProps) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string>(ROOT_ID);
  const moveDocument = useMoveDocument();

  const { data: folders = [], isLoading } = useQuery({
    queryKey: ["folders-for-move"],
    queryFn: () => foldersApi.list(),
    enabled: open,
  });

  const handleMove = async () => {
    if (!document) return;
    const targetFolderId = selectedId === ROOT_ID ? null : selectedId;
    const targetName =
      selectedId === ROOT_ID
        ? t("documents.myDrive")
        : folders.find((f) => f.id === selectedId)?.name ?? "";

    const toastId = toast.loading(t("documents.moveTo") + "...");
    try {
      await moveDocument.mutateAsync({ id: document.id, folderId: targetFolderId });
      toast.success(t("documents.moveConfirm", { folder: targetName }), { id: toastId });
      onClose();
    } catch {
      toast.dismiss(toastId);
    }
  };

  const currentFolderId = document?.folder_id ?? null;

  const isCurrentLocation = (id: string) =>
    id === ROOT_ID ? currentFolderId === null : currentFolderId === id;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[440px] p-0 gap-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="text-base">{t("documents.moveTo")}</DialogTitle>
          {document && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 break-words">
              {document.title || document.original_filename}
            </p>
          )}
        </DialogHeader>

        {/* Folder list */}
        <div className="border-y border-border">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="min-h-[80px] max-h-[260px] overflow-y-auto">
              {/* Drive của tôi — root */}
              <FolderItem
                name={t("documents.myDrive")}
                isRoot
                selected={selectedId === ROOT_ID}
                isCurrent={isCurrentLocation(ROOT_ID)}
                onClick={() => setSelectedId(ROOT_ID)}
              />

              {/* Divider giữa root và các folder */}
              {folders.length > 0 && <div className="mx-4 border-t border-border/60" />}

              {/* Folder list */}
              {folders.map((folder) => (
                <FolderItem
                  key={folder.id}
                  name={folder.name}
                  selected={selectedId === folder.id}
                  isCurrent={isCurrentLocation(folder.id)}
                  onClick={() => setSelectedId(folder.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="px-5 py-4 flex flex-row justify-end gap-2 sm:gap-2">
          <Button variant="outline" size="sm" className="min-w-[72px]" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            className="min-w-[100px]"
            disabled={isCurrentLocation(selectedId) || moveDocument.isPending}
            onClick={handleMove}
          >
            {moveDocument.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : null}
            {t("common.move")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface FolderItemProps {
  name: string;
  isRoot?: boolean;
  selected: boolean;
  isCurrent: boolean;
  onClick: () => void;
}

function FolderItem({ name, isRoot, selected, isCurrent, onClick }: FolderItemProps) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      disabled={isCurrent}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left",
        selected && !isCurrent && "bg-primary/8 text-primary",
        isCurrent && "cursor-default opacity-50",
        !selected && !isCurrent && "hover:bg-muted/50"
      )}
    >
      {/* Icon */}
      <span className="shrink-0">
        {isRoot ? (
          <HardDrive className={cn("h-4 w-4", selected && !isCurrent ? "text-primary" : "text-muted-foreground")} />
        ) : (
          <Folder className={cn("h-4 w-4", selected && !isCurrent ? "text-primary" : "text-yellow-500")} />
        )}
      </span>

      {/* Name */}
      <span className="flex-1 truncate font-medium">{name}</span>

      {/* Trạng thái */}
      {isCurrent && (
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          {t("common.current")}
        </span>
      )}
      {selected && !isCurrent && (
        <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
      )}
    </button>
  );
}
