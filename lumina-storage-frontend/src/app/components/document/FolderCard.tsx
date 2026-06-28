import { Folder as FolderIcon, MoreVertical } from "lucide-react";
import { Folder } from "../../types/folder";
import { format } from "date-fns";

interface FolderCardProps {
  folder: Folder;
  onClick: () => void;
  onShowDetails: (folder: Folder) => void;
}

export function FolderCard({ folder, onClick, onShowDetails }: FolderCardProps) {
  return (
    <div
      className="group cursor-pointer rounded-xl border border-border bg-card p-4 transition-all hover:shadow-md"
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-lg bg-brand-50 p-2">
          <FolderIcon className="h-6 w-6 text-brand-500" />
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-foreground">{folder.name}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {format(new Date(folder.created_at), "MMM d, yyyy")}
          </p>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onShowDetails(folder);
          }}
          className="rounded p-1 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
        >
          <MoreVertical className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}
