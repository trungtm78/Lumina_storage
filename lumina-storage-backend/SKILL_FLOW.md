# Luồng hoạt động: Skill Fill System (Điền văn bản tự động qua Chat)

## Tổng quan

Hệ thống cho phép user attach file template (.docx/.xlsx) vào chat, AI tự động đọc nội dung, hỏi thông tin cần điền, rồi áp dụng edits và trả về file đã điền + HTML preview + link download.

Toàn bộ luồng chạy qua **HTTP SSE** (Server-Sent Events) — cùng endpoint với chat thường, không dùng WebSocket.

---

## Kiến trúc tổng thể

```
┌─────────────────── FRONTEND ───────────────────────┐
│                                                     │
│  ChatInput.tsx                                      │
│  ├─ Nút 📎 (paperclip) → mở DocPickerDropdown     │
│  ├─ User chọn file .docx → setAttachedDocument()   │
│  └─ Hiện chip: "[file.docx] SKILL ✕"               │
│                                                     │
│  ChatPage.tsx                                       │
│  ├─ User gõ tin nhắn + Enter                        │
│  ├─ handleSendMessage()                             │
│  │   ├─ Nếu attachedDocument → thêm skill_document_id vào payload │
│  │   ├─ POST /chat/sessions/{id}/messages (SSE)     │
│  │   ├─ Nhận SSE events:                            │
│  │   │   ├─ content_block_delta → hiện text streaming│
│  │   │   ├─ skill_done → setSkillResult()           │
│  │   │   └─ message_stop → kết thúc                 │
│  │   └─ invalidateQueries → reload messages từ DB   │
│  │                                                   │
│  └─ SkillResultBanner.tsx                            │
│      ├─ Banner xanh: "Document filled successfully"  │
│      ├─ Nút [Preview] → toggle HTML preview          │
│      ├─ Nút [Download] → tải file .docx đã điền     │
│      └─ Nút [Dismiss] → ẩn banner + xóa attachment   │
│                                                     │
└─────────────────────────────────────────────────────┘
          │
          │  POST /api/v1/chat/sessions/{session_id}/messages
          │  Body: { content, skill_document_id, model_id }
          │  Response: text/event-stream (SSE)
          ▼
┌─────────────────── BACKEND ────────────────────────┐
│                                                     │
│  Route: chat.py → send_message()                    │
│  ├─ Kiểm tra body.skill_document_id                 │
│  │   ├─ Có → skill_event_stream() (skill mode)      │
│  │   └─ Không → event_stream() (RAG chat thường)    │
│  │                                                   │
│  └─ skill_event_stream() generator                   │
│      ├─ Emit: message_start                          │
│      ├─ Emit: content_block_start                    │
│      ├─ async for event in stream_skill_answer():    │
│      │   ├─ event.text → emit content_block_delta    │
│      │   └─ event.skill_done → emit skill_done       │
│      ├─ Emit: content_block_stop                     │
│      └─ Emit: message_stop                           │
│                                                     │
│  ChatService.stream_skill_answer()                   │
│  (12 bước — xem chi tiết bên dưới)                   │
│                                                     │
│  SkillService                                        │
│  ├─ detect(ext) → tìm skill phù hợp                 │
│  ├─ run_tool(skill, tool_name, args, ctx)            │
│  └─ resolve_model(db, settings, model_id)            │
│                                                     │
│  skills/                                             │
│  ├─ docx-form-fill/                                  │
│  │   ├─ SKILL.md (instructions cho AI)               │
│  │   └─ tools/                                       │
│  │       ├─ parse_document.py (auto-called)          │
│  │       └─ apply_edits.py (LLM tool)                │
│  └─ xlsx-form-fill/                                  │
│      ├─ SKILL.md                                     │
│      └─ tools/                                       │
│          ├─ parse_document.py                        │
│          └─ apply_edits.py                           │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## Chi tiết luồng xử lý

### Bước 0: User attach file template

```
ChatInput.tsx:
  User click 📎 → DocPickerDropdown hiện ra
  → Fetch GET /documents?extensions=.docx,.xlsx (lọc file template)
  → User click chọn file → onAttachSkillDocument(doc)
  → State: attachedDocument = { id, original_filename, ... }
  → Hiện chip: "[1C Việt Nam] Mẫu hợp đồng.docx | SKILL | ✕"
