# Deployment Guide

Tài liệu này là hướng dẫn deploy cho khách hàng tự triển khai. Luồng mặc định là **FE-first**: sau khi backend chạy, thao tác cấu hình và vận hành thường ngày đều thực hiện trên frontend, không yêu cầu người dùng chạy `curl`.

Tài liệu này giả định bạn deploy bằng Docker và Docker Compose. Đây là cách triển khai được hỗ trợ cho khách hàng.

## Mục tiêu

1. Đưa hệ thống lên production một cách an toàn.
2. Đổi mật khẩu admin mặc định ngay lần đầu.
3. Cấu hình đủ `LLM Models` và `Storage` trên FE.
4. Verify upload và ingest end-to-end.

## Yêu cầu hệ thống

| Thành phần | Phiên bản tối thiểu |
|------------|---------------------|
| Python | 3.11+ |
| uv | 0.4+ |
| PostgreSQL | 14+ |
| Redis | 7+ |
| Qdrant | 1.9+ |
| Docker & Docker Compose | bắt buộc cho deploy |
| libmagic | required trong production |

## Trước khi bắt đầu

1. Đảm bảo đã có PostgreSQL, Redis, Qdrant và một provider LLM có cả chat model lẫn embedding model.
2. Nếu dùng managed PostgreSQL, DBA cần bật extension `unaccent` một lần bằng superuser.
3. Frontend của hệ thống phải truy cập được, vì đây là nơi cấu hình admin diễn ra.

## Bật extension PostgreSQL `unaccent`

Hệ thống dùng `unaccent` để search tiếng Việt không dấu. Extension này phải có trong database trước khi chạy migration.

### Cách cài

Chạy với tài khoản superuser hoặc DBA role có quyền tạo extension:

```sql
\c <ten_database>
CREATE EXTENSION IF NOT EXISTS unaccent;
```

Ví dụ:

```sql
\c lumina_driver_prod
CREATE EXTENSION IF NOT EXISTS unaccent;
```

### Cách kiểm tra

```sql
SELECT extname FROM pg_extension WHERE extname = 'unaccent';
SELECT unaccent('Hợp đồng');
```

Kết quả mong đợi của câu lệnh thứ hai là `Hop dong`.

### Lưu ý cho managed PostgreSQL

Nếu đang dùng RDS, Cloud SQL, Supabase, Neon, hoặc hệ thống tương tự, user ứng dụng thường không có quyền `CREATE EXTENSION`. Trong trường hợp đó:

1. Yêu cầu DBA hoặc tài khoản admin của DB chạy câu lệnh ở trên.
2. Không cần và không nên thử tạo extension bằng app user.
3. Sau khi extension đã có, mới chạy `uv run alembic upgrade head`.

## Quy trình deploy

### 1. Clone repo và cấu hình môi trường

```bash
git clone <repo-url>
cd lumina-driver-backend
cp .env.example .env
```

Trong `.env`, tối thiểu cần chú ý:

```env
APP_ENV=production
SECRET_KEY=<random-string-32-chars-minimum>
CORS_ORIGINS=["https://drive.lumina.yourdomain.com"]
```

### 2. Chạy migration

```bash
uv sync
uv run alembic upgrade head
```

Migration sẽ tạo schema, seed admin mặc định, và backfill dữ liệu cần thiết cho tìm kiếm tiếng Việt.

### 3. Khởi động services

```bash
docker compose up --build -d
```

Deploy theo tài liệu này luôn dùng Docker Compose để chạy app, worker, Redis và Gotenberg.

### 4. Đăng nhập admin trên FE

Tài khoản mặc định:

| Field | Value |
| ----- | ----- |
| Username | `admin` |
| Email | `admin@lumina.com` |
| Password | `Admin@123` |

Thao tác:

1. Mở frontend của hệ thống.
2. Đăng nhập bằng `admin / Admin@123`.
3. Đổi mật khẩu ngay khi được yêu cầu.
4. Xác nhận tài khoản admin đã vào được giao diện quản trị bình thường.

### 5. Cấu hình AI model trên FE

Vào `Settings → LLM Models` và tạo tối thiểu 2 cấu hình:

| Purpose | Is default | Mục đích |
| ------- | ---------- | -------- |
| `chat` | `true` | Chat, agent skills, generator, review, VLM extraction |
| `embedding` | `true` | RAG search, ingest tài liệu |

Lưu ý:

1. Embedding model phải khớp `QDRANT_VECTOR_SIZE` (ví dụ: `3072` như trong `.env`).
2. Hệ thống không có env-var fallback cho AI key.
3. Test Connection sẽ báo lỗi nếu dim không khớp `QDRANT_VECTOR_SIZE`.

### 6. Cấu hình Storage trên FE

Vào `Settings → Storage` và tạo ít nhất 1 storage config `is_default=true`.

Khuyến nghị:

1. `Local` cho dev/single-node.
2. `S3` cho production.

Nếu dùng Local Storage, backend mặc định lưu vào thư mục `uploads`. Nếu dùng S3, điền bucket, region, và credentials trong form cấu hình.

### 7. Verify deploy

1. Đăng nhập lại bằng admin đã đổi mật khẩu.
2. Mở `Settings → LLM Models` và xác nhận có đủ 2 model default.
3. Mở `Settings → Storage` và xác nhận có ít nhất 1 storage default.
4. Upload một file thử từ giao diện.
5. Chờ trạng thái ingest hoàn tất và xác nhận file được xử lý thành công.

## Checklist sau deploy

- [ ] `SECRET_KEY` đã đổi khỏi giá trị mặc định.
- [ ] `APP_ENV=production`.
- [ ] Admin password đã đổi khỏi `Admin@123`.
- [ ] `CORS_ORIGINS` chỉ chứa origin frontend thật.
- [ ] Có ít nhất 2 AI configs default: `chat` và `embedding`.
- [ ] Có ít nhất 1 Storage config default.
- [ ] Upload end-to-end chạy qua FE thành công.

## Ghi chú vận hành

1. Nếu cần smoke test kỹ thuật bằng API, dùng Swagger hoặc REST chỉ như công cụ kiểm tra.
2. Khách hàng không nên phải thao tác `curl` cho các bước vận hành thường ngày.
3. Nếu cần tài liệu phát triển nội bộ, xem README và các tài liệu API khác trong `docs/api/`.

## Troubleshooting ngắn

- Không login được admin: kiểm tra migration đã chạy và mật khẩu đã đổi chưa.
- Thiếu AI config: vào `Settings → LLM Models` và tạo đủ `chat` + `embedding`.
- Upload fail vì storage: vào `Settings → Storage` và đặt ít nhất 1 config default.
- Worker không ingest: kiểm tra worker, Redis, và log của backend.
