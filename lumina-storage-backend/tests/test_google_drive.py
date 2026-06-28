import pytest

from src.services.google_drive import _parse_drive_url


class TestParseDriveUrl:
    def test_file_url(self):
        url = "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view?usp=sharing"
        file_id, drive_type = _parse_drive_url(url)
        assert file_id == "1AbCdEfGhIjKlMnOpQrStUvWxYz"
        assert drive_type == "file"

    def test_file_url_open_format(self):
        url = "https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz"
        file_id, drive_type = _parse_drive_url(url)
        assert file_id == "1AbCdEfGhIjKlMnOpQrStUvWxYz"
        assert drive_type == "file"

    def test_docs_url(self):
        url = "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit"
        file_id, drive_type = _parse_drive_url(url)
        assert file_id == "1AbCdEfGhIjKlMnOpQrStUvWxYz"
        assert drive_type == "file"

    def test_spreadsheet_url(self):
        url = "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit"
        file_id, drive_type = _parse_drive_url(url)
        assert file_id == "1AbCdEfGhIjKlMnOpQrStUvWxYz"
        assert drive_type == "file"

    def test_folder_url(self):
        url = "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz?usp=sharing"
        folder_id, drive_type = _parse_drive_url(url)
        assert folder_id == "1AbCdEfGhIjKlMnOpQrStUvWxYz"
        assert drive_type == "folder"

    def test_invalid_url(self):
        from src.core.exceptions import BadRequestError
        with pytest.raises(BadRequestError):
            _parse_drive_url("https://example.com/not-a-drive-url")

    def test_invalid_url_empty(self):
        from src.core.exceptions import BadRequestError
        with pytest.raises(BadRequestError):
            _parse_drive_url("")