```

### Bước 1: User gửi tin nhắn (Turn 1 — AI phân tích)

**Frontend:**
```
ChatPage.handleSendMessage():
  1. message = "Tôi muốn điền thông tin vào hợp đồng này"
  2. attachedDocument != null → payload = {
       content: message,
       skill_document_id: attachedDocument.id,   // ← trigger skill mode
       model_id: selectedModelId
     }
  3. POST /chat/sessions/{session_id}/messages (SSE stream)
  4. Hiển thị streaming text trong chat bubble
```

**Backend (12 bước trong `stream_skill_answer`):**

```
stream_skill_answer(session_id, user_message, user, skill_document_id, model_id):

  ── Bước 1: Load history ──────────────────────────
  history_msgs = get_history(session_id)
  // Load TRƯỚC khi save user message (tránh duplicate)

  ── Bước 2: Save user message ─────────────────────
  ChatMessage(session_id, role="user", content=user_message)
  db.add() → db.flush()

  ── Bước 3: Load document + detect skill ──────────
  doc = db.get(Document, skill_document_id)
  ext = Path(doc.original_filename).suffix  // ".docx"
  skill = SkillService.detect(ext)
  // → SkillDefinition(name="docx-form-fill", triggers={".docx",".doc"})

  ── Bước 4: Auto-call parse_document ──────────────
  // KHÔNG phải LLM tool — chạy tự động mỗi turn
  ctx = SkillContext(db, settings, user)
  parsed = skill_svc.run_tool(skill, "parse_document", {document_id}, ctx)

  parse_document.py:
    1. doc_bytes = ctx.get_document_bytes(document_id)
    2. doc = Document(BytesIO(doc_bytes))
    3. Merge runs trong mỗi paragraph (xử lý Word formatting)
    4. Extract full_text: nối tất cả paragraphs + table cells
    5. Detect blank fields bằng regex:
       - ………… (ellipsis)
       - ___________ (underscore)
       - ----------- (dash)
       - {{field_name}}
    6. Return: {
         "full_text": "CỘNG HÒA XÃ HỘI CHỦ NGHĨA...\nSố: ………/HĐLĐ\n..."  (max 8000 chars),
         "structure": "Phát hiện 32 trường có nhãn cần điền:\n  - Số\n  - BÊN A\n  ..."
       }

  ── Bước 5: Build system prompt ────────────────────
  system_prompt = SKILL.md instructions
    + "\n\n---\n## Nội dung tài liệu\n" + parsed.full_text
    + "\n\n## Cấu trúc / Các trường phát hiện\n" + parsed.structure

  ── Bước 6: Build messages array ───────────────────
  messages = [
    { role: "system", content: system_prompt },
    // ... history từ DB (các turn trước) ...
    { role: "user", content: user_message }   // turn hiện tại
  ]

  ── Bước 7: Build tool schema ──────────────────────
  tools = [{
    type: "function",
    function: {
      name: "apply_edits",
      description: "Apply a list of text edits to the original document...",
      parameters: {
        document_id: { type: "string" },
        edits: [{
          context: { type: "string", description: "Surrounding text" },
          old: { type: "string", description: "Text to replace" },
          new: { type: "string", description: "Replacement" }
        }]
      }
    }
  }]

  ── Bước 8: Resolve model ──────────────────────────
  model_str, api_key, api_base, ... = skill_svc.resolve_model(db, settings, model_id)
  // Ví dụ: ("azure/gpt-4.1-mini", "3u8Pq...", "https://givral...", ...)
  // Hoặc:  ("gemini/gemini-2.5-flash", "AIzaSy...", None, ...)

  ── Bước 9: Stream LLM response ───────────────────
  litellm.api_base = None  // Reset để tránh conflict giữa Azure/Gemini

  // Retry loop (max 3 lần) — Gemini đôi khi trả empty response
  for attempt in range(3):
    response = litellm.acompletion(model, messages, tools, stream=True)

    async for chunk in response:
      if chunk.delta.content:
        yield { type: "text", content: "..." }    // → SSE content_block_delta
      if chunk.delta.tool_calls:
        // Tích lũy tool call arguments (JSON string)
        tool_calls[idx].function.arguments += chunk

    if full_text or tool_calls:
      break  // Có response → dừng retry
    await asyncio.sleep(0.5)  // Empty → chờ rồi retry
```

**Turn 1 kết quả:**
```
AI response (streaming text):
  "Tôi đã phân tích tài liệu. Cần điền các thông tin sau:
   1. Số hợp đồng: ___
   2. Ngày ký: ___
   3. BÊN A (Tên công ty): ___
   4. Đại diện: ___
   ..."

