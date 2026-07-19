from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

import main

pytestmark = pytest.mark.real_openai_quota


def test_legacy_chat_requires_verified_session_before_openai(client, monkeypatch):
    monkeypatch.setattr(
        main,
        "get_openai_service",
        lambda: pytest.fail("anonymous chat must not reach OpenAI"),
    )

    response = client.post("/api/chat", json={"message": "hello"})

    assert response.status_code == 401
    assert response.get_json() == {"ok": False, "error": "unauthorized"}


def test_general_openai_quota_is_transactional_isolated_and_resets(monkeypatch):
    records = {}

    class Snapshot:
        def __init__(self, data):
            self.exists = data is not None
            self._data = data

        def to_dict(self):
            return dict(self._data or {})

    class Ref:
        def __init__(self, user_id, category):
            self.key = (user_id, category)

        def get(self, transaction=None):
            assert transaction is not None
            return Snapshot(records.get(self.key))

    class Transaction:
        def set(self, ref, payload):
            records[ref.key] = dict(payload)

    class Client:
        def transaction(self):
            return Transaction()

        def collection(self, _name):
            return SimpleNamespace(
                document=lambda user_id: SimpleNamespace(
                    collection=lambda _sub: SimpleNamespace(
                        document=lambda category: Ref(user_id, category)
                    )
                )
            )

    monkeypatch.setattr(main.firestore, "transactional", lambda fn: fn)
    client = Client()
    now = datetime(2026, 7, 16, 10, 0, tzinfo=timezone.utc)
    limits = {"minute": 2, "hour": 3}

    assert main.consume_openai_quota("user-a", "text", now=now, client=client, limits=limits)["allowed"]
    assert main.consume_openai_quota("user-a", "text", now=now, client=client, limits=limits)["allowed"]
    blocked = main.consume_openai_quota("user-a", "text", now=now, client=client, limits=limits)
    assert blocked["allowed"] is False
    assert 1 <= blocked["retry_after"] <= 60
    assert main.consume_openai_quota("user-b", "text", now=now, client=client, limits=limits)["allowed"]
    assert main.consume_openai_quota("user-a", "tts", now=now, client=client, limits=limits)["allowed"]
    assert main.consume_openai_quota("user-a", "text", now=now + timedelta(seconds=61), client=client, limits=limits)["allowed"]
    hourly = main.consume_openai_quota("user-a", "text", now=now + timedelta(seconds=61), client=client, limits=limits)
    assert hourly["allowed"] is False
    assert main.consume_openai_quota("user-a", "text", now=now + timedelta(hours=1, seconds=1), client=client, limits=limits)["allowed"]


@pytest.mark.parametrize(
    ("cloud_service", "flag", "expected"),
    [
        (None, None, True),
        ("convia-api", None, False),
        ("convia-api", "true", True),
        (None, "false", False),
    ],
)
def test_tester_login_capability_defaults_safely(monkeypatch, cloud_service, flag, expected):
    if cloud_service is None:
        monkeypatch.delenv("K_SERVICE", raising=False)
    else:
        monkeypatch.setenv("K_SERVICE", cloud_service)
    if flag is None:
        monkeypatch.delenv("ENABLE_TESTER_LOGIN", raising=False)
    else:
        monkeypatch.setenv("ENABLE_TESTER_LOGIN", flag)
    monkeypatch.setattr(main.os.path, "exists", lambda _path: False)

    assert main.is_tester_login_enabled() is expected


