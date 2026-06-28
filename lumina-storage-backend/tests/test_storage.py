import os
import tempfile

import pytest

from src.services.storage import LocalStorageBackend, StorageResult


@pytest.fixture
def storage_backend():
    with tempfile.TemporaryDirectory() as tmpdir:
        yield LocalStorageBackend(base_dir=tmpdir), tmpdir


async def test_save_file(storage_backend):
    backend, tmpdir = storage_backend
    data = b"hello world"
    result = await backend.save(data, "test.txt")

    assert isinstance(result, StorageResult)
    assert result.file_size == len(data)
    assert result.checksum  # SHA-256 hash
    assert result.file_path.endswith(".txt")
    assert result.file_name.endswith(".txt")

    # Verify file exists on disk
    full_path = os.path.join(tmpdir, result.file_path)
    assert os.path.exists(full_path)
    with open(full_path, "rb") as f:
        assert f.read() == data


async def test_read_file(storage_backend):
    backend, _ = storage_backend
    data = b"read me back"
    result = await backend.save(data, "read.txt")
    content = await backend.read(result.file_path)
    assert content == data


async def test_delete_file(storage_backend):
    backend, tmpdir = storage_backend
    result = await backend.save(b"delete me", "delete.txt")
    full_path = os.path.join(tmpdir, result.file_path)
    assert os.path.exists(full_path)

    await backend.delete(result.file_path)
    assert not os.path.exists(full_path)


async def test_save_empty_file(storage_backend):
    backend, _ = storage_backend
    result = await backend.save(b"", "empty.txt")
    assert result.file_size == 0


async def test_checksum_consistency(storage_backend):
    backend, _ = storage_backend
    data = b"consistent data"
    result1 = await backend.save(data, "file1.txt")
    result2 = await backend.save(data, "file2.txt")
    assert result1.checksum == result2.checksum
    assert result1.file_path != result2.file_path  # different UUIDs


async def test_path_pattern(storage_backend):
    backend, _ = storage_backend
    result = await backend.save(b"test", "document.pdf")
    # Path should be {YYYY}/{MM}/{uuid}.pdf
    parts = result.file_path.split("/")
    assert len(parts) == 3
    assert parts[0].isdigit() and len(parts[0]) == 4  # year
    assert parts[1].isdigit() and len(parts[1]) == 2  # month
    assert parts[2].endswith(".pdf")
