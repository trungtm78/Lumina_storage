-- =============================================================================
-- DMS Database Schema
-- Target: PostgreSQL 14+
-- Design: Single-tenant, UUID PKs, soft delete, FTS + Qdrant vector search
-- =============================================================================

-- Create database (run this script with a role that can create databases)
CREATE DATABASE lumina_driver_dev;

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- APP: users
-- =============================================================================

CREATE TABLE users_user (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    username        VARCHAR(150) NOT NULL UNIQUE,
    email           VARCHAR(254) NOT NULL UNIQUE,
    full_name       VARCHAR(255) NOT NULL DEFAULT '',
    avatar          VARCHAR(512),
    password        TEXT        NOT NULL,         -- hashed, managed by auth layer
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    is_staff        BOOLEAN     NOT NULL DEFAULT FALSE,
    is_superuser    BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login      TIMESTAMPTZ
);

CREATE TABLE users_group (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(150) NOT NULL UNIQUE,
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users_usergroup (
    user_id         UUID        NOT NULL REFERENCES users_user(id)  ON DELETE CASCADE,
    group_id        UUID        NOT NULL REFERENCES users_group(id) ON DELETE CASCADE,
    added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    added_by_id     UUID        REFERENCES users_user(id) ON DELETE SET NULL,
    PRIMARY KEY (user_id, group_id)
);

-- Feature registry: seeded at deploy time, not user-created
CREATE TABLE users_feature (
    id              SERIAL      PRIMARY KEY,
    code            VARCHAR(50) NOT NULL UNIQUE,   -- "document", "chat", "search", ...
    name            VARCHAR(100) NOT NULL,
    description     TEXT
);

-- Predefined features
INSERT INTO users_feature (code, name, description) VALUES
    ('document',        'Document Management', 'Upload, view, delete documents'),
    ('chat',            'Chat / RAG',          'Conversational search over documents'),
    ('search',          'Search',              'Full-text and vector search'),
    ('user_management', 'User Management',     'Manage users and groups'),
    ('storage',         'Storage',             'Manage storage backend configuration'),
    ('admin',           'Administration',      'System-level administration');

-- Permission = Feature × Action
CREATE TABLE users_permission (
    id              SERIAL      PRIMARY KEY,
    feature_id      INT         NOT NULL REFERENCES users_feature(id) ON DELETE CASCADE,
    action          VARCHAR(20) NOT NULL CHECK (action IN ('create','read','update','delete')),
    codename        VARCHAR(100) NOT NULL UNIQUE,  -- "document.create", "chat.read", ...
    name            VARCHAR(200) NOT NULL,
    UNIQUE (feature_id, action)
);

-- Predefined permissions (all Feature × Action combinations)
INSERT INTO users_permission (feature_id, action, codename, name)
SELECT
    f.id,
    a.action,
    f.code || '.' || a.action,
    initcap(a.action) || ' ' || f.name
FROM users_feature f
CROSS JOIN (
    VALUES ('create'),('read'),('update'),('delete')
) AS a(action);

-- Group → Permission assignments
CREATE TABLE users_grouppermission (
    group_id        UUID        NOT NULL REFERENCES users_group(id)      ON DELETE CASCADE,
    permission_id   INT         NOT NULL REFERENCES users_permission(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, permission_id)
);

-- Per-user permission overrides (grant or deny, overrides group membership)
CREATE TABLE users_userpermission (
    user_id         UUID        NOT NULL REFERENCES users_user(id)       ON DELETE CASCADE,
    permission_id   INT         NOT NULL REFERENCES users_permission(id) ON DELETE CASCADE,
    granted         BOOLEAN     NOT NULL DEFAULT TRUE,  -- FALSE = explicit deny
    PRIMARY KEY (user_id, permission_id)
);

-- Future: document-level ACL (add when needed)
-- CREATE TABLE users_resourcepermission (
--     id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
--     resource_type   VARCHAR(50) NOT NULL,   -- "document", "folder"
--     resource_id     UUID        NOT NULL,
--     subject_type    VARCHAR(20) NOT NULL CHECK (subject_type IN ('user','group')),
--     subject_id      UUID        NOT NULL,
--     can_read        BOOLEAN     NOT NULL DEFAULT FALSE,
--     can_update      BOOLEAN     NOT NULL DEFAULT FALSE,
--     can_delete      BOOLEAN     NOT NULL DEFAULT FALSE,
--     can_share       BOOLEAN     NOT NULL DEFAULT FALSE,
--     created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
-- );
-- CREATE INDEX idx_resourcepermission_resource ON users_resourcepermission(resource_type, resource_id);
-- CREATE INDEX idx_resourcepermission_subject  ON users_resourcepermission(subject_type, subject_id);


-- =============================================================================
-- APP: storage
-- =============================================================================

CREATE TABLE storage_storageconfig (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL,
    backend_type    VARCHAR(20) NOT NULL CHECK (backend_type IN ('local','s3','minio','gcs')),
    -- IMPORTANT: encrypt credentials (access_key, secret_key) before storing.
    config          JSONB       NOT NULL DEFAULT '{}',
    is_default      BOOLEAN     NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce single default via partial unique index
CREATE UNIQUE INDEX uq_storageconfig_one_default
    ON storage_storageconfig (is_default)
    WHERE is_default = TRUE;


-- =============================================================================
-- APP: documents
-- =============================================================================

CREATE TABLE documents_folder (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    parent_id       UUID        REFERENCES documents_folder(id) ON DELETE CASCADE,
    -- Materialized path: "/uuid1/uuid2/uuid3/"
    -- Subtree query: WHERE path LIKE '/uuid1/%'
    path            VARCHAR(2048) NOT NULL DEFAULT '',
    owner_id        UUID        REFERENCES users_user(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_folder_parent  ON documents_folder(parent_id);
CREATE INDEX idx_folder_path    ON documents_folder(path);

CREATE TABLE documents_tag (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL UNIQUE,
    color           VARCHAR(7)  NOT NULL DEFAULT '#808080',
    slug            VARCHAR(120) NOT NULL UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE documents_document (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    title               VARCHAR(512) NOT NULL,
    description         TEXT,
    file_name           VARCHAR(512) NOT NULL,          -- tên file trên storage
    original_filename   VARCHAR(512) NOT NULL,          -- tên file gốc của user
    file_path           VARCHAR(2048) NOT NULL,         -- relative path trong storage
    file_size           BIGINT      NOT NULL,           -- bytes
    mime_type           VARCHAR(255) NOT NULL,
    extension           VARCHAR(50)  NOT NULL,
    checksum            VARCHAR(64)  NOT NULL,          -- SHA-256
    folder_id           UUID        REFERENCES documents_folder(id)          ON DELETE SET NULL,
    storage_config_id   UUID        NOT NULL REFERENCES storage_storageconfig(id) ON DELETE RESTRICT,
    owner_id            UUID        REFERENCES users_user(id)                ON DELETE SET NULL,
    source_type         VARCHAR(30) NOT NULL DEFAULT 'upload'
                            CHECK (source_type IN ('upload','google_drive')),
    source_metadata     JSONB,                          -- {"drive_file_id": "...", "drive_url": "..."}
    page_count          INT,
    language            VARCHAR(20),                    -- detected language code, e.g. 'vi', 'en'
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_document_folder     ON documents_document(folder_id);
CREATE INDEX idx_document_owner      ON documents_document(owner_id);
CREATE INDEX idx_document_created    ON documents_document(created_at);
CREATE INDEX idx_document_deleted    ON documents_document(deleted_at);

-- M2M: Document ↔ Tag
CREATE TABLE documents_documenttag (
    document_id     UUID        NOT NULL REFERENCES documents_document(id) ON DELETE CASCADE,
    tag_id          UUID        NOT NULL REFERENCES documents_tag(id)      ON DELETE CASCADE,
    PRIMARY KEY (document_id, tag_id)
);

CREATE TABLE documents_documentversion (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     UUID        NOT NULL REFERENCES documents_document(id) ON DELETE CASCADE,
    version_num     INT         NOT NULL,
    file_path       VARCHAR(2048) NOT NULL,
    file_size       BIGINT      NOT NULL,
    checksum        VARCHAR(64) NOT NULL,
    change_note     TEXT,
    created_by_id   UUID        REFERENCES users_user(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (document_id, version_num)
);

-- OCR text + full-text search vector (1:1 with document)
CREATE TABLE documents_documentcontent (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     UUID        NOT NULL UNIQUE REFERENCES documents_document(id) ON DELETE CASCADE,
    raw_text        TEXT        NOT NULL,
    -- TSVECTOR column for PostgreSQL FTS.
    -- Updated by a trigger (see trigger definition below).
    search_vector   TSVECTOR,
    language        VARCHAR(20),
    extracted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- GIN index for fast full-text search
CREATE INDEX idx_documentcontent_fts
    ON documents_documentcontent USING GIN (search_vector);

-- Trigger: auto-update search_vector on INSERT or UPDATE of raw_text / language
CREATE OR REPLACE FUNCTION documents_documentcontent_update_tsvector()
RETURNS TRIGGER AS '
DECLARE
    lang_config REGCONFIG;
BEGIN
    -- Map stored language code to PostgreSQL text search config.
    -- Falls back to ''simple'' for unknown / NULL languages.
    BEGIN
        lang_config := NEW.language::REGCONFIG;
    EXCEPTION WHEN OTHERS THEN
        lang_config := ''simple'';
    END;

    NEW.search_vector := to_tsvector(lang_config, coalesce(NEW.raw_text, ''''));
    RETURN NEW;
END;
' LANGUAGE plpgsql;

CREATE TRIGGER trg_documentcontent_tsvector
    BEFORE INSERT OR UPDATE OF raw_text, language
    ON documents_documentcontent
    FOR EACH ROW
    EXECUTE FUNCTION documents_documentcontent_update_tsvector();

-- RAG chunks (each chunk → 1 Qdrant vector point)
CREATE TABLE documents_documentchunk (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     UUID        NOT NULL REFERENCES documents_document(id) ON DELETE CASCADE,
    chunk_index     INT         NOT NULL,    -- 0-based sequential index within document
    content         TEXT        NOT NULL,
    token_count     INT,
    page_number     INT,
    qdrant_point_id UUID        UNIQUE,      -- ID of the vector point in Qdrant
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (document_id, chunk_index)
);

CREATE INDEX idx_documentchunk_document ON documents_documentchunk(document_id);


-- =============================================================================
-- APP: processing
-- =============================================================================

CREATE TABLE processing_processingjob (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     UUID        NOT NULL REFERENCES documents_document(id) ON DELETE CASCADE,
    job_type        VARCHAR(30) NOT NULL
                        CHECK (job_type IN ('ocr','chunk','embed','index_fts','index_vector')),
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','running','done','failed','skipped')),
    priority        INT         NOT NULL DEFAULT 5,
    retry_count     INT         NOT NULL DEFAULT 0,
    max_retries     INT         NOT NULL DEFAULT 3,
    error_message   TEXT,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_processingjob_doc_type ON processing_processingjob(document_id, job_type);
-- Worker dequeue index: pick pending jobs by priority desc
CREATE INDEX idx_processingjob_queue    ON processing_processingjob(status, priority DESC)
    WHERE status = 'pending';

CREATE TABLE processing_backgroundtask (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    celery_task_id  VARCHAR(255) UNIQUE,
    task_name       VARCHAR(255) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','running','success','failure','revoked')),
    owner_id        UUID        REFERENCES users_user(id) ON DELETE SET NULL,
    related_type    VARCHAR(50),    -- "document", "folder", ...
    related_id      UUID,
    result          JSONB,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_backgroundtask_celery ON processing_backgroundtask(celery_task_id);
CREATE INDEX idx_backgroundtask_owner  ON processing_backgroundtask(owner_id);


-- =============================================================================
-- APP: chat
-- =============================================================================

CREATE TABLE chat_chatsession (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users_user(id) ON DELETE CASCADE,
    title           VARCHAR(512),   -- auto-generated from first user message
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_chatsession_user ON chat_chatsession(user_id, deleted_at);

CREATE TABLE chat_chatmessage (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID        NOT NULL REFERENCES chat_chatsession(id) ON DELETE CASCADE,
    role            VARCHAR(20) NOT NULL CHECK (role IN ('user','assistant','system')),
    content         TEXT        NOT NULL,
    tokens_used     INT,
    model_used      VARCHAR(100),   -- "claude-sonnet-4-6", "gpt-4o", ...
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chatmessage_session ON chat_chatmessage(session_id, created_at);

-- Source documents cited by the AI to produce an assistant message
CREATE TABLE chat_chatmessagesource (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id      UUID        NOT NULL REFERENCES chat_chatmessage(id)      ON DELETE CASCADE,
    document_id     UUID        NOT NULL REFERENCES documents_document(id)    ON DELETE CASCADE,
    chunk_id        UUID        REFERENCES documents_documentchunk(id)        ON DELETE SET NULL,
    relevance_score FLOAT,
    excerpt         TEXT        -- short snippet shown to user as citation preview
);

CREATE INDEX idx_chatmessagesource_message ON chat_chatmessagesource(message_id);


-- =============================================================================
-- APP: integrations
-- =============================================================================

CREATE TABLE integrations_googledriveimport (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users_user(id) ON DELETE CASCADE,
    drive_file_id   VARCHAR(255) NOT NULL,
    drive_file_name VARCHAR(512) NOT NULL,
    drive_url       VARCHAR(2048) NOT NULL,
    mime_type       VARCHAR(255) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','importing','done','failed')),
    document_id     UUID        REFERENCES documents_document(id) ON DELETE SET NULL,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_gdriveimport_user_status ON integrations_googledriveimport(user_id, status);


-- =============================================================================
-- APP: core
-- =============================================================================

-- AI model configuration: LLM, Embedding, Reranking
CREATE TABLE core_aimodelconfig (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL,      -- display name, e.g. "GPT-4o Production"
    provider        VARCHAR(50) NOT NULL
                        CHECK (provider IN ('openai','anthropic','azure_openai','ollama','gemini','cohere')),
    model_name      VARCHAR(200) NOT NULL,      -- "gpt-4o", "claude-sonnet-4-6", ...
    purpose         VARCHAR(20) NOT NULL
                        CHECK (purpose IN ('chat','embed','rerank')),
    -- IMPORTANT: encrypt api_key before storing (AES-256 or KMS).
    api_key         TEXT,
    base_url        VARCHAR(512),               -- override endpoint (Azure, Ollama, proxy)
    extra_config    JSONB,                      -- {"temperature": 0.7, "max_tokens": 4096, ...}
    is_default      BOOLEAN     NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_aimodelconfig_purpose ON core_aimodelconfig(purpose, is_default);

-- Enforce: only 1 default per purpose
CREATE UNIQUE INDEX uq_aimodelconfig_one_default_per_purpose
    ON core_aimodelconfig (purpose)
    WHERE is_default = TRUE;

-- Key-value system configuration
CREATE TABLE core_systemconfig (
    id              SERIAL      PRIMARY KEY,
    key             VARCHAR(200) NOT NULL UNIQUE,
    value           JSONB       NOT NULL,
    description     TEXT,
    is_public       BOOLEAN     NOT NULL DEFAULT FALSE,   -- expose to frontend?
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by_id   UUID        REFERENCES users_user(id) ON DELETE SET NULL
);

-- Seed default system config values
INSERT INTO core_systemconfig (key, value, description, is_public) VALUES
    ('ocr_language',       '"vie+eng"',    'Tesseract OCR language(s)',            FALSE),
    ('max_upload_size_mb', '100',          'Maximum single file upload size (MB)', TRUE),
    ('app_title',          '"DMS"',        'Application display name',             TRUE);

-- Immutable audit log (append-only — no UPDATE, no DELETE)
CREATE TABLE core_auditlog (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        REFERENCES users_user(id) ON DELETE SET NULL,
    action          VARCHAR(100) NOT NULL,  -- "document.upload", "user.login", ...
    resource_type   VARCHAR(50),            -- "document", "folder", "user", ...
    resource_id     UUID,
    metadata        JSONB,                  -- before/after state, extra context
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_auditlog_user        ON core_auditlog(user_id, created_at);
CREATE INDEX idx_auditlog_resource    ON core_auditlog(resource_type, resource_id);
CREATE INDEX idx_auditlog_action      ON core_auditlog(action, created_at);

-- Prevent UPDATE and DELETE on audit log (append-only enforcement at DB level)
CREATE RULE auditlog_no_update AS ON UPDATE TO core_auditlog DO INSTEAD NOTHING;
CREATE RULE auditlog_no_delete AS ON DELETE TO core_auditlog DO INSTEAD NOTHING;


-- =============================================================================
-- auto-update updated_at trigger (shared utility)
-- =============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS '
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
' LANGUAGE plpgsql;

CREATE TRIGGER trg_users_user_updated_at
    BEFORE UPDATE ON users_user
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_users_group_updated_at
    BEFORE UPDATE ON users_group
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_storageconfig_updated_at
    BEFORE UPDATE ON storage_storageconfig
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_document_updated_at
    BEFORE UPDATE ON documents_document
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_folder_updated_at
    BEFORE UPDATE ON documents_folder
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_chatsession_updated_at
    BEFORE UPDATE ON chat_chatsession
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_aimodelconfig_updated_at
    BEFORE UPDATE ON core_aimodelconfig
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_systemconfig_updated_at
    BEFORE UPDATE ON core_systemconfig
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================================
-- Summary: 24 tables
-- =============================================================================
--
--  # | Table                              | App          | Plan model
-- ---+------------------------------------+--------------+--------------------
--  1 | users_user                         | users        | User
--  2 | users_group                        | users        | Group
--  3 | users_usergroup                    | users        | UserGroup
--  4 | users_feature                      | users        | Feature
--  5 | users_permission                   | users        | Permission
--  6 | users_grouppermission              | users        | GroupPermission
--  7 | users_userpermission               | users        | UserPermission
--  8 | storage_storageconfig              | storage      | StorageConfig
--  9 | documents_folder                   | documents    | Folder
-- 10 | documents_tag                      | documents    | Tag
-- 11 | documents_document                 | documents    | Document
-- 12 | documents_documenttag              | documents    | DocumentTag
-- 13 | documents_documentversion          | documents    | DocumentVersion
-- 14 | documents_documentcontent          | documents    | DocumentContent
-- 15 | documents_documentchunk            | documents    | DocumentChunk
-- 16 | processing_processingjob           | processing   | ProcessingJob
-- 17 | processing_backgroundtask          | processing   | BackgroundTask
-- 18 | chat_chatsession                   | chat         | ChatSession
-- 19 | chat_chatmessage                   | chat         | ChatMessage
-- 20 | chat_chatmessagesource             | chat         | ChatMessageSource
-- 21 | integrations_googledriveimport     | integrations | GoogleDriveImport
-- 22 | core_aimodelconfig                 | core         | AIModelConfig
-- 23 | core_systemconfig                  | core         | SystemConfig
-- 24 | core_auditlog                      | core         | AuditLog
-- ---+------------------------------------+--------------+--------------------
