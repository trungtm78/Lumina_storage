# Lumina Agent Architecture

## Tổng quan

Lumina sử dụng kiến trúc **Agent + Dynamic Skills** lấy cảm hứng từ Claude Code và Deep Agents (LangChain). Agent chỉ có **4 generic tools** cố định — mọi nghiệp vụ chuyên biệt đều nằm trong **Skills** (thêm folder = thêm capability, không sửa code agent).

```
┌─────────────────────────────────────────────────────────┐
│                    Lumina Agent                          │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────────┐ │
│  │ search_docs │ │ list_docs    │ │ read_document    │ │
│  └─────────────┘ └──────────────┘ └──────────────────┘ │
│  ┌──────────────────────────────────────────────────┐   │
│  │ run_skill(skill_name, script_name, args_json)    │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  System Prompt:                                         │
│  ┌─ Level 1: Skill Catalog (name + description)        │
│  └─ Level 2: Full SKILL.md (injected on-demand)        │
���────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                   Skills (Filesystem)                    │
│                                                         │
│  skills/                                                │
│  ├── docx-form-fill/                                    │
│  │   ├── SKILL.md          ← instructions + metadata    │
│  │   └── tools/                                         │
│  │       ├── fill.py       ← self-contained pipeline    │
│  │       └── apply_edits.py                             │
│  ├── xlsx-form-fill/                                    │
│  │   ├── SKILL.md                                       │
│  │   └── tools/                                         │
│  │       ├── parse_document.py                          │
│  │       └── apply_edits.py                             │
│  └── [new-skill]/          ← just add folder!           │
│      ├── SKILL.md                                       │
│      └── tools/*.py                                     │
└─────────────────────────────────────────────────────────┘
```

---

## Luồng xử lý chi tiết

### 1. User gửi message

```
Frontend ─POST─▶ /api/v1/chat/sessions/{id}/messages
                 {"content": "Điền hợp đồng thuê nhà cho tôi..."}
                           │
                           ▼
                 StreamingResponse (SSE)
```

### 2. ChatService.stream_agent()

```
Bước 2.1  Lưu message user vào DB (ChatMessage)

Bước 2.2  Load conversation history + restore skill context
          DB: ChatMessage[] → convert_history() → Pydantic AI ModelMessage[]
          Restore từ message cuối có skill_result:
            collector.active_skill = "docx-form-fill"
            collector.skill_document_id = "abc-123"
            collector.skill_state = {"filled_tree": {...}}

Bước 2.3  Build AgentDeps (inject vào mọi tool)
          AgentDeps(db, settings, user, embedding_svc, vector_svc, skill_svc, collector)

Bước 2.4  Resolve model (Azure GPT / Gemini / OpenAI)

Bước 2.5  Chạy agent loop
          lumina_agent.iter(user_message, deps, model, history)
            → PartStartEvent / PartDeltaEvent → yield text chunks (SSE)
            → FunctionToolCallEvent → agent gọi tool
            → FunctionToolResultEvent → tool trả kết quả

Bước 2.6  Lưu assistant message + skill_result vào DB

Bước 2.7  Emit SSE events (sources, skill_done, message_stop)
```

### 3. Agent ReAct Loop

Agent tự quyết định gọi tool nào dựa vào system prompt + user message:

```
User: "Điền hợp đồng thuê nhà, Bên A: Nguyễn Văn Hùng..."
                    │
                    ▼
        ┌── Agent suy nghĩ ──┐
        │                     │
        ▼                     ▼
  list_documents()      read_document(doc_id)
  filter="skill"              │
        │                     ▼
        │            Activate skill: docx-form-fill
        │            Inject SKILL.md vào system prompt (Level 2)
        │                     │
        │                     ▼
        └────────▶ run_skill("docx-form-fill", "fill",
                    '{"user_info": "Bên A: Nguyễn Văn Hùng..."}')
                              │
                              ▼
                    fill.py pipeline chạy (self-contained)
                              │
                              ▼
                    Agent nhận kết quả JSON → trả lời user
```

### 4. Skill Pipeline (ví dụ: docx-form-fill/fill.py)

