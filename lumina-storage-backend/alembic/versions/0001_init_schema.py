"""init schema - create all 26 tables

Revision ID: 0001
Revises: None
Create Date: 2026-04-07
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import INET, JSONB, TSVECTOR, UUID

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── users ────────────────────────────────────────────────────────────
    op.create_table(
        "users_user",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("username", sa.String(150), nullable=False, unique=True),
        sa.Column("email", sa.String(254), nullable=False, unique=True),
        sa.Column("full_name", sa.String(255), nullable=False, server_default=""),
        sa.Column("avatar", sa.String(512), nullable=True),
        sa.Column("password", sa.Text, nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("last_login", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    op.create_table(
        "users_role",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(150), nullable=False, unique=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("is_default", sa.Boolean, nullable=False, server_default="false"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    op.create_table(
        "users_userrole",
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users_user.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "role_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users_role.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "added_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "added_by_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users_user.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    op.create_table(
        "users_menupermission",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("urlpath", sa.String(200), nullable=False, unique=True),
        sa.Column("order_index", sa.Integer, nullable=False, server_default="0"),
    )

    op.create_table(
        "users_rolemenupermission",
        sa.Column(
            "role_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users_role.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "menu_permission_id",
            sa.Integer,
            sa.ForeignKey("users_menupermission.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("level", sa.SmallInteger, nullable=False),
    )

    # ── groups ───────────────────────────────────────────────────────────
    op.create_table(
        "groups_group",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("type", sa.String(10), nullable=False),
        sa.Column(
            "is_select_all", sa.Boolean, nullable=False, server_default="false"
        ),
        sa.Column(
            "filter_role_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users_role.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "created_by_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users_user.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    op.create_table(
        "groups_groupmember",
        sa.Column(
            "group_id",
            UUID(as_uuid=True),
            sa.ForeignKey("groups_group.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users_user.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )

    op.create_table(
        "groups_groupexclude",
        sa.Column(
            "group_id",
            UUID(as_uuid=True),
            sa.ForeignKey("groups_group.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users_user.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )

    # ── storage ──────────────────────────────────────────────────────────
    op.create_table(
        "storage_storageconfig",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("backend_type", sa.String(20), nullable=False),
        sa.Column("config", JSONB, nullable=False, server_default="{}"),
        sa.Column("is_default", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column(
            "owner_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users_user.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    op.create_index(
        "uq_storageconfig_one_default",
        "storage_storageconfig",
        ["is_default"],
        unique=True,
        postgresql_where=sa.text("is_default = TRUE"),
    )

    # ── documents ────────────────────────────────────────────────────────
    op.create_table(
        "documents_folder",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column(
            "parent_id",
            UUID(as_uuid=True),
            sa.ForeignKey("documents_folder.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("path", sa.String(2048), nullable=False, server_default=""),
        sa.Column(
            "owner_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users_user.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    op.create_index("idx_folder_parent", "documents_folder", ["parent_id"])
    op.create_index("idx_folder_path", "documents_folder", ["path"])

    op.create_table(
        "documents_tag",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False, unique=True),
        sa.Column("color", sa.String(7), nullable=False, server_default="#808080"),
        sa.Column("slug", sa.String(120), nullable=False, unique=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    op.create_table(
        "documents_document",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("file_name", sa.String(512), nullable=False),
        sa.Column("original_filename", sa.String(512), nullable=False),
        sa.Column("file_path", sa.String(2048), nullable=False),
        sa.Column("file_size", sa.BigInteger, nullable=False),
        sa.Column("mime_type", sa.String(255), nullable=False),
        sa.Column("extension", sa.String(50), nullable=False),
        sa.Column("checksum", sa.String(64), nullable=False),
        sa.Column(
            "folder_id",
            UUID(as_uuid=True),
            sa.ForeignKey("documents_folder.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "storage_config_id",
            UUID(as_uuid=True),
            sa.ForeignKey("storage_storageconfig.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "owner_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users_user.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "source_type", sa.String(30), nullable=False, server_default="upload"
        ),
        sa.Column("source_metadata", JSONB, nullable=True),
        sa.Column("page_count", sa.Integer, nullable=True),
        sa.Column("language", sa.String(20), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("starred", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("image_thumbnail", sa.String(2048), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    op.create_index("idx_document_folder", "documents_document", ["folder_id"])
    op.create_index("idx_document_owner", "documents_document", ["owner_id"])
    op.create_index("idx_document_created", "documents_document", ["created_at"])
    op.create_index("idx_document_deleted", "documents_document", ["deleted_at"])

    op.create_table(
        "documents_documenttag",
        sa.Column(
            "document_id",
            UUID(as_uuid=True),
            sa.ForeignKey("documents_document.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "tag_id",
            UUID(as_uuid=True),
            sa.ForeignKey("documents_tag.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )

    op.create_table(
        "documents_documentversion",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "document_id",
            UUID(as_uuid=True),
            sa.ForeignKey("documents_document.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version_num", sa.Integer, nullable=False),
        sa.Column("file_path", sa.String(2048), nullable=False),
        sa.Column("file_size", sa.BigInteger, nullable=False),
        sa.Column("checksum", sa.String(64), nullable=False),
        sa.Column("change_note", sa.Text, nullable=True),
        sa.Column(
            "created_by_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users_user.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "document_id", "version_num", name="uq_documentversion_doc_version"
        ),
    )

    op.create_table(
        "documents_documentcontent",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "document_id",
            UUID(as_uuid=True),
            sa.ForeignKey("documents_document.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("raw_text", sa.Text, nullable=False),
        sa.Column("search_vector", TSVECTOR, nullable=True),
        sa.Column("language", sa.String(20), nullable=True),
        sa.Column(
            "extracted_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    op.create_index(
        "idx_documentcontent_fts",
        "documents_documentcontent",
        ["search_vector"],
        postgresql_using="gin",
    )

    op.create_table(
        "documents_documentchunk",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "document_id",
            UUID(as_uuid=True),
            sa.ForeignKey("documents_document.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("chunk_index", sa.Integer, nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("token_count", sa.Integer, nullable=True),
        sa.Column("page_number", sa.Integer, nullable=True),
        sa.Column("qdrant_point_id", UUID(as_uuid=True), nullable=True, unique=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "document_id", "chunk_index", name="uq_documentchunk_doc_index"
        ),
    )

    op.create_index(
        "idx_documentchunk_document", "documents_documentchunk", ["document_id"]
    )

    op.create_table(
        "documents_documentpermission",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "document_id",
            UUID(as_uuid=True),
            sa.ForeignKey("documents_document.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "folder_id",
            UUID(as_uuid=True),
            sa.ForeignKey("documents_folder.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "group_id",
            UUID(as_uuid=True),
            sa.ForeignKey("groups_group.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("permission", sa.String(10), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "created_by_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users_user.id"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "(document_id IS NOT NULL AND folder_id IS NULL) OR (document_id IS NULL AND folder_id IS NOT NULL)",
            name="chk_docperm_target",
        ),
        sa.UniqueConstraint("document_id", "group_id", name="uq_docperm_doc_group"),
        sa.UniqueConstraint("folder_id", "group_id", name="uq_docperm_folder_group"),
    )

    op.create_index(
        "idx_docperm_document", "documents_documentpermission", ["document_id"]
    )
    op.create_index(
        "idx_docperm_folder", "documents_documentpermission", ["folder_id"]
    )
    op.create_index(
        "idx_docperm_group", "documents_documentpermission", ["group_id"]
    )

    # ── processing ───────────────────────────────────────────────────────
    op.create_table(
        "processing_processingjob",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "document_id",
            UUID(as_uuid=True),
            sa.ForeignKey("documents_document.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("job_type", sa.String(30), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("priority", sa.Integer, nullable=False, server_default="5"),
        sa.Column("retry_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("max_retries", sa.Integer, nullable=False, server_default="3"),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    op.create_index(
        "idx_processingjob_doc_type",
        "processing_processingjob",
        ["document_id", "job_type"],
    )
    op.create_index(
        "idx_processingjob_queue",
        "processing_processingjob",
        ["status", "priority"],
        postgresql_where=sa.text("status = 'pending'"),
    )

    op.create_table(
        "processing_backgroundtask",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("job_id", sa.String(255), nullable=True, unique=True),
        sa.Column("task_name", sa.String(255), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column(
            "owner_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users_user.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("related_type", sa.String(50), nullable=True),
        sa.Column("related_id", UUID(as_uuid=True), nullable=True),
        sa.Column("result", JSONB, nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_index(
        "idx_backgroundtask_job_id", "processing_backgroundtask", ["job_id"]
    )
    op.create_index(
        "idx_backgroundtask_owner", "processing_backgroundtask", ["owner_id"]
    )

    # ── chat ─────────────────────────────────────────────────────────────
    op.create_table(
        "chat_chatsession",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users_user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(512), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    op.create_index(
        "idx_chatsession_user", "chat_chatsession", ["user_id", "deleted_at"]
    )

    op.create_table(
        "chat_chatmessage",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "session_id",
            UUID(as_uuid=True),
            sa.ForeignKey("chat_chatsession.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("tokens_used", sa.Integer, nullable=True),
        sa.Column("model_used", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_index(
        "idx_chatmessage_session",
        "chat_chatmessage",
        ["session_id", "created_at"],
    )

    op.create_table(
        "chat_chatmessagesource",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "message_id",
            UUID(as_uuid=True),
            sa.ForeignKey("chat_chatmessage.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "document_id",
            UUID(as_uuid=True),
            sa.ForeignKey("documents_document.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "chunk_id",
            UUID(as_uuid=True),
            sa.ForeignKey("documents_documentchunk.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "citation_index", sa.Integer, nullable=False, server_default="0"
        ),
        sa.Column("page_number", sa.Integer, nullable=True),
        sa.Column("relevance_score", sa.Float, nullable=True),
        sa.Column("excerpt", sa.Text, nullable=True),
    )

    op.create_index(
        "idx_chatmessagesource_message",
        "chat_chatmessagesource",
        ["message_id"],
    )

    # ── integrations ─────────────────────────────────────────────────────
    op.create_table(
        "integrations_googledriveimport",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users_user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("drive_file_id", sa.String(255), nullable=False),
        sa.Column("drive_file_name", sa.String(512), nullable=False),
        sa.Column("drive_url", sa.String(2048), nullable=False),
        sa.Column("mime_type", sa.String(255), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column(
            "document_id",
            UUID(as_uuid=True),
            sa.ForeignKey("documents_document.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_index(
        "idx_gdriveimport_user_status",
        "integrations_googledriveimport",
        ["user_id", "status"],
    )

    # ── core ─────────────────────────────────────────────────────────────
    op.create_table(
        "core_aimodelconfig",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("model_name", sa.String(200), nullable=False),
        sa.Column("purpose", sa.String(20), nullable=False),
        sa.Column("api_key", sa.Text, nullable=True),
        sa.Column("base_url", sa.String(512), nullable=True),
        sa.Column("extra_config", JSONB, nullable=True),
        sa.Column("is_default", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    op.create_index(
        "idx_aimodelconfig_purpose",
        "core_aimodelconfig",
        ["purpose", "is_default"],
    )
    op.create_index(
        "uq_aimodelconfig_one_default_per_purpose",
        "core_aimodelconfig",
        ["purpose"],
        unique=True,
        postgresql_where=sa.text("is_default = TRUE"),
    )

    op.create_table(
        "core_systemconfig",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("key", sa.String(200), nullable=False, unique=True),
        sa.Column("value", JSONB, nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("is_public", sa.Boolean, nullable=False, server_default="false"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_by_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users_user.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    op.create_table(
        "core_auditlog",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users_user.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("resource_type", sa.String(50), nullable=True),
        sa.Column("resource_id", UUID(as_uuid=True), nullable=True),
        sa.Column("metadata", JSONB, nullable=True),
        sa.Column("ip_address", INET, nullable=True),
        sa.Column("user_agent", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    op.create_index(
        "idx_auditlog_user", "core_auditlog", ["user_id", "created_at"]
    )
    op.create_index(
        "idx_auditlog_resource",
        "core_auditlog",
        ["resource_type", "resource_id"],
    )
    op.create_index(
        "idx_auditlog_action", "core_auditlog", ["action", "created_at"]
    )


def downgrade() -> None:
    # Drop in reverse dependency order
    op.drop_table("core_auditlog")
    op.drop_table("core_systemconfig")
    op.drop_index("uq_aimodelconfig_one_default_per_purpose", table_name="core_aimodelconfig")
    op.drop_index("idx_aimodelconfig_purpose", table_name="core_aimodelconfig")
    op.drop_table("core_aimodelconfig")

    op.drop_table("integrations_googledriveimport")

    op.drop_table("chat_chatmessagesource")
    op.drop_table("chat_chatmessage")
    op.drop_table("chat_chatsession")

    op.drop_table("processing_backgroundtask")
    op.drop_table("processing_processingjob")

    op.drop_table("documents_documentpermission")
    op.drop_table("documents_documentchunk")
    op.drop_index("idx_documentcontent_fts", table_name="documents_documentcontent")
    op.drop_table("documents_documentcontent")
    op.drop_table("documents_documentversion")
    op.drop_table("documents_documenttag")
    op.drop_table("documents_document")
    op.drop_table("documents_tag")
    op.drop_table("documents_folder")

    op.drop_index("uq_storageconfig_one_default", table_name="storage_storageconfig")
    op.drop_table("storage_storageconfig")

    op.drop_table("groups_groupexclude")
    op.drop_table("groups_groupmember")
    op.drop_table("groups_group")

    op.drop_table("users_rolemenupermission")
    op.drop_table("users_menupermission")
    op.drop_table("users_userrole")
    op.drop_table("users_role")
    op.drop_table("users_user")
