# Documents API

Base path: `/api/v1/documents`

Tất cả endpoints yêu cầu `Authorization: Bearer <access_token>`.

---

## Schema

### `DocumentResponse`

```json
{
  "id": "uuid",
  "title": "report",
  "description": null,
  "file_name": "a1b2c3d4.pdf",
  "original_filename": "report.pdf",
  "file_path": "/uploads/a1b2c3d4.pdf",
  "file_size": 204800,
  "mime_type": "application/pdf",
  "extension": ".pdf",
  "checksum": "sha256:...",
  "folder_id": null,
  "storage_config_id": "uuid",
  "owner_id": "uuid",
  "source_type": "upload",
  "source_metadata": null,
  "starred": false,
  "page_count": 10,
  "image_thumbnail": "2026/03/abc123.png",
  "created_at": "2026-03-20T10:00:00Z",
  "updated_at": "2026-03-20T10:00:00Z"
}
```

**Lưu ý các trường nullable:**
- `image_thumbnail` — `null` nếu chưa generate xong hoặc format không hỗ trợ thumbnail
- `page_count` — `null` nếu ingest chưa chạy xong; `0` nếu chạy xong nhưng không extract được text (PDF scanned không có OCR, format không hỗ trợ); `> 0` nếu ingest thành công

> **Frontend dùng `page_count === null`** làm heuristic "đang xử lý" — hiển thị badge spinner "Đang xử lý". Khi `page_count` có giá trị (kể cả `0`), ẩn badge.

---

## Endpoints

### `POST /api/v1/documents/upload`

Upload một hoặc nhiều file lên storage. **Tự động dispatch** `generate_thumbnail_task` và `ingest_document_task` cho mỗi file sau khi upload.

**Content-Type:** `multipart/form-data`

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `files` | `UploadFile[]` | ✅ | Danh sách file cần upload |
| `folder_id` | `UUID` | ❌ | UUID folder đích (mặc định root) |
| `storage_config_id` | `UUID` | ❌ | UUID storage config (mặc định config active) |

**Response 201** — `DocumentResponse[]`

> Ngay sau upload: `page_count = null`, `image_thumbnail = null`. Cả hai được set bất đồng bộ bởi worker.

---

### `POST /api/v1/documents/upload-folder`

Upload nguyên một folder (giữ nguyên cấu trúc thư mục con). Tương tự upload, **tự động dispatch** thumbnail + ingest cho mỗi file.

**Content-Type:** `multipart/form-data`

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `files` | `UploadFile[]` | ✅ | Danh sách file trong folder |
| `paths` | `string[]` | ✅ | Relative path tương ứng (e.g. `docs/sub/file.pdf`) |
| `parent_folder_id` | `UUID` | ❌ | UUID folder cha trên hệ thống |
| `storage_config_id` | `UUID` | ❌ | UUID storage config (mặc định config active) |

> `files` và `paths` phải có cùng số lượng phần tử và đúng thứ tự.

**Response 201** — `DocumentUploadResponse`

```json
{
  "documents": [ /* DocumentResponse[] */ ],
  "folder": { "id": "uuid", "name": "my-folder", ... }
}
```

---

### `DELETE /api/v1/documents/bulk`

Xoá nhiều document cùng lúc (soft delete). Chỉ xoá các document thuộc owner hiện tại.

> **Lưu ý:** Route này phải được định nghĩa **trước** `DELETE /documents/{document_id}` để FastAPI không nhầm `"bulk"` với UUID.

**Request body**

```json
{
  "document_ids": ["uuid1", "uuid2", "uuid3"]
}
```

**Response 200**

```json
{ "deleted": 3 }
```

---

### `GET /api/v1/documents`

Lấy danh sách document của user hiện tại (phân trang, filter, search).

**Query params**

| Param | Type | Default | Mô tả |
|-------|------|---------|-------|
| `page` | `int` | `1` | Trang hiện tại (≥ 1) |
| `page_size` | `int` | `20` | Số item mỗi trang (1–100) |
| `folder_id` | `string` | — | UUID filter theo folder · `"null"` = chỉ lấy root · bỏ qua = tất cả |
| `extensions` | `string[]` | — | Filter theo extension: `?extensions=.pdf&extensions=.docx` |
| `uploader_id` | `UUID` | — | Filter theo owner |
| `sort_by` | `string` | `updated_at` | `updated_at` \| `created_at` |
| `sort_order` | `string` | `desc` | `asc` \| `desc` |
| `start_date` | `datetime` | — | Filter `updated_at >=` (ISO 8601) |
| `end_date` | `datetime` | — | Filter `updated_at <=` (ISO 8601) |
| `q` | `string` | — | Từ khoá tìm kiếm |
| `search_mode` | `string` | `keyword` | `keyword` (FTS) \| `semantic` (Qdrant) |

