"""Shared kernel (Phase 8 W3 Task A) — interface/service dùng XUYÊN nhiều domain.

Đặt ở đây (KHÔNG ép vào 1 domain) để domain-ization sau KHÔNG tạo import-time cycle giữa
các domain (ACL/ai-config/vector dùng bởi document/chat/review/generator/...). Xem plan
docs/superpowers/plans/2026-06-30-phase8-W3-domain-reorg.md §Task A.
"""
