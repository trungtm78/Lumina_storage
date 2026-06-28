# RAG Pipeline — Multi-format Extraction + Ingestion

Auto-dispatch sau mỗi upload (`ingest_document_task`). Pipeline chạy trong ARQ worker.

---

## Tổng quan

```
File upload
  │
  ▼
[1. Đọc bytes từ storage backend]
  │
  ▼
[2. Text extraction theo format]  ← PDF hybrid / Office / plaintext / OCR
  │                                  Output: list[PageResult] với Markdown-friendly text
  ▼
[3. Upsert DocumentContent]       ← raw_text = toàn bộ text ghép lại
  │
  ▼
[4. FTS index]                    ← to_tsvector('simple', raw_text)
  │
  ▼
[5. Chunking]                     ← MarkdownHeaderTextSplitter → RecursiveCharacterTextSplitter
  │
  ▼
[6. Embedding]                    ← Azure text-embedding-3-large (3072d), batch
  │
  ▼
[7. Upsert Qdrant]                ← payload: document_id, chunk_id, chunk_index, content
  │
  ▼
[8. Document.page_count = N]      ← FE dùng null/non-null làm processing indicator
```

---

## 1. Text extraction (`TextExtractionService`)

File: `src/services/text_extraction_service.py`

Output: `list[PageResult]`

```python
@dataclass
class PageResult:
    page_number: int
    text: str          # plain text (có thể chứa markdown heading từ Office formats)
    confidence: float  # 1.0 = native extract, < 1.0 = OCR
```

### Routing theo format

| Format | Cách xử lý |
|--------|-----------|
| PDF | Hybrid per-page: native text nếu trang có text layer, OCR (Cloud Vision) nếu scanned |
| JPG / PNG / WEBP / GIF | Cloud Vision OCR → text |
| DOCX / XLSX / PPTX | `markitdown` → Markdown text |
| TXT / MD / CSV | Decode UTF-8 raw |
| Khác | Trả về `[]` (graceful skip) |

### Hybrid PDF detection

Không detect toàn bộ file — detect **từng trang**:

```python
for page in doc:
    native_text = page.get_text("text").strip()
    if native_text:
        # Trang có text layer → dùng trực tiếp
        results.append(PageResult(page.number + 1, native_text, 1.0))
    else:
        # Trang scan → gửi lên Cloud Vision OCR
        img_bytes = page.get_pixmap(dpi=200).tobytes("png")
        ocr_result = await ocr_svc.process_bytes(img_bytes, "image/png")
        ...
```

Ưu điểm: PDF 100 trang, 80 trang có text layer → chỉ gọi VLM 20 trang → tiết kiệm ~80% API call.

---

## 2. Chunking

Hai bước:

**Bước 1 — `MarkdownHeaderTextSplitter`**: split theo heading hierarchy

```python
headers_to_split_on = [("#", "h1"), ("##", "h2"), ("###", "h3")]
md_splitter = MarkdownHeaderTextSplitter(headers_to_split_on, strip_headers=False)
header_splits = md_splitter.split_text(full_text)
# Mỗi split có metadata: {"h1": "Chương 1", "h2": "Mục 1.1"}
```

**Bước 2 — `RecursiveCharacterTextSplitter`**: split tiếp nếu section quá dài

```python
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1500,   # ≈ 375–500 tokens
    chunk_overlap=150,
    separators=["\n\n", "\n", ". ", " ", ""],
)
final_chunks = text_splitter.split_documents(header_splits)
```

Mỗi chunk giữ metadata heading → dùng làm context cho LLM khi trả lời RAG.

---

## 4. FTS (Full-Text Search)

Sau khi upsert `DocumentContent.raw_text`:

```sql
UPDATE documents_documentcontent
SET search_vector = to_tsvector('simple', raw_text)
WHERE document_id = :id
```

`search_mode=keyword` trong `GET /documents` dùng:
```sql
documents_documentcontent.search_vector @@ plainto_tsquery('simple', :q)
```

---

## 5. Embedding + Qdrant

- Model: `azure/text-embedding-3-large` (3072 dimensions)
- Batch embed toàn bộ chunks trong một call
- Upsert Qdrant với payload:

```json
{
  "document_id": "uuid",
  "chunk_id": "uuid",
  "chunk_index": 0,
  "content": "chunk text..."
}
```

`search_mode=semantic` trong `GET /documents`:
1. Embed query → vector
2. Query Qdrant top 50 nearest neighbors
3. Filter DB theo `document_id` trong kết quả Qdrant

---

## 6. Processing indicator

`Document.page_count`:
- `null` — ingest chưa chạy xong (hoặc chưa bắt đầu)
- `0` — chạy xong nhưng không extract được text
- `> 0` — ingest thành công, `page_count = len(pages)`

Frontend poll mỗi 5 giây khi có document `page_count === null`, dừng khi tất cả đã có giá trị.

---

## 7. Dependencies

| Package | Mục đích |
|---------|---------|
| `pymupdf` | PDF text extraction + render page image cho thumbnail và OCR |
| `markitdown` | DOCX / XLSX / PPTX → Markdown text |
| `langchain-text-splitters` | `MarkdownHeaderTextSplitter` + `RecursiveCharacterTextSplitter` |
| `qdrant-client` | Vector upsert + similarity search |
| `langchain-openai` | Embedding via Azure OpenAI |
