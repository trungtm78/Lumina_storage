# Milestone 4 — AI Gateway + Chat Unify + VLM Fix (Phase 4) Implementation Plan

> Spec gốc: `~/.claude/plans/chu-n-h-a-l-i-to-n-serene-blanket.md` (Phase 4). Mỗi task STRICT: TDD(RED→GREEN) → full suite → /review(Claude) → /codex(diff) → fix tận gốc → commit. Cuối milestone: alignment vs spec + smoke + báo cáo Word. Baseline: **218 passed**.

**Goal (spec):** Model hóa `LiteLLMConfig` (thêm `max_tokens`/`temperature` từ `extra_config` + purpose `vlm`) → `to_kwargs` truyền đủ (fix VLM cắt cụt); `ai/gateway.py` bọc LLMService/EmbeddingService; `ai/tracing.py` flush async (không block event loop); hợp nhất `stream_answer`+`stream_agent` → một `stream()` chọn strategy, dùng chung retrieval/citation; tool registry tường minh (gộp `rag_search`↔`query_vector_db`); chuyển litellm trực tiếp → Gateway (review/generator/skill/extraction/worker). **Done:** VLM không cắt trên fixture; chat ra citation; Langfuse không block.

## Hiện trạng (đã khảo sát)

- **LiteLLMConfig** (`ai_model_config_service.py:26`): dataclass frozen chỉ có model/api_key/api_base/api_version. `to_kwargs()` KHÔNG có max_tokens/temperature/response_format. `get_default_litellm_config` (`:56`) đọc extra_config nhưng CHỈ trích api_version, KHÔNG merge các param khác.
- **AIModelConfig DB** (`models/core.py:12`): `purpose` String(20) hiện chỉ chat/embedding (CHƯA 'vlm'); `extra_config` JSONB sẵn có.
- **VLM truncation** (`text_extraction_service.py:88,173,241`): 3 chỗ `litellm.acompletion` với image, `**self._vlm_kwargs` KHÔNG có max_tokens → output dễ cắt cụt. `__init__` nhận vlm_model+vlm_kwargs từ caller (worker truyền qua `get_default_litellm_config(db,"chat")` — dùng chat model, không có purpose vlm riêng).
- **chat_service**: `stream_answer` (`:326`, RAG đơn giản, citation từ search_results `:419`), `stream_agent` (`:472`, LangGraph agent + tool, citation từ collector `:679`). KHÔNG có stream_skill_answer. Langfuse flush ở 2 nơi (`:461`,`:735`). Commit-trước-background title (`:435`,`:696`) — GIỮ (Phase 3 COMMIT CỐ Ý).
- **Tool registry** (`agent.py:699` `TOOLS=[rag_search]`): rag_search (`:662`) ↔ query_vector_db (`:569`) TRÙNG logic (cùng vector_svc.search). 9 tool định nghĩa nhưng TOOLS array chỉ expose rag_search; run_script inject qua handler riêng.
- **Direct litellm** (~14 chỗ): text_extraction (88/173/241), llm_service (33), embedding_service (69), skill_service (163), review.py (1756/2097/2272), generator.py (559/605/688/1002/1119), worker/tasks/document.py (498/601).
- **LLMService** (`llm_service.py:19`): chỉ `stream_completion`. **EmbeddingService** (`embedding_service.py:23`): retry+backoff+batch (đã tốt). CHƯA có `src/ai/`.
- **Langfuse** (`core/langfuse.py:296` `flush()`): dùng `httpx.post` ĐỒNG BỘ (block event loop ~100-500ms). Khởi tạo `get_langfuse_handler` (`:316`).

## Nguyên tắc thiết kế

1. **Foundation trước, rủi ro cao sau.** Config model hóa → VLM fix → Gateway → tracing async → migrate litellm → chat unify (cuối, có feature-flag).
2. **Backward-compatible từng bước.** Mỗi task giữ app chạy + test xanh; không big-bang.
3. **Gateway là một điểm vào.** Mọi LLM/embedding/VLM đi qua Gateway → chỗ duy nhất gắn tracing/retry/config; nhưng KHÔNG đổi semantics gọi (chỉ chuyển đường).
4. **Chat unify giữ 2 luồng sau feature-flag** đến khi so "câu hỏi vàng" khớp; tránh regression citation/agent.
5. **Tuân thủ Phase 3 boundary** (không thêm commit business; giữ COMMIT CỐ Ý đã đánh dấu; T2 enforcement vẫn xanh).

## Tasks (mỗi task STRICT, theo thứ tự) — đã fold /plan-eng-review (C1-C5, M1-M6, m1-m4)

