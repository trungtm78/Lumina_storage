# Tasks API

Background task dispatch và monitoring qua ARQ + Redis.

---

## Schema

### `BackgroundTaskResponse`

```json
{
  "id": "uuid",
  "job_id": "arq-job-id",
  "task_name": "ingest_document",
  "status": "success",
  "result": { "page_count": 10, "chunk_count": 9 },
  "error_message": null,
  "related_type": "document",
  "related_id": "uuid",
  "created_at": "2026-03-20T10:00:00Z",
  "started_at": "2026-03-20T10:00:01Z",
  "completed_at": "2026-03-20T10:00:15Z"
}
```

**Status values:** `pending` → `running` → `success` | `failure` | `revoked`

---

## Endpoints

### `GET /api/v1/tasks`

Lấy danh sách background tasks (phân trang, filter). Non-admin chỉ thấy task của chính mình; superuser thấy tất cả.

**Query params**

| Param | Type | Default | Mô tả |
|-------|------|---------|-------|
| `page` | `int` | `1` | Trang hiện tại |
| `page_size` | `int` | `20` | Số item/trang (1–100) |
| `status` | `string` | — | Filter theo status: `pending` / `running` / `success` / `failure` / `revoked` |
| `task_name` | `string` | — | Filter theo tên task: `ingest_document` / `generate_thumbnail` / `ping` / ... |

**Response 200**

```json
{
  "items": [ /* BackgroundTaskResponse[] */ ],
  "total": 42,
  "page": 1,
  "page_size": 20
}
```

> Kết quả sắp xếp theo `created_at desc` (mới nhất trước).

---

### `POST /api/v1/tasks/ping`

Dispatch một `ping_task` để kiểm tra pipeline worker hoạt động.

**Response 202**

```json
{
  "id": "uuid",
  "job_id": "arq-job-id",
  "status": "pending",
  "task_name": "ping",
  "created_at": "2026-03-20T10:00:00Z"
}
```

---

### `GET /api/v1/tasks/{task_id}`

Xem trạng thái của một background task cụ thể.

**Path params**
- `task_id` — UUID của `BackgroundTask` record

**Response 200** — `BackgroundTaskResponse`

| Status | Khi nào |
|--------|---------|
| 404 | Task không tồn tại |

---

## Task catalog

| Function | Trigger | Mô tả |
|---|---|---|
| `ping_task` | Manual (`POST /tasks/ping`) | Trả về "pong", test worker |
| `long_running_task` | Manual | Sleep N giây, giả lập I/O bound |
| `generate_thumbnail_task` | Auto sau upload | Render trang đầu → PNG, lưu vào storage, set `Document.image_thumbnail` |
| `ingest_document_task` | Auto sau upload | Multi-format extraction → chunking → embedding → upsert Qdrant + FTS |

---

## Worker

```bash
# Chạy ARQ worker (cần Redis đang chạy)
uv run arq src.worker.settings.WorkerSettings
```

Config: `src/worker/settings.py` — `max_jobs=10`, `job_timeout=300s`.

Context khởi tạo lúc startup (`src/worker/context.py`): `EmbeddingService`, `VectorService` — dùng lại qua toàn bộ jobs, không khởi tạo lại mỗi job.
