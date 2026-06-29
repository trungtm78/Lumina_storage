import os
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text as _sa_text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from main import create_app
from src.core.database import get_db
import src.models  # noqa: F401 — ensure all models are registered
from src.models.base import Base
from src.core.security import create_access_token, hash_password
from src.models.user import Role, User, UserRole
from src.models.storage import StorageConfig

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://postgres:postgres123@localhost:5432/lumina_driver_test",
)


async def _enqueue_test_job(*_args, **_kwargs):
    return SimpleNamespace(job_id=f"test-job-{uuid.uuid4()}")


@pytest_asyncio.fixture(scope="session")
async def test_engine():
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        # Phase 5a: FTS dùng unaccent (test DB build từ create_all, không qua migration
        # 20260428a002 vốn tạo extension này) → tạo ở đây cho test hybrid retrieval.
        await conn.execute(_sa_text("CREATE EXTENSION IF NOT EXISTS unaccent"))
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(test_engine):
    """Isolate each test even when request dependencies call ``commit()``."""
    async with test_engine.connect() as connection:
        transaction = await connection.begin()
        session_factory = async_sessionmaker(
            bind=connection,
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        )
        async with session_factory() as session:
            yield session
        await transaction.rollback()


@pytest_asyncio.fixture
async def async_client(db_session: AsyncSession):
    app = create_app()
    app.state.arq_pool = SimpleNamespace(
        enqueue_job=AsyncMock(side_effect=_enqueue_test_job)
    )

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


@pytest_asyncio.fixture
async def test_user(db_session: AsyncSession) -> User:
    suffix = uuid.uuid4().hex[:8]
    user = User(
        id=uuid.uuid4(),
        username=f"testuser_{suffix}",
        email=f"test_{suffix}@example.com",
        full_name="Test User",
        password=hash_password("password123"),
        is_active=True,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def superuser(db_session: AsyncSession) -> User:
    suffix = uuid.uuid4().hex[:8]
    user = User(
        id=uuid.uuid4(),
        username=f"admin_{suffix}",
        email=f"admin_{suffix}@example.com",
        full_name="Admin User",
        password=hash_password("admin123"),
        is_active=True,
    )
    role = Role(
        id=uuid.uuid4(),
        name=f"admin_{suffix}",
        description="Test admin role",
        is_default=True,
    )
    db_session.add(user)
    db_session.add(role)
    await db_session.flush()
    db_session.add(UserRole(user_id=user.id, role_id=role.id, added_by_id=None))
    await db_session.flush()
    await db_session.refresh(user, attribute_names=["roles"])
    return user


@pytest_asyncio.fixture
def auth_headers(test_user: User) -> dict[str, str]:
    token = create_access_token({"sub": str(test_user.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
def admin_headers(superuser: User) -> dict[str, str]:
    token = create_access_token({"sub": str(superuser.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def default_storage_config(db_session: AsyncSession) -> StorageConfig:
    """Provide a default StorageConfig scoped to the current test transaction."""
    config = StorageConfig(
        id=uuid.uuid4(),
        name="Local Test Storage",
        backend_type="local",
        config={"base_dir": "/tmp/lumina-test-uploads"},
        is_default=True,
        is_active=True,
    )
    db_session.add(config)
    await db_session.flush()
    return config
