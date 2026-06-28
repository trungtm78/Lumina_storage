import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderPlus,
  FolderTree,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/app/components/ui/context-menu";
import { foldersApi } from "@/app/api/endpoints/folders";
import type { FolderResponse } from "@/app/types/api";
import { cn } from "@/app/components/ui/utils";

export type FolderTreeAction = "rename" | "delete" | "add-subfolder";

function useFolderChildren(
  parentId: string | null,
  enabled: boolean,
  sharedWithMe?: boolean
) {
  return useQuery({
    queryKey: ["folders", parentId ?? null, !!sharedWithMe],
    queryFn: () =>
      foldersApi.list({ parentId: parentId ?? undefined, sharedWithMe }),
    enabled,
  });
}

interface FolderItemProps {
  folder: FolderResponse;
  depth: number;
  currentFolderId: string | null;
  onNavigate: (folderId: string | null) => void;
  onFolderAction?: (folder: FolderResponse, action: FolderTreeAction) => void;
  collapsed?: boolean;
  sharedWithMe?: boolean;
}

const menuContent = (folder: FolderResponse, onFolderAction: (f: FolderResponse, a: FolderTreeAction) => void, t: TFunction) => (
  <>
    <DropdownMenuItem className="px-3 py-2 text-xs gap-2" onClick={() => onFolderAction(folder, "rename")}>
      <Pencil className="size-3" />{t("common.rename")}
    </DropdownMenuItem>
    <DropdownMenuItem className="px-3 py-2 text-xs gap-2" onClick={() => onFolderAction(folder, "add-subfolder")}>
      <FolderPlus className="size-3" />{t("documents.addSubfolder")}
    </DropdownMenuItem>
    <DropdownMenuItem
      className="px-3 py-2 text-xs gap-2 text-destructive hover:bg-muted focus:bg-muted focus:text-destructive"
      onClick={() => onFolderAction(folder, "delete")}
    >
      <Trash2 className="size-3 text-destructive" />{t("common.delete")}
    </DropdownMenuItem>
  </>
);

