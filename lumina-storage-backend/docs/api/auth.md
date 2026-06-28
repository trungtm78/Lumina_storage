# Auth API

Base path: `/api/v1/auth`

---

## Cookie `refresh_token`

| Thuộc tính | Giá trị | Lý do |
|------------|---------|-------|
| `HttpOnly` | `true` | JS không đọc được, chống XSS |
| `Secure` | `true` | Chỉ gửi qua HTTPS |
| `SameSite` | `None` | Bắt buộc để browser gửi cookie cross-origin (FE và BE khác domain) |
| `Path` | `/` | Gửi kèm mọi request |
| `Max-Age` | `REFRESH_TOKEN_EXPIRE_DAYS * 86400` (default 7 ngày) | |

> **Lưu ý:** `SameSite=None` bắt buộc phải đi kèm `Secure=true`. Thiếu một trong hai thì `withCredentials: true` bên FE cũng vô dụng.

---

## Khi nào cookie bị clear

| Tình huống | Hành động |
|------------|-----------|
| `POST /login` | Clear cookie cũ → set cookie mới (tránh giữ token của account cũ) |
| `POST /refresh` thành công | Set cookie mới (token rotation) |
| `POST /refresh` thất bại (401) | Clear cookie → FE redirect về login |
| `POST /logout` | Clear cookie |

---

## Luồng hoạt động

### 1. Login
```
FE gửi username + password
→ BE xác thực
→ Trả access_token trong body (30 phút)
→ Set refresh_token vào HttpOnly cookie (7 ngày)
```

### 2. Gọi API bình thường
```
FE gửi request + Header: Authorization: Bearer <access_token>
→ BE validate access_token
→ Trả data
```

### 3. Access token hết hạn
```
FE nhận 401
→ FE tự gọi POST /auth/refresh (browser tự gửi cookie kèm theo)
→ BE đọc refresh_token từ cookie, validate
→ Trả access_token mới + set refresh_token mới vào cookie (rotation)
→ FE retry request cũ với access_token mới
```

### 4. Refresh token hết hạn / invalid
```
FE gọi POST /auth/refresh
→ BE trả 401 + clear cookie
→ FE redirect về trang login
```

### 5. Logout
```
FE gọi POST /auth/logout
→ BE clear cookie refresh_token
→ FE xóa access_token khỏi memory
```

---

## Endpoints

### POST /register

Tạo tài khoản mới.

**Request body**

```json
{
  "username": "john_doe",
  "email": "john@example.com",
  "password": "s3cr3t!",
  "full_name": "John Doe"
}
```

**Response 201**

```json
{
  "id": "uuid",
  "username": "john_doe",
  "email": "john@example.com",
  "full_name": "John Doe",
  "avatar": null,
  "is_active": true,
  "is_staff": false,
  "is_superuser": false,
  "last_login": null,
  "created_at": "2026-03-19T00:00:00Z",
  "updated_at": "2026-03-19T00:00:00Z"
}
```

**Errors**

| Status | Khi nào |
|--------|---------|
| 409 | Username hoặc email đã tồn tại |
| 422 | Validation lỗi (email không hợp lệ, ...) |

---

### POST /login

Đăng nhập. Trả `access_token` trong body, set `refresh_token` vào cookie.

**Request body**

```json
{
  "username": "john_doe",
  "password": "s3cr3t!"
}
```

> `username` chấp nhận cả username lẫn email.

**Response 200**

```json
{
  "access_token": "<jwt>",
  "token_type": "bearer"
}
```

**Set-Cookie**

```
refresh_token=<jwt>; HttpOnly; Secure; Path=/; Max-Age=604800; SameSite=None
```

**Errors**

| Status | Khi nào |
|--------|---------|
| 401 | Sai credentials hoặc account inactive |

---

### POST /refresh

Lấy `access_token` mới. Đọc `refresh_token` từ cookie, set cookie mới.

> Không cần request body. Cookie `refresh_token` được browser tự gửi kèm.

**Response 200**

```json
{
  "access_token": "<jwt>",
  "token_type": "bearer"
}
```

**Set-Cookie** — cookie `refresh_token` mới được set (rotation).

**Errors**

| Status | Khi nào |
|--------|---------|
| 401 | Cookie không có, token không hợp lệ hoặc hết hạn → cookie bị clear |

---

### POST /logout

Xóa cookie `refresh_token`.

**Response 204** — No content.

---

### GET /me

Lấy thông tin user đang đăng nhập.

**Headers**

```
Authorization: Bearer <access_token>
```

**Response 200** — giống `/register` response.

**Errors**

| Status | Khi nào |
|--------|---------|
| 401 | Token không hợp lệ hoặc hết hạn |

---

## Token format

Cả hai token đều là JWT HS256. Payload:

```json
{
  "sub": "<user_uuid>",
  "type": "access" | "refresh",
  "exp": "<unix_timestamp>"
}
```

- **access token**: expire = `ACCESS_TOKEN_EXPIRE_MINUTES` (default 30 phút), truyền qua `Authorization: Bearer`
- **refresh token**: expire = `REFRESH_TOKEN_EXPIRE_DAYS` (default 7 ngày), lưu trong HttpOnly cookie

---

## Yêu cầu phía Frontend

```js
// Mọi request đều cần withCredentials để browser gửi cookie
fetch(url, { credentials: "include" })

// axios
axios.defaults.withCredentials = true
```

---

## Sử dụng dependency `get_current_user`

```python
from src.api.deps import CurrentUser

@router.get("/something")
async def something(current_user: CurrentUser):
    ...
```
