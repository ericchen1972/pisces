import main
import pytest


def test_openai_key_prefers_openai_key(monkeypatch):
    monkeypatch.setattr(main, "get_config_value", lambda *keys: "configured")
    assert main.get_openai_api_key() == "configured"


def test_openai_key_accepts_both_supported_names(monkeypatch):
    seen = []

    def fake_get_config_value(*keys):
        seen.extend(keys)
        return "secret"

    monkeypatch.setattr(main, "get_config_value", fake_get_config_value)
    assert main.get_openai_api_key() == "secret"
    assert seen == ["OPENAI_KEY", "OPENAI_API_KEY"]


def test_cloud_run_requires_nondefault_session_secret(monkeypatch):
    monkeypatch.setenv("K_SERVICE", "convia-api")
    monkeypatch.delenv("SESSION_SECRET", raising=False)
    monkeypatch.setattr(main, "get_config_value", lambda *_keys: "")
    with pytest.raises(RuntimeError, match="SESSION_SECRET must be configured"):
        main.resolve_session_secret()


def test_session_secret_environment_overrides_config_without_disclosure(monkeypatch):
    monkeypatch.setenv("K_SERVICE", "convia-api")
    monkeypatch.setenv("SESSION_SECRET", "environment-secret")
    monkeypatch.setattr(main, "get_config_value", lambda *_keys: "config-secret")
    assert main.resolve_session_secret() == "environment-secret"


def test_empty_cloud_run_session_secret_does_not_fall_back_to_config(monkeypatch):
    monkeypatch.setenv("K_SERVICE", "convia-api")
    monkeypatch.setenv("SESSION_SECRET", "")
    monkeypatch.setattr(main, "get_config_value", lambda *_keys: "config-secret")
    with pytest.raises(RuntimeError, match="SESSION_SECRET must be configured"):
        main.resolve_session_secret()


def test_local_session_secret_keeps_development_fallback(monkeypatch):
    monkeypatch.delenv("K_SERVICE", raising=False)
    monkeypatch.delenv("SESSION_SECRET", raising=False)
    monkeypatch.setattr(main, "get_config_value", lambda *_keys: "")
    assert main.resolve_session_secret() == "pisces-dev-secret-key"
