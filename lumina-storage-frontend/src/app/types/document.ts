import type { DocumentResponse } from "./documentApi";

export type Document = DocumentResponse;

export type ViewMode = "grid" | "table" | "list";

export interface FilterState {
  search: string;
  tags: string[];
  correspondents: string[];
  documentTypes: string[];
  dateRange: {
    start: Date | null;
    end: Date | null;
  };
}
