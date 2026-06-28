import type { FolderResponse } from "./folderApi";

export type Folder = FolderResponse;

export interface BreadcrumbItem {
  id: string;
  name: string;
}
