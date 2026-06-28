# Baseline trước refactor (Milestone 1)

- **Ngày:** 2026-06-28
- **Branch:** `refactor/milestone-1-foundation`
- **Test runner:** `docker compose --profile test run --rm test uv run pytest`
- **Kết quả baseline:** **118 passed** in ~52s (0 failed, 0 error).
- **Test DB:** `lumina_driver_test` trên postgres container (schema từ `Base.metadata`, extension `unaccent`).
- **Lệnh chạy nhanh (TDD, mount live src+tests):**
  ```
  docker compose --profile test run --rm test uv run pytest <path> -v
  ```

Mọi thay đổi từ đây phải giữ ≥118 passed (không gây regression).
