# Folders API

Base path: `/api/v1/folders`

Tất cả endpoints yêu cầu `Authorization: Bearer <access_token>`. User chỉ thao tác được với folder của chính mình.

---

## Schemas

### `FolderResponse`

```json
{
  "id": "uuid",
  "name": "My Folder",
  "parent_id": null,
  "path": "/My Folder",
  "owner_id": "uuid",
  "created_at": "2026-03-19T10:00:00Z",
  "updated_at": "2026-03-19T10:00:00Z"
}
```

---

## Endpoints

### `POST /api/v1/folders`

Tạo folder mới.

**Request body**

```json
{
  "name": "My Folder",
  "parent_id": null
}
```

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `name` | `string` | ✅ | Tên folder |
| `parent_id` | `UUID` | ❌ | UUID folder cha (null = root) |

**Response 201** — `FolderResponse`

**Errors**

| Status | Khi nào |
|--------|---------|
| 404 | `parent_id` không tồn tại hoặc không thuộc sở hữu của user |

---

### `GET /api/v1/folders`

Lấy danh sách folder của user hiện tại.

**Query params**

| Param | Type | Mô tả |
|-------|------|-------|
| `parent_id` | `UUID` | Lọc theo folder cha (bỏ qua để lấy tất cả) |

**Response 200** — `FolderResponse[]`

---

### `GET /api/v1/folders/{folder_id}`

Lấy chi tiết một folder.

**Path params**
- `folder_id` — UUID của folder

**Response 200** — `FolderResponse`

**Errors**

| Status | Khi nào |
|--------|---------|
| 403 | Không phải owner |
| 404 | Folder không tồn tại |

---

### `DELETE /api/v1/folders/{folder_id}`

Xoá folder. Folder phải rỗng (không có document hoặc sub-folder).

**Path params**
- `folder_id` — UUID của folder

**Response 204** — No content

**Errors**

| Status | Khi nào |
|--------|---------|
| 403 | Không phải owner |
| 404 | Folder không tồn tại |
