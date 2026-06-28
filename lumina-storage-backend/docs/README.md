# Docs — lumina-driver-backend

```
docs/
├── setup/
│   └── project-setup.md        Cài đặt, cấu trúc thư mục, biến môi trường, Alembic
├── schema/
│   └── dms_schema.sql          Schema PostgreSQL gốc (24 tables)
└── api/
    ├── auth.md                 POST /register, /login, /refresh · GET /me
    ├── users.md                GET|PATCH|DELETE /users · GET|POST|PATCH|DELETE /groups · members · GET|PUT /groups/{id}/permissions · GET /permissions
    ├── tasks.md                GET /tasks (list + filter) · POST /tasks/ping · GET /tasks/{task_id} · Task catalog
    ├── documents.md            Upload (auto-ingest) · GET (filter/search/pagination) · bulk delete · move · star · process · thumbnail pipeline
    ├── rag_pipeline.md         RAG multi-format pipeline: extraction · chunking · embedding · FTS · OCR
    ├── chat.md                 Sessions CRUD · Messages (cursor pagination) · SSE streaming (Claude-style)
    └── ai_model_config.md      AI model CRUD · Test connection · Provider config (Azure/OpenAI/Anthropic/Google/Ollama)
```