def test_session_capability_and_disabled_tester_route(client, monkeypatch):
    monkeypatch.setenv("K_SERVICE", "convia-api")
    monkeypatch.delenv("ENABLE_TESTER_LOGIN", raising=False)
    monkeypatch.setattr(main.os.path, "exists", lambda _path: False)
    records = {}

    class Snapshot:
        exists = False

        def to_dict(self):
            return {}

    class UserRef:
        def __init__(self, user_id):
            self.user_id = user_id

        def get(self):
            return Snapshot()

        def set(self, payload, merge=False):
            records[self.user_id] = dict(payload)

    monkeypatch.setattr(
        main,
        "get_firestore_client",
        lambda: SimpleNamespace(
            collection=lambda _name: SimpleNamespace(
                document=lambda user_id: UserRef(user_id)
            )
        ),
    )

    me = client.get("/api/session/me")
    allowed_me = client.get(
        "/api/session/me",
        headers={"X-Forwarded-For": f"{main.JUDY_LOGIN_ALLOWED_IP}, 10.0.0.1"},
    )
    login = client.post("/api/auth/tester", json={"email": "a@example.com"})
    judy_blocked = client.post("/api/auth/tester", json={"email": main.JUDY_TESTER_EMAIL})
    judy_login = client.post(
        "/api/auth/tester",
        json={"email": main.JUDY_TESTER_EMAIL},
        headers={"X-Forwarded-For": main.JUDY_LOGIN_ALLOWED_IP},
    )

    assert me.status_code == 200
    assert me.get_json()["tester_login_enabled"] is False
    assert me.get_json()["judy_login_enabled"] is False
    assert allowed_me.get_json()["judy_login_enabled"] is True
    assert login.status_code == 404
    assert login.get_json() == {"ok": False, "error": "not found"}
    assert judy_blocked.status_code == 404
    assert judy_login.status_code == 200
    assert judy_login.get_json()["user"]["email"] == main.JUDY_TESTER_EMAIL


def test_tester_login_environment_flag_overrides_config(monkeypatch):
    monkeypatch.setenv("K_SERVICE", "convia-api")
    monkeypatch.setenv("ENABLE_TESTER_LOGIN", "false")
    monkeypatch.setattr(main, "get_config_value", lambda *_keys: "true")

    assert main.is_tester_login_enabled() is False


def test_chat_text_cap_is_checked_before_quota_or_provider(signed_in_client, monkeypatch):
    monkeypatch.setattr(main, "consume_openai_quota", lambda *_a, **_k: pytest.fail("invalid input must not consume quota"))
    monkeypatch.setattr(main, "get_openai_service", lambda: pytest.fail("invalid input must not reach OpenAI"))

    response = signed_in_client.post("/api/chat", json={"message": "x" * 20001})

    assert response.status_code == 413
    assert response.get_json() == {"ok": False, "error": "message is too long"}


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        ("/api/chat", {"message": 123}),
        ("/api/assist/message", {"contact_id": "friend-a", "message": ["bad"]}),
    ],
)
def test_text_entrypoints_reject_non_string_messages_before_provider(signed_in_client, monkeypatch, path, payload):
    monkeypatch.setattr(main, "consume_openai_quota", lambda *_a, **_k: pytest.fail("invalid input must not consume quota"))
    monkeypatch.setattr(main, "get_openai_service", lambda: pytest.fail("invalid input must not reach OpenAI"))

    response = signed_in_client.post(path, json=payload)

    assert response.status_code == 400
    assert response.get_json() == {"ok": False, "error": "message must be a string"}


def test_tts_4096_cap_is_checked_before_quota_or_provider(signed_in_client, monkeypatch):
    monkeypatch.setattr(main, "consume_openai_quota", lambda *_a, **_k: pytest.fail("invalid input must not consume quota"))
    monkeypatch.setattr(main, "get_openai_service", lambda: pytest.fail("invalid input must not reach OpenAI"))

    response = signed_in_client.post(
        "/api/speech/synthesize",
        json={"text": "x" * 4097, "voice": "marin"},
    )

    assert response.status_code == 413
    assert response.get_json() == {"ok": False, "error": "text is too long"}


def test_audio_actual_bytes_cap_is_checked_before_quota_or_provider(signed_in_client, monkeypatch):
    monkeypatch.setattr(main, "MAX_AUDIO_BYTES", 3)
    monkeypatch.setattr(main, "MAX_AUDIO_BASE64_CHARS", 100)
    monkeypatch.setattr(main, "consume_openai_quota", lambda *_a, **_k: pytest.fail("invalid input must not consume quota"))
    monkeypatch.setattr(main, "transcribe_audio_bytes", lambda *_a, **_k: pytest.fail("invalid input must not reach OpenAI"))

    response = signed_in_client.post(
        "/api/speech/transcribe",
        json={"audio_base64": "YWJjZA==", "mime_type": "audio/wav"},
    )

    assert response.status_code == 413
    assert response.get_json() == {"ok": False, "error": "audio payload is too large"}


def test_route_quota_rejection_has_stable_json_and_retry_after(signed_in_client, monkeypatch):
    monkeypatch.setattr(
        main,
        "consume_openai_quota",
        lambda user_id, category: {"allowed": False, "retry_after": 17},
    )
    monkeypatch.setattr(main, "get_openai_service", lambda: pytest.fail("blocked quota must not reach OpenAI"))

    response = signed_in_client.post("/api/chat", json={"message": "hello"})

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "17"
    assert response.get_json() == {
        "ok": False,
        "error": "openai_rate_limit_exceeded",
        "category": "text",
    }