### T1 — Model hóa LiteLLMConfig + purpose 'vlm' (foundation)
- `LiteLLMConfig` thêm `max_tokens: int | None`, `temperature: float | None`, `extra: dict` (top_p/seed/response_format...). `to_kwargs()` splat đủ (bỏ None). **KHÔNG đặt default max_tokens ở đây** (M1 — default thuộc lớp tiêu thụ).
- `to_kwargs(**overrides)` nhận **per-call overrides** merge LÊN TRÊN config (C1): caller truyền `temperature=0, seed=42, stream=False` vẫn được tôn trọng. Đây là hợp đồng để T5 migrate không nuốt param.
- `get_default_litellm_config(db, purpose)`: merge `extra_config` JSONB (max_tokens/temperature/extra). Hỗ trợ purpose='vlm'; **fallback 'chat' KHÔNG raise** khi thiếu config vlm (M2) + log warning.
- Thêm 'vlm' vào VALID_PURPOSES (`schemas/ai_model_config.py:6`) để API tạo config vlm không 422 (M2). Verify `clear_default(purpose)` cho phép default chat & vlm song song.
- **Test:** to_kwargs có max_tokens/temperature/extra khi set + override per-call thắng config; get_default đọc extra_config; **purpose vlm thiếu row → fallback chat + warning, KHÔNG raise**; AIModelConfigResponse không lộ api_key (Phase 2).
- **Verify:** caller cũ không đổi hành vi (max_tokens=None → không có key → litellm default như trước).

### T2 — Fix VLM cắt cụt (dùng T1)
- `text_extraction_service`: nhận vlm config qua purpose='vlm' (`get_default_litellm_config(db,"vlm")`); 3 chỗ acompletion (`:88/173/241`) truyền `max_tokens`. **Default `max_tokens=8192` đặt Ở text_extraction** (M1 — lớp tiêu thụ, không ở resolver), override được qua extra_config; 8192 vì trang A4 dày tiếng Việt + bảng + mô tả ảnh có thể vượt 4096 token markdown.
- **Test:** mock `litellm.acompletion` → **assert call kwargs chứa `max_tokens >= 8192`** (M4 — KHÔNG assert độ dài output mock, vô nghĩa); fallback vlm→chat hoạt động khi không có row vlm.
- **Integration (gated, không chạy CI mặc định)** (M4): 1 PDF trang dày THẬT → verify output không cắt (marker cuối trang). Đánh dấu `@pytest.mark.integration`.
- **Done (spec):** VLM không cắt trên fixture.

### T3a — `src/ai/gateway.py` interface (thin facade, định nghĩa chữ ký trước)
- Tạo `src/ai/__init__.py` + `gateway.py`: `AIGateway` = **thin facade nhiều method** delegate sang service đã có, KHÔNG nhồi logic (M3 — tránh god-class): `stream(messages, **overrides)`, `embed(texts)`, `vlm_complete(messages, **overrides)`, `langchain_model(**overrides)`, `langgraph_model(**overrides)` (2 cái cuối cho stream_agent build_model — T7 CẦN, không bỏ sót). Mỗi method nhận `**overrides` per-call (C1).
- `from_db(db, purpose)` factory. Gắn tracing hook (T4) ở MỘT chỗ.
- Thêm `"ai"` vào SCAN_DIRS của `test_commit_enforcement` (M6 — enforcement phủ code mới).
- **Test:** mỗi method gọi đúng underlying (mock); overrides truyền xuống đúng; tracing hook được gọi.

### T3b — Wire underlying + tracing hook
- Nối facade vào LLMService/EmbeddingService/VLM/build_model thật; **KHÔNG đổi semantics** (embedding giữ nguyên batch/halving/truncate — Phase 5, m2). Chỉ centralize đường gọi + tracing.
- **Test:** stream/embed/vlm qua gateway = behavior cũ; embedding batch/halving không đổi.

### T4 — `src/ai/tracing.py` + Langfuse flush non-block (CHỐT fire-and-forget)
- flush chuyển `httpx.AsyncClient`; **gọi qua `asyncio.create_task` fire-and-forget** (C5 — đồng nhất title-background đã dùng create_task; response đóng ngay). **GIỮ reference task** (set sống) tránh GC thu hồi task (bug Python thật). Document: "trace best-effort, mất khi process chết = chấp nhận".
- chat_service `:461`,`:735`: flush không nằm trên critical path trả response.
- **Test:** (1) KHÔNG còn `httpx.post` sync (mock); (2) **ordering: response generator yield xong TRƯỚC khi flush resolve** (M4 — assert thứ tự, không chỉ assert AsyncClient); (3) flush lỗi không hỏng response.
- **Done (spec):** Langfuse không block.

