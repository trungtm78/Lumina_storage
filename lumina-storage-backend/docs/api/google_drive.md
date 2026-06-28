# Google Drive API

Base path: `/api/v1/google-drive`

Tất cả endpoints yêu cầu `Authorization: Bearer <access_token>`.

Import file/folder từ Google Drive public URL về storage của hệ thống. Mỗi lần import sẽ tạo một `GoogleDriveImport` record để track trạng thái.

---

## Schemas

### `GoogleDriveImportResponse`

```json
{
  "id": "uuid",
  "drive_file_id": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs",
  "drive_file_name": "report.pdf",
  "drive_url": "https://drive.google.com/file/d/...",
  "mime_type": "application/pdf",
  "status": "completed",
  "document_id": "uuid",
  "error_message": null,
  "created_at": "2026-03-19T10:00:00Z",
  "completed_at": "2026-03-19T10:01:00Z"
}
```

**Status values:** `pending` → `completed` | `failed`

---

## Endpoints

### `POST /api/v1/google-drive/import`

Import file hoặc folder từ Google Drive.

- URL file đơn → import 1 document
- URL folder → import tất cả file trong folder (đệ quy)

**Request body**

```json
{
  "url": "https://drive.google.com/file/d/FILE_ID/view",
  "folder_id": null
}
```

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `url` | `string` | ✅ | Google Drive URL (file hoặc folder) |
| `folder_id` | `UUID` | ❌ | UUID folder đích trên hệ thống |

**Response 201** — `GoogleDriveImportResponse[]`

Trả về danh sách import records (một URL folder có thể tạo nhiều records).

**Errors**

| Status | Khi nào |
|--------|---------|
| 400 | URL không hợp lệ hoặc không phải Google Drive URL |
| 403 | File không public hoặc không có quyền truy cập |

---

### `GET /api/v1/google-drive/imports`

Lấy danh sách tất cả import records của user hiện tại.

**Response 200** — `GoogleDriveImportResponse[]`

---

### `GET /api/v1/google-drive/imports/{import_id}`

Lấy chi tiết một import record.

**Path params**
- `import_id` — UUID của import record

**Response 200** — `GoogleDriveImportResponse`

**Errors**

| Status | Khi nào |
|--------|---------|
| 403 | Không phải owner |
| 404 | Import record không tồn tại |