def test_provider_failure_is_counted_by_consuming_quota_first(signed_in_client, monkeypatch):
    consumed = []
    monkeypatch.setattr(
        main,
        "consume_openai_quota",
        lambda user_id, category: consumed.append((user_id, category)) or {"allowed": True, "retry_after": 0},
    )
    monkeypatch.setattr(
        main,
        "transcribe_audio_bytes",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("provider down")),
    )

    response = signed_in_client.post(
        "/api/speech/transcribe",
        json={"audio_base64": "YWJj", "mime_type": "audio/wav"},
    )

    assert response.status_code == 502
    assert consumed == [("user-a", "transcription")]


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        ("/api/chat/stream", {"contact_id": "pisces-core", "message": "x" * 20001}),
        ("/api/assist/message", {"contact_id": "friend-a", "message": "x" * 20001}),
    ],
)
def test_all_text_entrypoints_reject_oversize_before_quota(signed_in_client, monkeypatch, path, payload):
    monkeypatch.setattr(main, "consume_openai_quota", lambda *_a, **_k: pytest.fail("invalid input must not consume quota"))
    monkeypatch.setattr(main, "get_openai_service", lambda: pytest.fail("invalid input must not reach OpenAI"))

    response = signed_in_client.post(path, json=payload)

    assert response.status_code == 413
    assert response.get_json() == {"ok": False, "error": "message is too long"}


def test_every_paid_route_has_server_quota_wiring():
    source = Path(main.__file__).read_text(encoding="utf-8")
    route_categories = {
        "def chat()": 'enforce_openai_quota(user_id, "text")',
        "def chat_stream()": 'enforce_openai_quota(user_id, "text")',
        "def voice_chat()": 'enforce_openai_quota(user_id, "voice")',
        "def speech_transcribe()": 'enforce_openai_quota(auth["user_id"], "transcription")',
        "def speech_synthesize()": 'enforce_openai_quota(auth["user_id"], "tts")',
        "def send_voice_message()": 'enforce_openai_quota(sender_user_id, "transcription")',
        "def assist_message()": 'enforce_openai_quota(user_id, "text")',
        "def openai_realtime_client_secret()": "create_realtime_session_response",
        "def openai_realtime_about_friend_context()": 'enforce_openai_quota(user_id, "text")',
    }
    for index, (function_marker, quota_marker) in enumerate(route_categories.items()):
        start = source.index(function_marker)
        next_starts = [source.find(marker, start + len(function_marker)) for marker in route_categories if source.find(marker, start + len(function_marker)) >= 0]
        end = min(next_starts) if next_starts else len(source)
        assert quota_marker in source[start:end], function_marker


@pytest.mark.parametrize("text", [123, ["Convia", "bad"], {"text": "Convia bad"}])
def test_messages_send_rejects_non_string_text_before_quota_or_provider(
    signed_in_client, monkeypatch, text
):
    monkeypatch.setattr(
        main,
        "enforce_openai_quota",
        lambda *_a, **_k: pytest.fail("invalid input must not consume quota"),
    )
    monkeypatch.setattr(
        main,
        "get_openai_service",
        lambda: pytest.fail("invalid input must not reach OpenAI"),
    )

    response = signed_in_client.post(
        "/api/messages/send",
        json={"recipient_user_id": "user-b", "text": text, "request_id": "bad-text"},
    )

    assert response.status_code == 400
    assert response.get_json() == {"ok": False, "error": "text must be a string"}


def test_messages_send_rejects_oversize_text_before_quota_or_provider(
    signed_in_client, monkeypatch
):
    monkeypatch.setattr(
        main,
        "enforce_openai_quota",
        lambda *_a, **_k: pytest.fail("invalid input must not consume quota"),
    )
    monkeypatch.setattr(
        main,
        "get_openai_service",
        lambda: pytest.fail("invalid input must not reach OpenAI"),
    )

    response = signed_in_client.post(
        "/api/messages/send",
        json={
            "recipient_user_id": "user-b",
            "text": "Convia " + "x" * main.MAX_CHAT_TEXT_CHARS,
            "request_id": "too-long-text",
        },
    )

    assert response.status_code == 413
    assert response.get_json() == {"ok": False, "error": "text is too long"}
