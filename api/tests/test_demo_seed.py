from copy import deepcopy
from types import SimpleNamespace

import contact_groups
from demo_seed import build_tester_user_id, seed_demo_accounts
from tests.test_contact_groups import FakeFirestoreClient, fake_transactional


def install_fake_transactions(monkeypatch):
    monkeypatch.setattr(
        contact_groups,
        "firestore",
        SimpleNamespace(transactional=fake_transactional),
        raising=False,
    )


def test_seed_creates_two_accounts_mutual_friendship_and_group_metadata(monkeypatch):
    install_fake_transactions(monkeypatch)
    client = FakeFirestoreClient()

    result = seed_demo_accounts(client, server_timestamp="NOW")

    judy = result["accounts"]["judy"]
    haland = result["accounts"]["haland"]
    assert judy["email"] == "judy@gods.tw"
    assert haland["email"] == "haland@gods.tw"
    assert client.read(f'users/{judy["id"]}')["display_name"] == "Judy"
    assert client.read(f'users/{haland["id"]}')["display_name"] == "Haland"
    assert result["friendship"]["status"] == "accepted"
    assert client.read(f'users/{judy["id"]}/chat_meta/{haland["id"]}')["group_id"]
    assert client.read(f'users/{haland["id"]}/chat_meta/{judy["id"]}')["group_id"]


def test_seed_is_idempotent_and_preserves_existing_profile_data(monkeypatch):
    install_fake_transactions(monkeypatch)
    client = FakeFirestoreClient()
    client.seed(
        f"users/{build_tester_user_id('judy@gods.tw')}",
        display_name="Judy",
        email="judy@gods.tw",
        avatar_url="https://assets.example/judy.webp",
        ai_global_prompt="Keep this prompt",
        created_at="ORIGINAL",
    )

    first = seed_demo_accounts(client, server_timestamp="NOW")
    first_snapshot = deepcopy(client.data)
    second = seed_demo_accounts(client, server_timestamp="NOW")

    assert first == second
    assert client.data == first_snapshot
    judy = client.read(f'users/{first["accounts"]["judy"]["id"]}')
    assert judy["avatar_url"] == "https://assets.example/judy.webp"
    assert judy["ai_global_prompt"] == "Keep this prompt"
    assert judy["created_at"] == "ORIGINAL"