**Search modes**

- `keyword`: FTS PostgreSQL — `to_tsvector('simple', title) @@ plainto_tsquery(:q)` OR `DocumentContent.search_vector @@ plainto_tsquery(:q)`
- `semantic`: embed `q` → query Qdrant (top 50) → filter DB theo `document_id`

**Response 200**

```json
{
  "items": [ /* DocumentResponse[] */ ],
  "total": 42,
  "page": 1,
  "page_size": 20
}
```

---

### `GET /api/v1/documents/{document_id}`

Lấy chi tiết một document.

**Response 200** — `DocumentResponse`

---

### `PATCH /api/v1/documents/{document_id}/move`

Di chuyển document vào folder khác. Truyền `folder_id: null` để move về root.

**Request body** — `{ "folder_id": "uuid" | null }`

**Response 200** — `DocumentResponse`

---

### `POST /api/v1/documents/{document_id}/star`

Toggle `starred` (`true` ↔ `false`).

**Response 200** — `DocumentResponse`

---

### `GET /api/v1/documents/{document_id}/preview`

Preview inline trong browser (`Content-Disposition: inline`).

**Response 200** — Binary file với đúng `Content-Type`

---

### `GET /api/v1/documents/{document_id}/download`

Download file gốc (`Content-Disposition: attachment`).

**Response 200** — Binary file

---

### `DELETE /api/v1/documents/{document_id}`

Soft delete document.

**Response 204**

---

### `POST /api/v1/documents/{document_id}/process`

Dispatch thủ công `ingest_document_task` cho một document (dùng để re-ingest).

**Response 202**

```json
{
  "id": "uuid",
  "job_id": "arq-job-id",
  "status": "pending",
  "task_name": "ingest_document",
  "created_at": "2026-03-20T10:00:00Z"
}
```

---

### `GET /api/v1/documents/{document_id}/process/status`

Xem trạng thái của lần processing gần nhất.

**Response 200**

```json
{
  "id": "uuid",
  "task_name": "ingest_document",
  "status": "success",
  "result": { "page_count": 10, "chunk_count": 9 },
  "error_message": null,
  "created_at": "...",
  "started_at": "...",
  "completed_at": "..."
}
```

---

## Pipeline thumbnail (`generate_thumbnail_task`)

Tự động dispatch sau mỗi upload:

1. Đọc file từ storage backend
2. Tùy `mime_type`:
   - **PDF** → PyMuPDF render page đầu → PNG
   - **DOCX / PPTX / XLSX / ...** → Gotenberg convert sang PDF → render page đầu
   - **Image (JPEG / PNG / WEBP / GIF)** → resize bằng PyMuPDF
   - **Khác** → bỏ qua (`image_thumbnail` giữ `null`)
3. Lưu file `.png` vào storage
4. Set `Document.image_thumbnail` = path PNG

---

## Pipeline ingestion (`ingest_document_task`)

Tự động dispatch sau mỗi upload. Xem chi tiết tại [`rag_pipeline.md`](rag_pipeline.md).

**Tóm tắt luồng:**

1. Đọc file bytes từ storage backend
2. **Text extraction** (multi-format) → `list[PageResult]`
3. Upsert `DocumentContent.raw_text`
4. Cập nhật `search_vector = to_tsvector('simple', raw_text)` (FTS)
5. Xóa chunks cũ + vectors cũ trên Qdrant *(idempotent)*
6. **Chunking**: `MarkdownHeaderTextSplitter` → `RecursiveCharacterTextSplitter` (1500 chars, overlap 150)
7. **Embed** batch toàn bộ chunks → Azure text-embedding-3-large (3072d)
8. **Upsert Qdrant** — payload `{document_id, chunk_id, chunk_index, content}`
9. Set `Document.page_count = len(pages)`

Nếu không extract được text nào: `page_count = 0`, `skipped = true`, không crash.
