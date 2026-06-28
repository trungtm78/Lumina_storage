# User & Group Management API

Base path: `/api/v1`

Tất cả endpoints yêu cầu `Authorization: Bearer <access_token>`.
Endpoints đánh dấu **[superuser]** từ chối request nếu `is_superuser = false`.

---

## Users

### GET /users `[superuser]`

Danh sách toàn bộ users, có phân trang.

**Query params**

| Param | Default | Mô tả |
|-------|---------|-------|
| `page` | 1 | Trang (≥ 1) |
| `page_size` | 20 | Số item mỗi trang (1–100) |

**Response 200**

```json
{
  "items": [ { ...UserResponse } ],
  "total": 42,
  "page": 1,
  "page_size": 20
}
```

---

### GET /users/{user_id}

Lấy thông tin một user. Mọi user đã đăng nhập đều xem được.

**Response 200** — `UserResponse`

---

### PATCH /users/{user_id}

Cập nhật user. User thường chỉ sửa được `full_name`, `avatar` của chính mình.
Superuser có thể sửa thêm `email`, `is_active`, `is_staff`, `is_superuser` của bất kỳ ai.

**Request body**

```json
{
  "full_name": "New Name",
  "avatar": "https://...",
  "is_active": true,
  "is_staff": false,
  "is_superuser": false,
  "email": "new@example.com"
}
```

> Tất cả fields đều optional. Non-superuser gửi `is_active` / `is_staff` / `is_superuser` / `email` sẽ bị bỏ qua.

**Response 200** — `UserResponse`

**Errors**

| Status | Khi nào |
|--------|---------|
| 403 | Cố sửa user khác mà không phải superuser |
| 404 | User không tồn tại |

---

### DELETE /users/{user_id} `[superuser]`

Deactivate user (`is_active = false`). Không xoá record.

**Response 204** (no body)

**Errors**

| Status | Khi nào |
|--------|---------|
| 403 | Cố deactivate chính mình |
| 404 | User không tồn tại |

---

## Groups

### GET /groups

Danh sách groups, có phân trang.

**Query params** — giống `/users`.

**Response 200**

```json
{
  "items": [ { ...GroupResponse } ],
  "total": 5,
  "page": 1,
  "page_size": 20
}
```

---

### GET /groups/{group_id}

Lấy thông tin một group.

**Response 200** — `GroupResponse`

---

### POST /groups `[superuser]`

Tạo group mới.

**Request body**

```json
{
  "name": "editors",
  "description": "Document editors"
}
```

**Response 201** — `GroupResponse`

**Errors** — 409 nếu tên đã tồn tại.

---

### PATCH /groups/{group_id} `[superuser]`

Cập nhật group.

**Request body** — tất cả optional: `name`, `description`.

**Response 200** — `GroupResponse`

---

### DELETE /groups/{group_id} `[superuser]`

Xoá group (cascade xoá memberships).

**Response 204**

---

### POST /groups/{group_id}/members `[superuser]`

Thêm user vào group.

**Request body**

```json
{ "user_id": "<uuid>" }
```

**Response 204**

**Errors** — 404 nếu group/user không tồn tại; 409 nếu đã là member.

---

### DELETE /groups/{group_id}/members/{user_id} `[superuser]`

Xoá user khỏi group.

**Response 204**

**Errors** — 404 nếu user không phải member.

---

## Permissions

### GET /permissions

Lấy toàn bộ features kèm permissions. Dùng để render checkbox matrix trên UI.

**Response 200** — `FeatureWithPermissionsResponse[]`

```json
[
  {
    "id": 1,
    "code": "document",
    "name": "Document Management",
    "permissions": [
      { "id": 1, "feature_code": "document", "action": "create", "codename": "document.create", "name": "Create Document Management" },
      { "id": 2, "feature_code": "document", "action": "read",   "codename": "document.read",   "name": "Read Document Management" },
      { "id": 3, "feature_code": "document", "action": "update", "codename": "document.update", "name": "Update Document Management" },
      { "id": 4, "feature_code": "document", "action": "delete", "codename": "document.delete", "name": "Delete Document Management" }
    ]
  }
]
```

> Action hợp lệ: `create` | `read` | `update` | `delete` — do DB check constraint `users_permission_action_check`.

---

### GET /groups/{group_id}/permissions

Lấy danh sách permission ID đã được gán cho group.

**Response 200** — `number[]`

```json
[1, 3, 7]
```

**Errors** — 404 nếu group không tồn tại.

---

### PUT /groups/{group_id}/permissions `[superuser]`

Gán (replace toàn bộ) permissions cho group. Xoá tất cả permissions cũ rồi insert lại.

**Request body**

```json
{ "permission_ids": [1, 3, 7] }
```

**Response 204** (no body)

**Errors** — 404 nếu group không tồn tại.

---

## Response schemas

### UserResponse

```json
{
  "id": "uuid",
  "username": "string",
  "email": "string",
  "full_name": "string",
  "avatar": "string | null",
  "is_active": true,
  "is_staff": false,
  "is_superuser": false,
  "last_login": "datetime | null",
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

### GroupResponse

```json
{
  "id": "uuid",
  "name": "string",
  "description": "string | null",
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

### PermissionResponse

```json
{
  "id": 1,
  "feature_code": "document",
  "action": "create",
  "codename": "document.create",
  "name": "Create Document Management"
}
```

> `action` ∈ `{ create, read, update, delete }`

### FeatureWithPermissionsResponse

```json
{
  "id": 1,
  "code": "document",
  "name": "Document",
  "permissions": [ { ...PermissionResponse } ]
}
```