→ SSE events: message_start → content_block_start → content_block_delta (x20) → content_block_stop → message_stop
→ Không có skill_done (AI chưa gọi apply_edits — đang hỏi thông tin)
```

### Bước 2: User cung cấp thông tin + "Xuất file" (Turn 2 — AI điền)

**Frontend:**
```
User gõ:
  "Điền thông tin:
   - Số HĐ: 42/2026/HĐLĐ-TECHVINA
   - Bên A: Công ty TNHH Công nghệ TechVina
   - Đại diện: Nguyễn Văn Lập, Giám đốc
   ...
   Xuất file ngay."

→ Gửi với skill_document_id (vẫn còn attachment)
```

**Backend (stream_skill_answer — tiếp tục):**
```
  Bước 1-8: Giống Turn 1 (load history, parse document, build prompt...)
  // Lần này history có Turn 1 (user + assistant messages)

  ── Bước 9: Stream LLM response ───────────────────
  // AI nhận: system prompt + Turn 1 history + user fill values
  // AI quyết định gọi tool apply_edits (KHÔNG trả text)

  Response stream:
    chunk 1: tool_call { name: "apply_edits", arguments: '{"document_id": "c62f...', ... }
    chunk 2: finish_reason: "tool_calls"

  Kết quả sau streaming:
    full_text = ""  (không có text)
    tool_calls = { 0: { function: { name: "apply_edits", arguments: '{"document_id":"c62f...", "edits": [...]}' } } }

  ── Bước 10: Execute apply_edits ───────────────────
  fn_args = json.loads(tool_calls[0].function.arguments)
  fn_args["document_id"] = str(skill_document_id)  // force dùng doc gốc

  result = skill_svc.run_tool(skill, "apply_edits", fn_args, ctx)
```

**`apply_edits.py` chi tiết:**
```
  Input:
    document_id = "c62fa44c-..."
    edits = [
      { context: "Số: ………………/HĐLĐ",  old: "………………/HĐLĐ",      new: "42/2026/HĐLĐ-TECHVINA" },
      { context: "BÊN A:",             old: "………………………………",    new: "Công ty TNHH Công nghệ TechVina" },
      { context: "Đại diện Ông/Bà:",   old: "………………………………",    new: "Nguyễn Văn Lập" },
      { context: "Mức lương chính:",    old: "…. VNĐ/tháng",     new: "25.000.000 VNĐ/tháng" },
      // ... 18-22 edits tổng cộng
    ]

  Xử lý:
    1. Load file gốc: doc_bytes = ctx.get_document_bytes(document_id)
    2. doc = Document(BytesIO(doc_bytes))

    3. Với mỗi edit {context, old, new}:
       _apply_edit_to_doc(doc, context, old, new):

       ── Pass 1: Exact Match ──────────────────────
       Duyệt tất cả paragraphs (body + tables):
         merge_runs(paragraph)  // nối các text run thành 1
         text = paragraph.text
         if context[:40] in text AND old in text:
           text.replace(old, new, 1)
           → return True ✓

       ── Pass 2: Normalised Match ─────────────────
       // Khi AI gửi sai số lượng …
       // "………………" (AI) vs "…………………………" (doc) → khác nhau
       // Normalize: collapse [.…_-]{2+} → "___"
       if old chứa blank pattern:
         normalise(old) → "___/HĐLĐ"
         normalise(paragraph.text) → "Số: ___/HĐLĐ"
         if normalised old in normalised text:
           Thay longest blank run trong paragraph
           → return True ✓

       ── Pass 3: Context + Longest Blank ──────────
       if context matches paragraph (normalised):
         Tìm blank run dài nhất ([.…_-]{3,})
         Thay blank run đó bằng new
         → return True ✓

       ── Pass 4: Exact old anywhere ───────────────
       Tìm old chính xác trong bất kỳ paragraph nào
       → return True/False

    4. Đếm: applied_count, failed_edits

    5. Save rendered document:
       output = BytesIO() → doc.save(output)
       rendered_id = ctx.save_rendered_document(output.getvalue(), document_id)
       // Tạo Document mới trong DB:
       //   title = "Mẫu hợp đồng_filled"
       //   file_path = "2026/04/{uuid}.docx"
       //   source_metadata = {"source_document_id": original_id}

    6. Generate HTML preview:
       MarkItDown().convert_stream(rendered_bytes)
       → markdown text → escape HTML → wrap in <div>

    7. Return: {
         rendered_document_id: "b04aa9df-...",
         preview_html: "<div style='...'>CỘNG HÒA XÃ HỘI CHỦ NGHĨA...</div>",
         applied_count: 18,
         failed_edits: []
       }
