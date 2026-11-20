import base64

import httpx
import pytest

from shipping_ai.integrations import gmail


def test_download_attachment_from_gmail_api(monkeypatch, tmp_path):
    monkeypatch.setenv("SHIPPING_DATABASE_URL", "postgresql://test@localhost/test")
    monkeypatch.setenv("SHIPPING_REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setenv("SHIPPING_ENVIRONMENT", "test")
    monkeypatch.setenv("SHIPPING_WEB_ORIGIN", "http://localhost:3000")
    monkeypatch.setenv("SHIPPING_STORAGE_DIR", str(tmp_path))
    monkeypatch.setattr(gmail, "settings", gmail.settings.__wrapped__)
    original = b"%PDF-1.4\n% Gmail attachment fixture\n"
    encoded = base64.urlsafe_b64encode(original).decode().rstrip("=")

    def google(request):
        assert request.url.path == "/gmail/v1/users/me/messages/mail1/attachments/part1"
        assert request.headers["Authorization"] == "Bearer test-access"
        return httpx.Response(200, json={"data": encoded, "size": len(original)})

    part = {
        "filename": "test.pdf",
        "mimeType": "application/pdf",
        "body": {"size": len(original), "attachmentId": "part1"},
    }
    with httpx.Client(transport=httpx.MockTransport(google)) as client:
        files, _ = gmail.attachments(client, "test-access", "mail1", {"parts": [part, part]})

    assert len(files) == 1
    stored = next(iter(files.values()))
    assert gmail.LocalStorage(tmp_path).path(stored.sha256).read_bytes() == original


def test_gmail_http_response_limit():
    def google(_request):
        return httpx.Response(200, json={"data": "example"})

    with (
        httpx.Client(transport=httpx.MockTransport(google)) as client,
        pytest.raises(gmail.GmailError) as error,
    ):
        gmail.get(client, "test-access", "history", max_bytes=3)

    assert error.value.code == "gmail_response_too_large"
