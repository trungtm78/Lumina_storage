# Storage Config API

Base path: `/api/v1/storage`

Quản lý cấu hình storage backend (S3, GCS, local, v.v.). Có hai loại config:
- **System config** — dùng chung toàn hệ thống, chỉ superuser quản lý
- **User config** — riêng của từng user, user tự quản lý

---

## Schemas

### `StorageConfigResponse`

```json
{
  "id": "uuid",
  "name": "S3 Production",
  "backend_type": "s3",
  "config": {
    "bucket": "my-bucket",
    "region": "ap-southeast-1"
  },
  "is_default": true,
  "is_active": true,
  "owner_id": null,
  "created_at": "2026-03-19T10:00:00Z",
  "updated_at": "2026-03-19T10:00:00Z"
}
```

> `owner_id = null` → system config; `owner_id = <uuid>` → user config.

---

## Admin Endpoints

> Yêu cầu superuser (`is_superuser = true`).

### `POST /api/v1/storage/configs`

Tạo system storage config mới.

**Request body**

```json
{
  "name": "S3 Production",
  "backend_type": "s3",
  "config": {
    "bucket": "my-bucket",
    "region": "ap-southeast-1",
    "access_key": "...",
    "secret_key": "..."
  },
  "is_default": false
}
```

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `name` | `string` | ✅ | Tên config |
| `backend_type` | `string` | ✅ | Loại storage: `s3`, `gcs`, `local`, ... |
| `config` | `object` | ❌ | Thông số kết nối tương ứng với backend |
| `is_default` | `bool` | ❌ | Đặt làm config mặc định (mặc định `false`) |

**Response 201** — `StorageConfigResponse`

---

### `GET /api/v1/storage/configs`

Lấy danh sách tất cả system storage config.

**Response 200** — `StorageConfigResponse[]`

---

### `PATCH /api/v1/storage/configs/{config_id}`

Cập nhật system storage config.

**Path params**
- `config_id` — UUID của config

**Request body** (tất cả fields đều optional)

```json
{
  "name": "S3 Staging",
  "backend_type": "s3",
  "config": { "bucket": "staging-bucket" },
  "is_active": false
}
```

**Response 200** — `StorageConfigResponse`

**Errors**

| Status | Khi nào |
|--------|---------|
| 404 | Config không tồn tại |

---

### `DELETE /api/v1/storage/configs/{config_id}`

Xoá system storage config.

**Path params**
- `config_id` — UUID của config

**Response 204** — No content

**Errors**

| Status | Khi nào |
|--------|---------|
| 404 | Config không tồn tại |

---

### `POST /api/v1/storage/configs/{config_id}/set-default`

Đặt một system config làm mặc định (bỏ default của config cũ nếu có).

**Path params**
- `config_id` — UUID của config

**Response 200** — `StorageConfigResponse`

**Errors**

| Status | Khi nào |
|--------|---------|
| 404 | Config không tồn tại |

---

## User Endpoints

> Yêu cầu `Authorization: Bearer <access_token>`. User chỉ thao tác được config của chính mình.

### `POST /api/v1/storage/my-configs`

Tạo personal storage config cho user hiện tại.

**Request body**

```json
{
  "name": "My GCS Bucket",
  "backend_type": "gcs",
  "config": {
    "bucket": "my-personal-bucket",
    "project": "my-project"
  }
}
```

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `name` | `string` | ✅ | Tên config |
| `backend_type` | `string` | ✅ | Loại storage |
| `config` | `object` | ❌ | Thông số kết nối |

**Response 201** — `StorageConfigResponse`

---

### `GET /api/v1/storage/my-configs`

Lấy danh sách personal storage config của user hiện tại.

**Response 200** — `StorageConfigResponse[]`

---

### `PATCH /api/v1/storage/my-configs/{config_id}`

Cập nhật personal storage config.

**Path params**
- `config_id` — UUID của config

**Request body** (tất cả fields đều optional)

```json
{
  "name": "My Updated Config",
  "config": { "bucket": "new-bucket" },
  "is_active": true
}
```

**Response 200** — `StorageConfigResponse`

**Errors**

| Status | Khi nào |
|--------|---------|
| 403 | Không phải owner |
| 404 | Config không tồn tại |

---

### `DELETE /api/v1/storage/my-configs/{config_id}`

Xoá personal storage config.

**Path params**
- `config_id` — UUID của config

**Response 204** — No content

**Errors**

| Status | Khi nào |
|--------|---------|
| 403 | Không phải owner |
| 404 | Config không tồn tại |