```

**Tiếp tục stream_skill_answer:**
```
  ── Bước 11: Save assistant message ───────────────
  assistant_content = "Đã điền 18 trường vào tài liệu thành công."
  ChatMessage(session_id, role="assistant", content=assistant_content)
  db.commit()

  ── Bước 12: Emit skill_done ──────────────────────
  yield {
    type: "skill_done",
    rendered_document_id: "b04aa9df-...",
    preview_html: "<div>...</div>"
  }

  ── Bước 13: Auto-generate title ──────────────────
  // Nếu session chưa có title → gọi LLM tạo title ngắn
  session.title = _generate_title(user_message, assistant_content)

  ── Bước 14: Restore litellm.api_base ─────────────
```

**SSE events Turn 2:**
```
event: message_start
data: {"type": "message_start"}

event: content_block_start
data: {"type": "content_block_start", "index": 0}

event: skill_done                    ← EVENT MỚI
data: {
  "type": "skill_done",
  "rendered_document_id": "b04aa9df-3e08-41a9-9fd1-a5db186350f1",
  "preview_html": "<div style='font-family:sans-serif;...'>CỘNG HÒA XÃ HỘI...</div>"
}

event: content_block_stop
data: {"type": "content_block_stop", "index": 0}

event: message_stop
data: {"type": "message_stop"}
```

### Bước 3: Frontend hiển thị kết quả

```
ChatPage.tsx:

  for await (const ev of chatApi.sendMessage(sessionId, payload, signal)) {
    if (ev.chunk)     → full += ev.chunk → streamingContent → hiện text bubble
    if (ev.skillDone) → setSkillResult(ev.skillDone)   // ← BẮT SKILL_DONE
    if (ev.done)      → break
  }

  // Cleanup
  setStreamingContent(null)
  setIsStreaming(false)
  queryClient.invalidateQueries(["chat", "messages", sessionId])  // reload messages từ DB

  // Render:
  skillResult != null → hiện SkillResultBanner:
    ┌────────────────────────────────────────────┐
    │ ✓ Document filled successfully              │
    │   Your template has been filled...          │
    │              [Preview] [Download] [Dismiss] │
    ├────────────────────────────────────────────┤
    │ (toggle preview HTML ở đây)                 │
    │ CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM       │
    │ Số: 42/2026/HĐLĐ-TECHVINA                  │
    │ BÊN A: Công ty TNHH Công nghệ TechVina     │
    │ ...                                         │
    └────────────────────────────────────────────┘
```

### Bước 4: User download file

```
SkillResultBanner.handleDownload():
  1. GET /documents/{rendered_document_id}/download
     → Response: blob + Content-Disposition header
  2. Parse filename từ header:
     filename*=UTF-8''M%E1%BA%ABu%20h%E1%BB%A3p%20%C4%91%E1%BB%93ng_filled.docx
     → decode: "Mẫu hợp đồng_filled.docx"
  3. URL.createObjectURL(blob) → trigger download
```

### Bước 5 (Optional): User yêu cầu sửa lại

```
User: "Sửa lại: Bên A = CÔNG TY MỚI. Xuất file lại."

→ Gửi Turn 3 với CÙNG skill_document_id
→ AI gọi apply_edits lại — LẤY FILE GỐC, KHÔNG lấy file đã render
→ Tạo rendered document MỚI (UUID mới)
→ skill_done event mới → Banner cập nhật → Download file mới
```

---

## SSE Event Types

### Skill mode (có skill_document_id):
```
message_start          // Bắt đầu response
content_block_start    // Bắt đầu content block
content_block_delta*   // Text chunks (0 hoặc nhiều)
skill_done?            // Khi apply_edits thành công (0 hoặc 1)
content_block_stop     // Kết thúc content block
message_stop           // Kết thúc response
```

### RAG chat thường (không có skill_document_id):
```
message_start
content_block_start
content_block_delta*   // Text chunks
content_block_stop
message_delta          // stop_reason
message_stop
sources                // Citation sources
```

---

## Cấu trúc Skills

```
skills/
├── docx-form-fill/
│   ├── SKILL.md                    # Metadata + instructions cho AI
│   │   ├── frontmatter:
│   │   │   name: docx-form-fill
│   │   │   triggers: { extensions: [".docx", ".doc"] }
│   │   │   tools: [{ name: apply_edits, ... }]
│   │   └── body: Instructions (3 bước)
│   └── tools/
│       ├── parse_document.py       # Auto-called — extract text + detect blanks
│       └── apply_edits.py          # LLM tool — apply edits + save rendered doc
│
└── xlsx-form-fill/
    ├── SKILL.md                    # Tương tự, cho Excel
    └── tools/
        ├── parse_document.py       # Dùng openpyxl
        └── apply_edits.py          # Cell-based edits
