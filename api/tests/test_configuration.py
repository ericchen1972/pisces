import main


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