### T5 — Migrate direct litellm → Gateway (mỗi nhóm 1 commit)
- Chuyển call site `litellm.*` sang Gateway: (a) review.py (1756/2097/2272 — **GIỮ `temperature=0, seed=42, stream=False`** qua overrides, C1); (b) generator.py (559/605/688/1002/1119); (c) skill_service.py (163); (d) worker/tasks/document.py (498/601); (e) text_extraction VLM qua `vlm_complete`.
- **Test mỗi nhóm (C1):** mock litellm → **assert kwargs truyền vào IDENTICAL trước/sau migrate** (đặc biệt review giữ temperature=0/seed=42/stream=False — chống nuốt param làm score random), KHÔNG chỉ "output đúng".
- **Verify:** `import litellm` ngoài gateway + service hạ tầng (llm_service/embedding_service/text_extraction) = 0.

### T6 — Tool registry tường minh + XÓA query_vector_db (dead) + chuẩn hóa Citation
- **XÓA `query_vector_db`** (C3 — DEAD: không nằm trong TOOLS, không caller nào; verify grep trước khi xóa, KHÔNG cần alias). Giữ `rag_search` canonical.
- Định nghĩa **`Citation` (dataclass/TypedDict) chuẩn** cho `collector.search_results` (C2); **normalize CẢ 3 nguồn**: rag_search (`:683` dict), query_vector_db (xóa), **parse_document `_sources` (`:554`, shape thứ 3 — KHÔNG bỏ sót)**. Đơn giản hóa builder `chat_service:683-688` (bỏ `hasattr/get`).
- Registry tường minh expose đúng tập tool; audit MỌI điểm set `collector.search_results`.
- **Test:** agent có đủ tool; rag_search + parse_document trả Citation chuẩn vào collector; builder citation dùng 1 shape; query_vector_db đã xóa.

### T7 — Hợp nhất stream() (CUỐI, rủi ro cao nhất, feature-flag) — SCOPE ĐÃ HẠ (C4)
- **KHÔNG gộp retrieval** (C4 — simple làm retrieval BẮT BUỘC upfront/ChatLiteLLM LCEL; agent làm retrieval TÙY CHỌN trong ReAct/LangGraph build_model — bản chất khác). Phần CHUNG thực sự CHỈ: (a) save user_msg + flush; (b) build `ChatMessageSource`+`last_sources` từ **`collector` làm nguồn citation DUY NHẤT cho cả 2 strategy** (M5 — simple ghi kết quả retrieval vào collector sau chuẩn hóa C2); (c) **COMMIT CỐ Ý + spawn title background — GIỮ 2 marker** (`chat_service.py:434,:694`) khi gộp (M6, enforcement); (d) langfuse setup + flush (T4).
- `stream(strategy)` chọn nhánh; retrieval + LLM stack giữ RIÊNG theo strategy. Dùng `langchain_model`/`langgraph_model` của Gateway (T3a).
- **Feature-flag `CHAT_UNIFIED_STREAM`** ở Settings (m4, default False); giữ 2 luồng cũ tới khi golden pass.
- **Golden questions** (m3): `tests/.../golden_chat_questions.py` 5-10 câu + tài liệu cố định; metric khớp = `Jaccard(citation doc_ids) >= ngưỡng` giữa luồng cũ vs mới (cả 2 strategy). Là điều kiện tắt flag.
- **Test:** stream simple + agent đều ra citation (qua collector); golden Jaccard đạt ngưỡng; flag bật/tắt đổi đúng luồng.
- **Done (spec):** chat ra citation (cả 2 strategy).

### Checkpoint M4
- Full suite xanh; smoke E2E (login→upload→ingest→chat simple+agent→generator); VLM fixture/integration không cắt; Langfuse non-block ordering test; golden questions đạt ngưỡng.
- `/plan-eng-review` alignment vs spec Phase 4 + báo cáo Word.

## Test & Verify
- Mock litellm/httpx ở mọi test (KHÔNG gọi API thật). Mỗi task: happy-path + bất biến chính.
- VLM: test max_tokens được truyền (fix cắt cụt). Tracing: test async (không sync httpx.post). Chat: test citation cả 2 strategy.
- Full pytest sau mỗi task; baseline **218 passed**.

