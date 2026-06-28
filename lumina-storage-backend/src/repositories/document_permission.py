import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.document import Document, DocumentPermission, Folder


PERMISSION_RANK = {"viewer": 1, "editor": 2, "manager": 3}


class DocumentPermissionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(self, data: dict) -> DocumentPermission:
        perm = DocumentPermission(**data)
        self.session.add(perm)
        await self.session.flush()
        await self.session.refresh(perm)
        return perm

    async def get_by_id(self, perm_id: uuid.UUID) -> DocumentPermission | None:
        result = await self.session.execute(
            select(DocumentPermission).where(DocumentPermission.id == perm_id)
        )
        return result.scalar_one_or_none()

    async def delete(self, perm_id: uuid.UUID) -> bool:
        perm = await self.get_by_id(perm_id)
        if perm is None:
            return False
        await self.session.delete(perm)
        await self.session.flush()
        return True

    async def update_permission_level(self, perm_id: uuid.UUID, permission: str) -> DocumentPermission | None:
        perm = await self.get_by_id(perm_id)
        if perm is None:
            return None
        perm.permission = permission
        await self.session.flush()
        return perm

    async def get_for_document(self, document_id: uuid.UUID) -> list[DocumentPermission]:
        result = await self.session.execute(
            select(DocumentPermission).where(DocumentPermission.document_id == document_id)
        )
        return list(result.scalars().all())

    async def get_for_folder(self, folder_id: uuid.UUID) -> list[DocumentPermission]:
        result = await self.session.execute(
            select(DocumentPermission).where(DocumentPermission.folder_id == folder_id)
        )
        return list(result.scalars().all())

    async def get_effective_permission(
        self,
        document_id: uuid.UUID | None,
        folder_id: uuid.UUID | None,
        folder_path: str | None,
        group_ids: list[uuid.UUID],
        user_id: uuid.UUID | None = None,
    ) -> str | None:
        """Return the highest permission level across direct + inherited ACL."""
        all_perms: list[str] = []

        # Direct ACL on document
        if document_id:
            conditions = [DocumentPermission.document_id == document_id]
            grantee_cond = []
            if group_ids:
                grantee_cond.append(DocumentPermission.group_id.in_(group_ids))
            if user_id:
                grantee_cond.append(DocumentPermission.user_id == user_id)
            if grantee_cond:
                result = await self.session.execute(
                    select(DocumentPermission.permission).where(*conditions, or_(*grantee_cond))
                )
                all_perms.extend(result.scalars().all())

        # Folder ACL (direct on folder + inherited from ancestor folders)
        if folder_id and folder_path:
            ancestor_ids = [uuid.UUID(part) for part in folder_path.strip("/").split("/") if part]
            if folder_id not in ancestor_ids:
                ancestor_ids.append(folder_id)
            if ancestor_ids:
                grantee_cond = []
                if group_ids:
                    grantee_cond.append(DocumentPermission.group_id.in_(group_ids))
                if user_id:
                    grantee_cond.append(DocumentPermission.user_id == user_id)
                if grantee_cond:
                    result = await self.session.execute(
                        select(DocumentPermission.permission).where(
                            DocumentPermission.folder_id.in_(ancestor_ids),
                            or_(*grantee_cond),
                        )
                    )
                    all_perms.extend(result.scalars().all())

        if not all_perms:
            return None

        return max(all_perms, key=lambda p: PERMISSION_RANK.get(p, 0))

    def build_accessible_filter(self, user_id: uuid.UUID, group_ids: list[uuid.UUID]):
        """Build SQLAlchemy OR clause for documents accessible to user."""
        conditions = [Document.owner_id == user_id]

        # Direct user ACL on document
        user_doc_subq = (
            select(DocumentPermission.document_id)
            .where(
                DocumentPermission.document_id.is_not(None),
                DocumentPermission.user_id == user_id,
            )
            .correlate(None)
        )
        conditions.append(Document.id.in_(user_doc_subq))

        # Direct user ACL via folder
        user_shared_folder_ids = (
            select(DocumentPermission.folder_id)
            .where(
                DocumentPermission.folder_id.is_not(None),
                DocumentPermission.user_id == user_id,
            )
            .correlate(None)
            .subquery()
        )
        conditions.append(Document.folder_id.in_(select(user_shared_folder_ids)))

        if group_ids:
            # Direct ACL on document via group
            direct_doc_subq = (
                select(DocumentPermission.document_id)
                .where(
                    DocumentPermission.document_id.is_not(None),
                    DocumentPermission.group_id.in_(group_ids),
                )
                .correlate(None)
            )
            conditions.append(Document.id.in_(direct_doc_subq))

            # Folder ACL via group
            shared_folder_ids = (
                select(DocumentPermission.folder_id)
                .where(
                    DocumentPermission.folder_id.is_not(None),
                    DocumentPermission.group_id.in_(group_ids),
                )
                .correlate(None)
                .subquery()
            )
            conditions.append(Document.folder_id.in_(select(shared_folder_ids)))

        # Documents in subfolders of shared folders (inheritance via path)
        from sqlalchemy import exists, literal_column
        parent_folder = Folder.__table__.alias("parent_folder")

        grantee_conds = [DocumentPermission.user_id == user_id]
        if group_ids:
            grantee_conds.append(DocumentPermission.group_id.in_(group_ids))

        inherited_folder_exists = (
            select(Folder.id).where(
                exists(
                    select(literal_column("1"))
                    .select_from(parent_folder)
                    .join(
                        DocumentPermission,
                        DocumentPermission.folder_id == parent_folder.c.id,
                    )
                    .where(
                        or_(*grantee_conds),
                        Folder.path.like(parent_folder.c.path + "/%"),
                    )
                )
            )
            .correlate(None)
        )
        conditions.append(Document.folder_id.in_(inherited_folder_exists))

        return or_(*conditions)
