# Chat API (RAG)

Base path: `/api/v1/chat`

Tất cả endpoints yêu cầu `Authorization: Bearer <access_token>`.

---

## Endpoints

### `POST /api/v1/chat/sessions`

Tạo chat session mới.

**Request body**

```json
{
  "title": "Hỏi về hợp đồng Q1"
}
```

> `title` là optional. Nếu không truyền, title được tự động sinh bởi LLM sau tin nhắn đầu tiên.

**Response 201**

```json
{
  "id": "uuid",
  "user_id": "uuid",
  "title": null,
  "created_at": "2026-03-19T10:00:00Z",
  "updated_at": "2026-03-19T10:00:00Z"
}
```

---

### `GET /api/v1/chat/sessions`

Lấy danh sách sessions của user hiện tại, sắp xếp mới nhất trước. **Có pagination.**

**Query params**

| Param | Type | Default | Mô tả |
|-------|------|---------|-------|
| `limit` | int | 20 | Số lượng sessions mỗi trang (max 100) |
| `offset` | int | 0 | Vị trí bắt đầu |

**Response 200**

```json
{
  "items": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "title": "Hỏi về hợp đồng Q1",
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "has_more": true
}
```

---

### `DELETE /api/v1/chat/sessions/{session_id}`

Xóa session và toàn bộ messages (cascade).

**Response 204** — No content

---

### `PATCH /api/v1/chat/sessions/{session_id}`

Đổi tên session.

**Request body**

```json
{
  "title": "Tên mới"
}
```

**Response 200** — `SessionResponse`

---

### `GET /api/v1/chat/sessions/{session_id}/messages`

Lấy lịch sử tin nhắn, sắp xếp theo thứ tự thời gian (cũ nhất trước). **Có cursor pagination.**

**Query params**

| Param | Type | Default | Mô tả |
|-------|------|---------|-------|
| `limit` | int | 50 | Số lượng messages (max 200) |
| `before` | uuid | — | Cursor: load messages **trước** message có ID này (load older) |

**Response 200**

```json
{
  "items": [
    {
      "id": "uuid",
      "session_id": "uuid",
      "role": "user",
      "content": "tóm tắt tài liệu",
      "model_used": null,
      "created_at": "..."
    },
    {
      "id": "uuid",
      "session_id": "uuid",
      "role": "assistant",
      "content": "Tài liệu đề cập đến...",
      "model_used": "azure/gpt-4.1",
      "created_at": "..."
    }
  ],
  "has_more": false
}
```

**Pagination pattern (load older messages):**

```
# Load lần đầu (latest 50)
GET /messages?limit=50

# Load older (before message đầu tiên trong list)
GET /messages?limit=50&before=<items[0].id>
```

**`role` values:** `user` | `assistant`

---

### `POST /api/v1/chat/sessions/{session_id}/messages`

Gửi tin nhắn và nhận phản hồi qua **SSE stream**.

**Request body**

```json
{
  "content": "tóm tắt tài liệu",
  "document_ids": ["uuid1", "uuid2"],
  "model_id": "uuid"
}
```

| Field | Bắt buộc | Mô tả |
|-------|----------|-------|
| `content` | ✓ | Nội dung tin nhắn |
| `document_ids` | — | Filter Qdrant search theo document. Nếu null → tìm toàn bộ |
| `model_id` | — | UUID của `AIModelConfig`. Nếu null → dùng model mặc định từ settings |

**Response** — `text/event-stream` (Claude-style SSE)

```
event: message_start
data: {"type": "message_start"}

event: content_block_start
data: {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Tài liệu "}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "đề cập đến..."}}

event: content_block_stop
data: {"type": "content_block_stop", "index": 0}

event: message_delta
data: {"type": "message_delta", "delta": {"stop_reason": "end_turn"}}

event: message_stop
data: {"type": "message_stop"}
```

**Event types:**

| Event | Ý nghĩa |
|-------|---------|
| `message_start` | Bắt đầu stream |
| `content_block_start` | Bắt đầu block text |
| `content_block_delta` | Fragment text từ LLM (`delta.type = "text_delta"`) |
| `content_block_stop` | Kết thúc block text |
| `message_delta` | Metadata cuối (stop_reason) |
| `message_stop` | Kết thúc stream |

**Stop stream:** Client gửi `AbortSignal` để cancel request bất cứ lúc nào.

---

## RAG pipeline (mỗi lần gửi tin nhắn)

1. Lưu `ChatMessage(role=user)` vào DB
2. Embed câu hỏi bằng LiteLLM `aembedding()`
3. Qdrant `query_points()` top-5, filter theo `document_ids` nếu có
4. Build context string từ các chunk tìm được
5. Load lịch sử hội thoại từ session (Langchain messages)
6. Chọn LLM: nếu `model_id` → load `AIModelConfig` từ DB, build `ChatLiteLLM` với đúng provider prefix; nếu không → dùng default từ settings
7. LCEL chain: `prompt | ChatLiteLLM` — stream response
8. Yield từng text chunk qua SSE (Claude-style named events)
9. Sau khi stream xong: lưu `ChatMessage(role=assistant)` + `ChatMessageSource` cho mỗi chunk nguồn
10. Nếu session chưa có title → auto-generate bằng LLM (non-streaming, max 8 từ)

**System prompt:**

```
Bạn là trợ lý AI hỗ trợ tìm kiếm và phân tích tài liệu.

Context từ tài liệu liên quan:
{context}

Hãy trả lời dựa vào context. Nếu context không đủ, hãy nói rõ.
```

---

## Ví dụ flow hoàn chỉnh

```bash
# 1. Tạo session
POST /api/v1/chat/sessions
{"title": "Review hợp đồng"}
→ {"id": "sess-uuid", ...}

# 2. Gửi câu hỏi (stream)
POST /api/v1/chat/sessions/sess-uuid/messages
{"content": "Điều khoản thanh toán là gì?", "model_id": "model-uuid"}
→ SSE stream (Claude-style events)

# 3. Xem lịch sử
GET /api/v1/chat/sessions/sess-uuid/messages?limit=50
→ {"items": [...], "has_more": false}

# 4. Load older messages
GET /api/v1/chat/sessions/sess-uuid/messages?limit=50&before=<oldest_msg_id>
→ {"items": [...], "has_more": true}

# 5. Đổi tên session
PATCH /api/v1/chat/sessions/sess-uuid
{"title": "Review hợp đồng Q1 2026"}

# 6. Xóa session
DELETE /api/v1/chat/sessions/sess-uuid
→ 204
```