```
┌─────────────────────────────────────��────────────────────┐
│  fill.py — Self-contained Pipeline                       │
│                                                          │
│  Input: {"document_id": "...", "user_info": "..."}       │
│                                                          │
│  Step 1: Load DOCX                                       │
│  └─ ctx.get_document_bytes() → python-docx               │
│                                                          │
│  Step 2: Extract text + location tags                    │
│  ├─ [p0] CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM           │
│  ├─ [p2] ………., ngày .... tháng .... năm ....             │
│  ├─ [p9] Ông: ……………………..                                │
│  └─ [t0r1c2p0] Cell text in table                        │
│                                                          │
│  Step 3: LLM Parse → JSON Tree          ← ctx.llm_call  │
│  └─ {"ben_a": {                                          │
│       "ho_ten": {"value": null, "location": "p9"},       │
│       "cmnd": {"value": null, "location": "p10"}         │
│     }}                                                   │
│                                                          │
│  Step 4: LLM Fill Values                ← ctx.llm_call  │
│  └─ {"ben_a": {                                          │
│       "ho_ten": {"value": "Nguyễn Văn Hùng", ...},      │
│       "cmnd": {"value": "001234567890", ...}             │
│     }}                                                   │
│                                                          │
│  Step 5: Apply to DOCX                                   │
│  ├─ Find paragraph by location tag                       │
│  ├─ Find blank pattern (……, ___, ---) near label         │
│  └─ Replace blank with filled value                      │
│                                                          │
│  Step 6: Save + PDF Preview                              │
│  ├─ ctx.save_rendered_document()                         │
│  └─ ctx.convert_to_pdf() + ctx.save_pdf_preview()        │
│                                                          │
│  Output: {                                               │
│    "rendered_document_id": "uuid",                       │
│    "preview_pdf_id": "uuid",                             │
│    "applied_count": 5,                                   │
│    "_state": {"filled_tree": {...}}  ← cross-turn state  │
│  }                                                       │
└──────────────────────────────────────────────────────────┘
```

---

## Progressive Disclosure (2-level loading)

```
STARTUP (mọi conversation):
┌─────────────────────────────────────────────────┐
│ System Prompt:                                  │
│                                                 │
│ ## Skills có sẵn:                               │
│ - docx-form-fill: Điền file Word (.docx/.doc)   │
│   Scripts: fill, apply_edits                    │
│ - xlsx-form-fill: Điền file Excel (.xlsx/.xls)   │
│   Scripts: parse_document, apply_edits          │
│                                                 │
│ (~50 tokens per skill — lightweight)            │
└─────────────────────────────────────────────────┘

ON-DEMAND (khi read_document activate skill):
┌─────────────────────────────────────────────────┐
│ System Prompt += :                              │
│                                                 │
│ ---                                             │
│ ## Skill Active: docx-form-fill                 │
│ Document ID: `abc-123`                          │
│                                                 │
│ # Hướng dẫn điền file Word (.docx)              │
│ ## Script: fill                                 │
│ Gọi `fill` để điền thông tin...                 │
│ ### Ví dụ 1: Điền lần đầu                      │
│ run_skill("docx-form-fill", "fill", ...)        │
│ ...                                             │
│                                                 │
│ (~500 tokens — full instructions)               │
└─────────────────────────────────────────────────┘
```

---

## Cross-turn State Management

```
Turn 1: User cung cấp thông tin Bên A
         │
         ▼
    fill.py → rendered file + filled_tree
         │
         ▼
    Lưu vào ChatMessage.skill_result (JSONB):
    {
      "active_skill": "docx-form-fill",
      "skill_document_id": "template-uuid",
      "rendered_document_id": "filled-uuid",
      "skill_state": {
        "filled_tree": {"ben_a": {"ho_ten": {"value": "Nguyễn Văn Hùng"}}}
      }
    }

Turn 2: User muốn sửa tên Bên A
         │
         ▼
    Restore từ DB:
    collector.active_skill = "docx-form-fill"
    collector.skill_state = {"filled_tree": {...}}
         │
         ▼
    run_skill auto-inject: args["_state"] = collector.skill_state
         │
         ▼
    fill.py nhận _state → previous_tree
    mode="update" → LLM chỉ sửa field user yêu cầu, giữ nguyên field cũ
```

---

## SKILL.md Format

