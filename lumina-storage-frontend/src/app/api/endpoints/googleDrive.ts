import { http } from "@/app/api/http";
import { API_ENDPOINTS } from "@/app/api/endpoints";
import type {
  GoogleDriveImportResponse,
  GoogleDriveImportRequest,
} from "@/app/types/api";

export const googleDriveApi = {
  import(data: GoogleDriveImportRequest) {
    return http.post<GoogleDriveImportResponse[]>(
      API_ENDPOINTS.googleDrive.import,
      data
    );
  },

  listImports() {
    return http.get<GoogleDriveImportResponse[]>(
      API_ENDPOINTS.googleDrive.imports
    );
  },

  getImport(id: string) {
    return http.get<GoogleDriveImportResponse>(
      API_ENDPOINTS.googleDrive.importDetail(id)
    );
  },
};