```

### Tool interface:
```python
# Mỗi tool là 1 Python file với hàm run():
async def run(args: dict, ctx: SkillContext) -> dict:
    # args: từ LLM tool call hoặc auto-call
    # ctx: SkillContext (db, settings, user)
    #   ctx.get_document_bytes(document_id) → bytes
    #   ctx.save_rendered_document(data, source_doc_id) → UUID
    return { ... }
```

---

## Edit Matching Algorithm (apply_edits.py)

Khi AI gửi edit `{ context, old, new }`, hệ thống tìm đúng vị trí trong document bằng 4 pass:

```
Pass 1: EXACT MATCH
  ✓ context[:40] tìm thấy trong paragraph text
  ✓ old tìm thấy chính xác trong paragraph text
  → Replace old bằng new

Pass 2: NORMALISED MATCH
  // AI gửi "………………" (8 chars) nhưng doc có "…………………………" (20 chars)
  Collapse tất cả [.…_-]{2+} → "___"
  ✓ normalised(old) tìm thấy trong normalised(paragraph)
  ✓ context matches (normalised)
  → Replace longest blank run trong paragraph

Pass 3: CONTEXT + LONGEST BLANK
  ✓ context matches paragraph (normalised)
  → Tìm blank run dài nhất ([.…_-]{3,}) trong paragraph
  → Replace blank đó bằng new

Pass 4: EXACT OLD ANYWHERE
  ✓ old tìm thấy chính xác trong bất kỳ paragraph nào
  → Replace
```

Ví dụ:
```
Document:  "Điện thoại: ………………………………………………………………………………………"  (30 chars …)
AI sends:  old="…………………………………………………………………………………"  (25 chars …)

Pass 1: MISS (25 ≠ 30 chars)
Pass 2: normalise("…………") → "___", normalise("………………………") → "___" → MATCH ✓
→ Replace blank run (30 chars) bằng "028 3845 1234"
→ Result: "Điện thoại: 028 3845 1234"
```

---

## Error Handling

### Backend:
```python
# Route: try/except bọc toàn bộ skill generator
try:
    async for event in stream_skill_answer(...):
        ...
except Exception as exc:
    yield SSE event: "[ERROR] NotFoundError: litellm.NotFoundError: ..."
# Luôn emit content_block_stop + message_stop (dù có lỗi)
```

### Empty response retry:
```python
# Gemini đôi khi trả empty response (40-60% thời gian)
for _attempt in range(3):
    response = await litellm.acompletion(...)
    async for chunk in response: ...
    if full_text or tool_calls:
        break       # Có response → OK
    await asyncio.sleep(0.5)  # Empty → retry
```

### Frontend:
```typescript
try {
    for await (const ev of chatApi.sendMessage(...)) { ... }
} catch (err) {
    if (err.name !== "AbortError")
        toast.error("Failed to send message")
}
// Cleanup luôn chạy (dù có lỗi)
setIsStreaming(false)
queryClient.invalidateQueries(...)
```

---

## Database Models liên quan

```
ChatSession
  ├─ id (UUID)
  ├─ user_id
  ├─ title (auto-generated)
  └─ messages → ChatMessage[]

ChatMessage
  ├─ id (UUID)
  ├─ session_id → ChatSession
  ├─ role: "user" | "assistant"
  ├─ content: text
  ├─ model_used: "azure/gpt-4.1-mini" | "gemini/gemini-2.5-flash"
  └─ sources → ChatMessageSource[] (chỉ cho RAG chat)

Document
  ├─ id (UUID)
  ├─ title, original_filename
  ├─ file_path: "2026/04/{uuid}.docx"
  ├─ storage_config_id → StorageConfig
  ├─ source_type: "upload"
  └─ source_metadata: { "source_document_id": "..." }  // cho rendered docs

AIModelConfig
  ├─ id (UUID)
  ├─ name: "gpt-4.1-mini" | "gemini-2.5-flash" | "gemini-2.5-pro"
  ├─ provider: "azure" | "google"
  ├─ model_name: "azure/gpt-4.1-mini" | "gemini-2.5-flash"
  ├─ api_key, base_url
  └─ is_default, is_active