```yaml
---
name: skill-name                          # unique identifier
description: "Mô tả ngắn (~250 chars)"   # cho Level 1 catalog
triggers:
  extensions: [".docx", ".doc"]           # auto-detect khi read_document
# Optional:
# disable-model-invocation: false         # true = chỉ user invoke
# allowed-tools: Read Write               # restrict agent tools
# model: azure/gpt-4o                     # override model
# context: fork                           # run in sub-agent
---

# Full Instructions (Level 2)

## Scripts có sẵn
- `script_name`: Mô tả + cách gọi

## Quy trình
1. Bước 1...
2. Bước 2...

## Ví dụ
run_skill("skill-name", "script_name", '{"arg": "value"}')
```

---

## Thêm Skill Mới (Zero Code Change)

```bash
# 1. Tạo folder
mkdir -p skills/pdf-summarize/tools

# 2. Viết SKILL.md (metadata + instructions)
# 3. Viết tools/summarize.py (async def run(args, ctx) -> dict)
# 4. Restart server → skill auto-discovered → agent có thể dùng ngay
```

**Script interface chuẩn:**
```python
async def run(args: dict, ctx: SkillContext) -> dict:
    """
    args: {"document_id": "...", ...custom args from SKILL.md}
    ctx: SkillContext with methods:
      - ctx.get_document_bytes(document_id) → bytes
      - ctx.save_rendered_document(bytes, source_id) → uuid
      - ctx.convert_to_pdf(bytes, mime) → bytes | None
      - ctx.save_pdf_preview(bytes, source_id) → uuid
      - ctx.llm_call(messages, response_format) → str
    
    Return dict. Special keys:
      - "rendered_document_id" → triggers skill_done SSE event
      - "_state" → persisted cross-turn (auto-injected next call)
    """
```

---

## Các thành phần hệ thống

```
┌────────────────────────────────────────────────────────────────┐
│                         FRONTEND                               │
│  React + SSE Client                                            │
│  ChatInput → MessageList (markdown) → FileAttachmentCard       │
└────────────────────────────┬───────────────────────────────────┘
                             │ SSE (content_block_delta,
                             │      skill_done, sources)
                             ▼
┌────────────────────────────────────────────────────────────────┐
│                         BACKEND                                │
│                                                                │
│  API Layer:     POST /chat/sessions/{id}/messages → SSE        │
│                                                                │
│  Service Layer: ChatService.stream_agent()                     │
│                 ├─ History (PostgreSQL ChatMessage)             │
│                 ├─ Model (Azure/Gemini/OpenAI)                 │
│                 └─ State (AgentResultCollector)                 │
│                                                                │
│  Agent Layer:   Pydantic AI Agent (4 core tools)               │
│                 search_documents, list_documents,              │
│                 read_document, run_skill                       │
│                                                                │
│  Skill Layer:   SkillService                                   │
│                 ├─ detect(ext) → SkillDefinition               │
│                 ├─ run_tool() → importlib.load(tools/*.py)     │
│                 └─ SkillContext (get_bytes, save, llm, pdf)    │
│                                                                │
│  Storage:       S3/MinIO │ PostgreSQL │ Gotenberg (PDF)        │
│                                                                │
│  Tracing:       Langfuse (trace, generation, tool spans)       │
└────────────────────────────────────────────────────────────────┘
```

---

## So sánh với bài báo

| Concept | Viblo / Deep Agents | Lumina |
|---------|---------------------|--------|
| **Skills = Instructions + Scripts** | SKILL.md + scripts/ | SKILL.md + tools/*.py |
| **Progressive Disclosure** | Level 1 catalog → Level 2 on-demand | Tương tự |
| **Skills vs Tools** | Skills = How, Tools = What | Skills = How, Core Tools = What |
| **Zero code change** | Drop folder | Drop folder → auto-discovered |
| **Skill self-contained** | Scripts gọi tools | tools/*.py với ctx.llm_call() |
| **Cross-turn state** | AGENTS.md shared memory | skill_state trong DB |
| **Sub-agents** | task() delegation | Planned: context="fork" |

---

## Nguyên tắc thiết kế

1. **Agent tools KHÔNG reference tên skill cụ thể** — 100% generic
2. **Skills tự mô tả** — SKILL.md chứa triggers, scripts, instructions
3. **Skills tự quản lý state** — qua `_state` dict (agent chỉ pass-through)
4. **Thêm skill = thêm folder** — không sửa code
5. **Skill scripts là self-contained** — có thể gọi LLM nội bộ (ctx.llm_call)
6. **Progressive disclosure** — giữ context sạch, chỉ load full instructions khi cần
7. **Skills điều phối tools, không thay thế** — skills dạy agent CÁCH dùng tools