function FolderItem({
  folder,
  depth,
  currentFolderId,
  onNavigate,
  onFolderAction,
  collapsed,
  sharedWithMe,
}: FolderItemProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const { data: children } = useFolderChildren(folder.id, expanded, sharedWithMe);
  const isActive = currentFolderId === folder.id;

  if (collapsed) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "relative mx-auto flex h-8 w-8 cursor-pointer select-none items-center justify-center rounded-lg transition-colors",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
            title={folder.name}
            onClick={() => onNavigate(folder.id)}
          >
            <Folder className="h-4 w-4 text-amber-500" />
          </div>
        </ContextMenuTrigger>
        {onFolderAction && (
          <ContextMenuContent className="rounded-xl shadow-lg py-1 min-w-[140px]">
            <ContextMenuItem className="px-3 py-2 text-xs gap-2" onClick={() => onFolderAction(folder, "rename")}>
              <Pencil className="size-3" />{t("common.rename")}
            </ContextMenuItem>
            <ContextMenuItem className="px-3 py-2 text-xs gap-2" onClick={() => onFolderAction(folder, "add-subfolder")}>
              <FolderPlus className="size-3" />{t("documents.addSubfolder")}
            </ContextMenuItem>
            <ContextMenuItem
              className="px-3 py-2 text-xs gap-2 text-destructive hover:bg-muted focus:bg-muted focus:text-destructive"
              onClick={() => onFolderAction(folder, "delete")}
            >
              <Trash2 className="size-3 text-destructive" />{t("common.delete")}
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>
    );
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "group flex cursor-pointer select-none items-center gap-1.5 rounded-lg pr-1 transition-colors",
              isActive
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
            style={{ paddingLeft: `${6 + depth * 14}px`, paddingTop: "5px", paddingBottom: "5px" }}
            onClick={() => onNavigate(folder.id)}
          >
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
              className="flex w-3.5 shrink-0 items-center justify-center"
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>

            <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            <span className="flex-1 truncate text-xs">{folder.name}</span>

            {onFolderAction && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(
                      "shrink-0 rounded p-0.5 transition-all hover:bg-muted/80",
                      isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreVertical className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="rounded-xl shadow-lg py-1 min-w-[140px]">
                  {menuContent(folder, onFolderAction, t)}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </ContextMenuTrigger>

        {onFolderAction && (
          <ContextMenuContent className="rounded-xl shadow-lg py-1 min-w-[140px]">
            <ContextMenuItem className="px-3 py-2 text-xs gap-2" onClick={() => onFolderAction(folder, "rename")}>
              <Pencil className="size-3" />{t("common.rename")}
            </ContextMenuItem>
            <ContextMenuItem className="px-3 py-2 text-xs gap-2" onClick={() => onFolderAction(folder, "add-subfolder")}>
              <FolderPlus className="size-3" />{t("documents.addSubfolder")}
            </ContextMenuItem>
            <ContextMenuItem
              className="px-3 py-2 text-xs gap-2 text-destructive hover:bg-muted focus:bg-muted focus:text-destructive"
              onClick={() => onFolderAction(folder, "delete")}
            >
              <Trash2 className="size-3 text-destructive" />{t("common.delete")}
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>

      {expanded &&
        children?.map((child) => (
          <FolderItem
            key={child.id}
            folder={child}
            depth={depth + 1}
            currentFolderId={currentFolderId}
            onNavigate={onNavigate}
            onFolderAction={onFolderAction}
            sharedWithMe={sharedWithMe}
          />
        ))}
    </>
  );
}

interface FolderTreePanelProps {
  currentFolderId: string | null;
  onNavigate: (folderId: string | null) => void;
  onCreateRootFolder?: () => void;
  onFolderAction?: (folder: FolderResponse, action: FolderTreeAction) => void;
  sharedWithMe?: boolean;
}

export function FolderTreePanel({
  currentFolderId,
  onNavigate,
  onCreateRootFolder,
  onFolderAction,
  sharedWithMe,
}: FolderTreePanelProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const { data: rootFolders } = useFolderChildren(null, true, sharedWithMe);

  const filtered = search.trim()
    ? (rootFolders ?? []).filter((f) =>
        f.name.toLowerCase().includes(search.toLowerCase())
      )
    : (rootFolders ?? []);

  const isRoot = currentFolderId === null;

  return (
    <div className={cn("flex shrink-0 flex-col border-r border-border/60 bg-card transition-all duration-200", collapsed ? "w-10" : "w-56")}>
      {/* Header */}
      {collapsed ? (
        <div className="flex h-10 shrink-0 items-center justify-center border-b border-border/40 px-0">
          <button
            onClick={() => setCollapsed(false)}
            title={t("documents.expandSidebar")}
            className="flex-shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <PanelLeftOpen className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/40 px-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("documents.foldersHeading")}
          </span>
          <button
            onClick={() => setCollapsed(true)}
            title={t("documents.collapseSidebar")}
            className="flex-shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {collapsed && (
        <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-0.5 py-1 px-1">
          <div
            className={cn(
              "mx-auto flex h-8 w-8 cursor-pointer select-none items-center justify-center rounded-lg transition-colors",
              isRoot ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
            title={t("documents.myDrive")}
            onClick={() => onNavigate(null)}
          >
            <FolderTree className="h-4 w-4 text-accent-foreground" />
          </div>
          {(rootFolders ?? []).map((folder) => (
            <FolderItem
              key={folder.id}
              folder={folder}
              depth={0}
              currentFolderId={currentFolderId}
              onNavigate={onNavigate}
              onFolderAction={onFolderAction}
              collapsed
              sharedWithMe={sharedWithMe}
            />
          ))}
        </div>
      )}

      {!collapsed && (
        <>
          {/* Search */}
          <div className="shrink-0 px-2 py-2">
            <div className="relative">
              <Search className="absolute top-1/2 left-2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder={t("documents.searchFolders")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-border bg-muted/40 pl-6 pr-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Tree items */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-0.5 py-1 px-1.5">
            {/* My Drive root */}
            <div
              className={cn(
                "group flex select-none items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors",
                isRoot
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <button
                onClick={() => onNavigate(null)}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5"
              >
                <FolderTree className="h-3.5 w-3.5 shrink-0 text-accent-foreground" />
                <span className="text-xs">{t("documents.myDrive")}</span>
              </button>
              {onCreateRootFolder && (
                <button
                  onClick={(e) => { e.stopPropagation(); onCreateRootFolder(); }}
                  title={t("documents.createFolder")}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-accent-foreground text-white hover:opacity-90"
                >
                  <Plus className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Root folders */}
            {filtered.map((folder) => (
              <FolderItem
                key={folder.id}
                folder={folder}
                depth={0}
                currentFolderId={currentFolderId}
                onNavigate={onNavigate}
                onFolderAction={onFolderAction}
                sharedWithMe={sharedWithMe}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
