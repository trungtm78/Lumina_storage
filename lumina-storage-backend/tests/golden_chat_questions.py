"""Phase 4 T7 — golden fixtures cho chat citation stability.

Mỗi mục = một câu hỏi + tập citation (shape Citation/rag_search) mô phỏng kết quả
retrieval cố định. Dùng để kiểm chứng pipeline citation hợp nhất (collector →
citations_to_sources, T6) là LOSSLESS + DETERMINISTIC: tập doc_ids cited không đổi
(Jaccard = 1.0) so với input retrieval.

LƯU Ý: golden "luồng cũ vs luồng mới sống" theo nghĩa đen cần Qdrant + LLM thật
(không có trong test env). Golden này khoá bất biến tầng pipeline citation — phần
T6/T7 thực sự refactor — không phụ thuộc dịch vụ ngoài.
"""
import uuid

# doc_ids cố định để Jaccard tính ổn định (deterministic, không random runtime).
_D = [str(uuid.UUID(int=i)) for i in range(1, 11)]
_C = [str(uuid.UUID(int=100 + i)) for i in range(1, 11)]


def _cite(doc_id: str, chunk_id: str, page: int, score: float, text: str) -> dict:
    return {
        "document_id": doc_id,
        "chunk_id": chunk_id,
        "page_number": page,
        "content": text,
        "score": score,
    }


GOLDEN_QUESTIONS: list[dict] = [
    {
        "question": "Doanh thu quý 1 là bao nhiêu?",
        "citations": [
            _cite(_D[0], _C[0], 1, 0.91, "Doanh thu quý 1 đạt 12 tỷ."),
            _cite(_D[1], _C[1], 3, 0.85, "Bảng doanh thu theo quý."),
        ],
    },
    {
        "question": "Điều khoản thanh toán trong hợp đồng?",
        "citations": [
            _cite(_D[2], _C[2], 2, 0.88, "Thanh toán trong 30 ngày."),
        ],
    },
    {
        "question": "Ai là người đại diện pháp luật?",
        "citations": [
            _cite(_D[3], _C[3], 1, 0.93, "Người đại diện: Nguyễn Văn A."),
            _cite(_D[4], _C[4], 1, 0.80, "Chức danh: Tổng giám đốc."),
            _cite(_D[5], _C[5], 5, 0.76, "Phụ lục nhân sự."),
        ],
    },
    {
        "question": "Thời hạn hiệu lực của thỏa thuận?",
        "citations": [
            _cite(_D[6], _C[6], 4, 0.84, "Hiệu lực 24 tháng kể từ ngày ký."),
        ],
    },
    {
        "question": "Phạm vi bảo mật thông tin?",
        "citations": [
            _cite(_D[7], _C[7], 2, 0.90, "Bảo mật toàn bộ tài liệu kỹ thuật."),
            _cite(_D[8], _C[8], 6, 0.79, "Ngoại lệ thông tin công khai."),
        ],
    },
    {
        "question": "Mức phạt vi phạm hợp đồng?",
        "citations": [
            _cite(_D[9], _C[9], 7, 0.87, "Phạt 8% giá trị hợp đồng."),
        ],
    },
]
