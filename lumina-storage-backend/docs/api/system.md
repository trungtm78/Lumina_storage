# System Config API

Base path: `/api/v1/system`

Quản lý các config key-value toàn hệ thống. Config có thể public (client đọc được không cần auth) hoặc private (chỉ admin).

---

## Schemas

### `SystemConfigResponse`

```json
{
  "id": 1,
  "key": "max_upload_size_mb",
  "value": 100,
  "description": "Giới hạn kích thước file upload (MB)",
  "is_public": true,
  "updated_at": "2026-03-19T10:00:00Z",
  "updated_by_id": "uuid"
}
```

### `PublicConfigResponse`

```json
{
  "key": "max_upload_size_mb",
  "value": 100
}
```

---

## Public Endpoints

> Không cần authentication.

### `GET /api/v1/system/configs/public`

Lấy danh sách tất cả config có `is_public = true`.

**Response 200** — `PublicConfigResponse[]`

```json
[
  { "key": "max_upload_size_mb", "value": 100 },
  { "key": "allowed_mime_types", "value": ["application/pdf", "image/png"] }
]
```

---

## Admin Endpoints

> Yêu cầu superuser (`is_superuser = true`).

### `GET /api/v1/system/configs`

Lấy danh sách tất cả system config (kể cả private).

**Response 200** — `SystemConfigResponse[]`

---

### `GET /api/v1/system/configs/{key}`

Lấy chi tiết một config theo key.

**Path params**
- `key` — string key của config (e.g. `max_upload_size_mb`)

**Response 200** — `SystemConfigResponse`

**Errors**

| Status | Khi nào |
|--------|---------|
| 404 | Key không tồn tại |

---

### `POST /api/v1/system/configs`

Tạo system config mới.

**Request body**

```json
{
  "key": "max_upload_size_mb",
  "value": 100,
  "description": "Giới hạn kích thước file upload (MB)",
  "is_public": true
}
```

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `key` | `string` | ✅ | Key định danh, unique |
| `value` | `any` | ✅ | Giá trị (JSON: string, number, boolean, array, object) |
| `description` | `string` | ❌ | Mô tả config |
| `is_public` | `bool` | ❌ | Cho phép public đọc (mặc định `false`) |

**Response 201** — `SystemConfigResponse`

**Errors**

| Status | Khi nào |
|--------|---------|
| 409 | Key đã tồn tại |

---

### `PATCH /api/v1/system/configs/{key}`

Cập nhật system config.

**Path params**
- `key` — string key của config

**Request body** (tất cả fields đều optional)

```json
{
  "value": 200,
  "description": "Updated description",
  "is_public": false
}
```

**Response 200** — `SystemConfigResponse`

**Errors**

| Status | Khi nào |
|--------|---------|
| 404 | Key không tồn tại |

---

### `DELETE /api/v1/system/configs/{key}`

Xoá system config.

**Path params**
- `key` — string key của config

**Response 204** — No content

**Errors**

| Status | Khi nào |
|--------|---------|
| 404 | Key không tồn tại |