## Rủi ro & Rollback
- **Chat unify (T7)** rủi ro cao nhất: feature-flag giữ 2 luồng; golden-questions so khớp trước khi bỏ luồng cũ. Rollback: tắt flag.
- **VLM max_tokens** quá lớn → tốn token/chậm: đặt ngưỡng hợp lý cấu hình được (extra_config).
- **Gateway** đổi đường gọi → regression: mỗi migrate nhóm test happy-path so output; giữ underlying service nguyên.
- Rollback chung: `git revert` từng task (tag pre-refactor); mỗi task 1 commit.

## NOT in scope (Phase 4)
- Extraction quality (chunking/blue-green/pluggable providers) → Phase 5.
- Dọn trùng extract_template (Phase 7).
- Sửa latent `_persist_eval_pdf` session reuse (backlog) — chỉ đụng nếu migrate review.py chạm tới.

## What already exists (tái dùng)
- `LiteLLMConfig` + `get_default_litellm_config` (mở rộng, không xây lại).
- `LLMService.stream_completion`, `EmbeddingService.embed_texts` (gateway bọc).
- `core/langfuse.py` batch handler (chuyển flush async).
- `agent.py` 9 tool definitions (gom vào registry).
- Phase 3 boundary (get_db/uow_context) + T2 enforcement (giữ xanh).

## Implementation Tasks
- [ ] **T1** — LiteLLMConfig model hóa + purpose vlm + `to_kwargs(**overrides)` + fallback no-raise (foundation).
- [ ] **T2** — Fix VLM cắt cụt (max_tokens=8192 ở text_extraction) — Done: VLM không cắt fixture (+ integration gated).
- [ ] **T3a** — src/ai/gateway.py thin facade (interface: stream/embed/vlm_complete/langchain_model/langgraph_model + overrides) + SCAN_DIRS += "ai".
- [ ] **T3b** — Wire underlying + tracing hook (không đổi semantics/batch).
- [ ] **T4** — src/ai/tracing.py flush fire-and-forget (giữ task ref) — Done: Langfuse không block (ordering test).
- [ ] **T5** — Migrate direct litellm → Gateway (mỗi nhóm 1 commit; assert kwargs IDENTICAL, giữ seed/temperature/stream).
- [ ] **T6** — Registry tường minh + XÓA query_vector_db (dead) + Citation type chuẩn hóa 3 nguồn (gồm parse_document._sources).
- [ ] **T7** — Hợp nhất stream() scope-hạ (citation-persist+lifecycle chung, retrieval RIÊNG) + feature-flag + golden questions — Done: chat ra citation.

## Quyết định đã chốt (từ /plan-eng-review 2026-06-29)
1. **Gateway interface nhận `**overrides` per-call** (C1) — review.py giữ `temperature=0/seed=42/stream=False`; test assert kwargs identical.
2. **`collector.search_results` chuẩn hóa về 1 `Citation` shape** (C2), normalize 3 nguồn gồm `parse_document._sources`.
3. **`query_vector_db` = DEAD → XÓA** (C3), không alias.
4. **T7 hạ scope: retrieval KHÔNG chung** (C4) — chỉ citation-persist + lifecycle chung; `collector` là nguồn citation duy nhất (M5).
5. **Langfuse flush = fire-and-forget create_task + giữ task ref** (C5); test ordering non-block.
6. **max_tokens default 8192 ở text_extraction** (M1, lớp tiêu thụ), không ở resolver.
7. **Fallback vlm→chat KHÔNG raise** (M2); 'vlm' vào VALID_PURPOSES.
8. **Gateway = thin facade nhiều method** (M3), gồm langchain_model/langgraph_model.
9. **Test: VLM assert kwargs (không output-len); Langfuse assert ordering; +1 integration gated** (M4).
10. **SCAN_DIRS += "ai"; giữ 2 marker COMMIT CỐ Ý** khi refactor stream (M6).
11. **T3 tách T3a (interface) / T3b (wire)** (m1); **golden questions fixture + Jaccard ngưỡng** (m3); **feature-flag `CHAT_UNIFIED_STREAM` ở Settings** default False (m4); **không đụng embedding truncate/batch** — Phase 5 (m2).

## GSTACK REVIEW REPORT
| Review | Trigger | Runs | Status | Findings |
|--------|---------|------|--------|----------|
| Eng Review | `/plan-eng-review` | 1 | CLEARED (sau revision) | 5 critical + 6 major + 4 minor — đã fold hết vào task + Quyết định đã chốt. Plan grounded (file:line verified). |

- **ENG VERDICT:** NEEDS REVISION → đã sửa C1-C5, M1-M6, m1-m4 → **CLEARED**. Plan Phase 4 sẵn sàng thực thi incremental (T1→T7, STRICT mỗi task).

NO UNRESOLVED DECISIONS
