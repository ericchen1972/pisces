import os
import sys
from pathlib import Path

import pytest

API_DIR = Path(__file__).resolve().parents[1]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

os.environ.setdefault("SESSION_SECRET", "test-secret")

import main  # noqa: E402


@pytest.fixture(autouse=True)
def isolate_openai_quota(monkeypatch, request):
    if request.node.get_closest_marker("real_openai_quota"):
        return
    monkeypatch.setattr(main, "enforce_openai_quota", lambda *_args, **_kwargs: None)


@pytest.fixture
def app():
    main.app.config.update(TESTING=True, SECRET_KEY="test-secret")
    return main.app


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def signed_in_client(client):
    with client.session_transaction() as session:
        session["user_id"] = "user-a"
        session["provider"] = "tester"
        session["email"] = "a@example.com"
    return client