```

---

## Sequence Diagram: Full 2-Turn Flow

```
User          Frontend              Backend                 LLM              Storage
 │               │                     │                     │                  │
 ├─ Attach doc ─►│                     │                     │                  │
 │               ├─ setAttachedDocument│                     │                  │
 │               │                     │                     │                  │
 ├─ "Điền HĐ" ─►│                     │                     │                  │
 │               ├─ POST /messages ───►│                     │                  │
 │               │  {content,          │                     │                  │
 │               │   skill_document_id}│                     │                  │
 │               │                     ├─ get_history()      │                  │
 │               │                     ├─ save user msg      │                  │
 │               │                     ├─ load document ────►│                  │
 │               │                     │◄── doc bytes ───────│                  │
 │               │                     ├─ parse_document()   │                  │
 │               │                     ├─ build prompt       │                  │
 │               │                     ├─ litellm.stream() ─►│                  │
 │               │◄── SSE: text chunks─│◄── text tokens ─────│                  │
 │◄── show text ─│                     │                     │                  │
 │               │◄── SSE: msg_stop ───│                     │                  │
 │               │                     ├─ save assistant msg │                  │
 │               │                     │                     │                  │
 │               │     (Turn 1 done)   │                     │                  │
 │               │                     │                     │                  │
 ├─ Fill values ►│                     │                     │                  │
 │  + "Xuất file"│                     │                     │                  │
 │               ├─ POST /messages ───►│                     │                  │
 │               │                     ├─ (same steps 1-8)   │                  │
 │               │                     ├─ litellm.stream() ─►│                  │
 │               │                     │◄── tool_call ────────│                  │
 │               │                     │   apply_edits(edits) │                  │
 │               │                     │                     │                  │
 │               │                     ├─ run_tool(apply_edits)                 │
 │               │                     │  ├─ load template ──►│                 │
 │               │                     │  │◄── doc bytes ─────│                 │
 │               │                     │  ├─ apply 18 edits   │                 │
 │               │                     │  ├─ save filled ────►│                 │
 │               │                     │  │◄── rendered_id ───│                 │
 │               │                     │  └─ generate preview │                 │
 │               │                     │                     │                  │
 │               │◄── SSE: skill_done ─│                     │                  │
 │               │   {rendered_id,     │                     │                  │
 │               │    preview_html}    │                     │                  │
 │               ├─ setSkillResult()   │                     │                  │
 │◄── Banner ────│                     │                     │                  │
 │   [Download]  │                     │                     │                  │
 │   [Preview]   │◄── SSE: msg_stop ──│                     │                  │
 │               │                     ├─ save assistant msg │                  │
 │               │                     │                     │                  │
 ├─ Click DL ──►│                     │                     │                  │
 │               ├─ GET /documents/{id}/download ──────────►│                  │
 │               │◄── blob (12KB .docx) ───────────────────│                  │
 │◄── File save ─│                     │                     │                  │
 │               │                     │                     │                  │
```

---

## File Reference

| File | Vai trò |
|------|---------|
| `src/api/v1/routes/chat.py` | SSE endpoint, routing skill vs RAG |
| `src/services/chat_service.py` | `stream_skill_answer()` — 12-step orchestration |
| `src/services/skill_service.py` | Skill loading, tool execution, model resolution |
| `src/schemas/chat.py` | `SendMessageRequest` with `skill_document_id` |
| `skills/docx-form-fill/SKILL.md` | AI instructions cho .docx |
| `skills/docx-form-fill/tools/parse_document.py` | Extract text + detect blanks |
| `skills/docx-form-fill/tools/apply_edits.py` | 4-pass edit matching + save |
| `skills/xlsx-form-fill/SKILL.md` | AI instructions cho .xlsx |
| `skills/xlsx-form-fill/tools/parse_document.py` | openpyxl cell extraction |
| `skills/xlsx-form-fill/tools/apply_edits.py` | Cell-based edit + HTML table preview |
| `src/app/api/endpoints/chat.ts` | SSE parser + `SkillDoneEvent` interface |
| `src/app/pages/ChatPage.tsx` | Skill state management + SSE consumption |
| `src/app/components/chat/ChatInput.tsx` | Attachment UI + DocPickerDropdown |
| `src/app/components/chat/SkillResultBanner.tsx` | Download + Preview + Dismiss |
