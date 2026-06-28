import { create } from "zustand";

interface DocumentPageState {
  showCreateFolderDialog: boolean;
  showUploadModal: boolean;
  uploadType: "file" | "folder";

  openCreateFolderDialog: () => void;
  closeCreateFolderDialog: () => void;
  openUploadModal: (type: "file" | "folder") => void;
  closeUploadModal: () => void;
}

export const useDocumentPageStore = create<DocumentPageState>((set) => ({
  showCreateFolderDialog: false,
  showUploadModal: false,
  uploadType: "file",

  openCreateFolderDialog: () => set({ showCreateFolderDialog: true }),
  closeCreateFolderDialog: () => set({ showCreateFolderDialog: false }),
  openUploadModal: (type) => set({ showUploadModal: true, uploadType: type }),
  closeUploadModal: () => set({ showUploadModal: false }),
}));
