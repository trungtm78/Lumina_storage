"""Test structlog JSON logging."""
import json


def test_configure_and_log_json(capsys):
    from src.core.logging import configure_logging, get_logger
    configure_logging(force=True)
    log = get_logger("test")
    log.info("hello", foo="bar")
    out = capsys.readouterr().out
    assert "hello" in out and "foo" in out
    # dòng cuối phải là JSON hợp lệ có field structured
    line = [ln for ln in out.strip().splitlines() if "hello" in ln][-1]
    payload = json.loads(line)
    assert payload["event"] == "hello"
    assert payload["foo"] == "bar"
    assert payload["level"] == "info"


def test_exception_renders_valid_json(capsys):
    from src.core.logging import configure_logging, get_logger
    configure_logging(force=True)
    log = get_logger("test")
    try:
        raise ValueError("boom")
    except ValueError:
        log.exception("failed")
    out = capsys.readouterr().out
    line = [ln for ln in out.strip().splitlines() if "failed" in ln][-1]
    payload = json.loads(line)  # phải parse được (exc_info không vỡ JSON)
    assert payload["event"] == "failed"
    assert "boom" in payload.get("exception", "")


def test_log_includes_request_id_from_contextvar(capsys):
    from asgi_correlation_id.context import correlation_id
    from src.core.logging import configure_logging, get_logger
    token = correlation_id.set("test-req-id")
    try:
        configure_logging(force=True)
        get_logger("t").info("evt")
        out = capsys.readouterr().out
        line = [ln for ln in out.strip().splitlines() if "evt" in ln][-1]
        assert json.loads(line)["request_id"] == "test-req-id"
    finally:
        correlation_id.reset(token)
