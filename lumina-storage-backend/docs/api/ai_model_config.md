# AI Model Config API

Base path: `/api/v1/ai-model-configs`

Quản lý cấu hình các AI model (LLM + embedding) dùng trong hệ thống.

---

## Phân quyền

| Endpoint | Yêu cầu |
|----------|---------|
| `GET /public` | Authenticated user |
| Tất cả endpoints còn lại | Superuser (admin) |

---

## Endpoints

### `GET /api/v1/ai-model-configs/public`

Lấy danh sách model đang active, **không trả về `api_key`**. Dùng cho user chọn model trong chat.

**Query params**

| Param | Type | Mô tả |
|-------|------|-------|
| `purpose` | string | Filter theo mục đích: `chat` hoặc `embedding` |

**Response 200**

```json
[
  {
    "id": "uuid",
    "name": "GPT-4.1 Azure",
    "provider": "azure",
    "model_name": "gpt-4.1",
    "purpose": "chat",
    "base_url": "https://my-resource.openai.azure.com/",
    "extra_config": {"api_version": "2025-01-01-preview"},
    "is_default": true,
    "is_active": true,
    "created_at": "...",
    "updated_at": "..."
  }
]
```

---

### `POST /api/v1/ai-model-configs`

Tạo model config mới.

**Request body**

```json
{
  "name": "GPT-4.1 Azure",
  "provider": "azure",
  "model_name": "gpt-4.1",
  "purpose": "chat",
  "api_key": "sk-...",
  "base_url": "https://my-resource.openai.azure.com/",
  "extra_config": {"api_version": "2025-01-01-preview"},
  "is_default": false
}
```

| Field | Bắt buộc | Mô tả |
|-------|----------|-------|
| `name` | ✓ | Tên hiển thị |
| `provider` | ✓ | `azure` \| `openai` \| `anthropic` \| `google` \| `ollama` |
| `model_name` | ✓ | Tên model/deployment (không cần thêm provider prefix — tự động thêm khi gọi LiteLLM) |
| `purpose` | ✓ | `chat` \| `embedding` |
| `api_key` | — | API key (lưu encrypted, không trả về trong response) |
| `base_url` | — | Custom endpoint (bắt buộc với Azure và Ollama) |
| `extra_config` | — | JSON object: các kwargs bổ sung cho LiteLLM (vd: `api_version`) |
| `is_default` | — | Set làm model mặc định cho purpose này (mặc định `false`) |

**Response 201** — `AIModelConfigResponse`

---

### `GET /api/v1/ai-model-configs`

Lấy toàn bộ model configs (kể cả inactive).

**Response 200** — `AIModelConfigResponse[]`

---

### `GET /api/v1/ai-model-configs/{id}`

Lấy chi tiết một model config.

**Response 200** — `AIModelConfigResponse`

---

### `PATCH /api/v1/ai-model-configs/{id}`

Cập nhật model config. Chỉ truyền các field cần thay đổi.

**Request body** (tất cả optional)

```json
{
  "name": "GPT-4.1 Azure Production",
  "provider": "azure",
  "model_name": "gpt-4.1",
  "api_key": "new-key",
  "base_url": "https://...",
  "extra_config": {"api_version": "2025-01-01-preview"},
  "is_active": true
}
```

> `api_key`: nếu không truyền → giữ nguyên key cũ.

**Response 200** — `AIModelConfigResponse`

---

### `DELETE /api/v1/ai-model-configs/{id}`

Xóa model config. **Không cho xóa model đang là default.**

**Response 204** — No content

**Response 400** nếu là default:

```json
{"detail": "Cannot delete the default model config"}
```

---

### `PATCH /api/v1/ai-model-configs/{id}/set-default`

Đặt model này làm default cho purpose của nó. Model default cũ sẽ bị unset.

**Response 200** — `AIModelConfigResponse`

---

### `POST /api/v1/ai-model-configs/test`

Test kết nối với một model config (gửi prompt đơn giản "Say 'ok' in one word").

**Request body**

```json
{
  "model_name": "gpt-4.1",
  "provider": "azure",
  "api_key": "sk-...",
  "base_url": "https://my-resource.openai.azure.com/",
  "extra_config": {"api_version": "2025-01-01-preview"},
  "config_id": "uuid"
}
```

> `config_id`: nếu truyền và `api_key` để trống → tự động load `api_key` đã lưu từ DB.

**Response 200**

```json
{
  "success": true,
  "message": "Connection successful",
  "response_preview": "ok"
}
```

```json
{
  "success": false,
  "message": "AuthenticationError: Invalid API key",
  "response_preview": null
}
```

---

## Provider — LiteLLM model string

Backend tự động thêm prefix khi gọi LiteLLM. User chỉ cần nhập `model_name` thuần:

| Provider | `model_name` nhập | LiteLLM string thực tế |
|----------|-------------------|----------------------|
| `openai` | `gpt-4o` | `gpt-4o` |
| `azure` | `gpt-4.1` | `azure/gpt-4.1` |
| `anthropic` | `claude-3-5-sonnet-20241022` | `anthropic/claude-3-5-sonnet-20241022` |
| `google` | `gemini-2.0-flash` | `gemini/gemini-2.0-flash` |
| `ollama` | `llama3` | `ollama/llama3` |

## Config theo provider

### Azure OpenAI
```json
{
  "provider": "azure",
  "model_name": "<deployment-name>",
  "api_key": "<azure-api-key>",
  "base_url": "https://<resource>.openai.azure.com/",
  "extra_config": {"api_version": "2025-01-01-preview"}
}
```

### OpenAI
```json
{
  "provider": "openai",
  "model_name": "gpt-4o",
  "api_key": "sk-..."
}
```

### Anthropic
```json
{
  "provider": "anthropic",
  "model_name": "claude-3-5-sonnet-20241022",
  "api_key": "sk-ant-..."
}
```

### Google Gemini
```json
{
  "provider": "google",
  "model_name": "gemini-2.0-flash",
  "api_key": "<google-ai-studio-key>"
}
```

### Ollama (local)
```json
{
  "provider": "ollama",
  "model_name": "llama3",
  "base_url": "http://localhost:11434"
}
```
