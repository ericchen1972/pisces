import base64

import pytest

import main
from contact_groups import ContactGroupError
from test_contact_groups import (
    FakeFirestoreClient,
    FakeTransaction,
    FakeTransactionConflict,
    fake_transactional,
)


@pytest.fixture(autouse=True)
def main_firestore_transactional_wrapper(monkeypatch):
    monkeypatch.setattr(main.firestore, "transactional", fake_transactional)


class StubContactGroupService:
    def __init__(self):
        self.calls = []

    def bootstrap(self, user_id, locale):
        self.calls.append(("bootstrap", user_id, locale))
        return [{"id": "others", "name": "路人甲", "sort_order": 0}]

    def list_groups(self, user_id):
        self.calls.append(("list_groups", user_id))
        return [{"id": "friends", "name": "Friends", "sort_order": 0}]

    def get_default_group_id(self, user_id):
        self.calls.append(("get_default_group_id", user_id))
        return "friends"

    def create(self, user_id, name):
        self.calls.append(("create", user_id, name))

    def rename(self, user_id, group_id, name):
        self.calls.append(("rename", user_id, group_id, name))

    def reorder(self, user_id, ordered_group_ids):
        self.calls.append(("reorder", user_id, ordered_group_ids))
        return [{"id": group_id} for group_id in ordered_group_ids]

    def assign(self, user_id, contact_id, group_id):
        self.calls.append(("assign", user_id, contact_id, group_id))
        return {"contact_id": contact_id, "group_id": group_id}

    def delete(self, user_id, group_id, move_to_group_id):
        self.calls.append(("delete", user_id, group_id, move_to_group_id))
        return {
            "deleted_group_id": group_id,
            "move_to_group_id": move_to_group_id,
        }


def test_contact_group_list_requires_authentication(client):
    response = client.post("/api/contact-groups/list", json={})

    assert response.status_code == 401
    assert response.get_json()["ok"] is False


def test_contact_group_list_returns_authoritative_default_when_it_is_not_last(
    signed_in_client, monkeypatch
):
    firestore = FakeFirestoreClient()
    firestore.seed("users/user-a", default_contact_group_id="family")
    firestore.seed(
        "users/user-a/contact_groups/business",
        name="Business",
        normalized_name="business",
        sort_order=0,
    )
    firestore.seed(
        "users/user-a/contact_groups/family",
        name="Home",
        normalized_name="home",
        sort_order=1,
    )
    firestore.seed(
        "users/user-a/contact_groups/friends",
        name="Friends",
        normalized_name="friends",
        sort_order=2,
    )
    monkeypatch.setattr(main, "get_firestore_client", lambda: firestore)

    response = signed_in_client.post("/api/contact-groups/list", json={})

    assert response.status_code == 200
    assert response.get_json()["default_contact_group_id"] == "family"
    assert [group["id"] for group in response.get_json()["groups"]] == [
        "business",
        "family",
        "friends",
    ]


def test_delete_response_returns_the_new_authoritative_default_and_groups(
    signed_in_client, monkeypatch
):
    class DefaultChangingService(StubContactGroupService):
        def __init__(self):
            super().__init__()
            self.default_group_id = "source"

        def get_default_group_id(self, user_id):
            self.calls.append(("get_default_group_id", user_id))
            return self.default_group_id

        def delete(self, user_id, group_id, move_to_group_id):
            deletion = super().delete(user_id, group_id, move_to_group_id)
            self.default_group_id = move_to_group_id
            return deletion

    service = DefaultChangingService()
    monkeypatch.setattr(main, "get_contact_group_service", lambda: service)

    response = signed_in_client.post(
        "/api/contact-groups/delete",
        json={"group_id": "source", "move_to_group_id": "friends"},
    )

    assert response.get_json() == {
        "ok": True,
        "deletion": {
            "deleted_group_id": "source",
            "move_to_group_id": "friends",
        },
        "groups": [{"id": "friends", "name": "Friends", "sort_order": 0}],
        "default_contact_group_id": "friends",
    }


def test_contact_group_bootstrap_uses_session_user_and_locale(
    signed_in_client, monkeypatch
):
    service = StubContactGroupService()
    monkeypatch.setattr(main, "get_contact_group_service", lambda: service, raising=False)

    response = signed_in_client.post(
        "/api/contact-groups/bootstrap", json={"locale": "zh-TW"}
    )

    assert response.status_code == 200
    assert response.get_json() == {
        "ok": True,
        "groups": [{"id": "friends", "name": "Friends", "sort_order": 0}],
        "default_contact_group_id": "friends",
    }
    assert service.calls == [
        ("bootstrap", "user-a", "zh-TW"),
        ("list_groups", "user-a"),
        ("get_default_group_id", "user-a"),
    ]


def test_contact_group_bootstrap_does_not_serialize_server_timestamp(
    signed_in_client, monkeypatch
):
    class TimestampService(StubContactGroupService):
        def bootstrap(self, user_id, locale):
            self.calls.append(("bootstrap", user_id, locale))
            return [{"id": "new", "created_at": main.firestore.SERVER_TIMESTAMP}]

        def list_groups(self, user_id):
            self.calls.append(("list_groups", user_id))
            return [{"id": "new", "created_at": "2026-07-15T10:00:00Z"}]

    service = TimestampService()
    monkeypatch.setattr(main, "get_contact_group_service", lambda: service)

    response = signed_in_client.post(
        "/api/contact-groups/bootstrap", json={"locale": "en-US"}
    )

    assert response.status_code == 200
    assert response.get_json() == {
        "ok": True,
        "groups": [{"id": "new", "created_at": "2026-07-15T10:00:00Z"}],
        "default_contact_group_id": "friends",
    }
    assert service.calls == [
        ("bootstrap", "user-a", "en-US"),
        ("list_groups", "user-a"),
        ("get_default_group_id", "user-a"),
    ]


def test_contact_group_service_uses_firestore_client_and_timestamp(monkeypatch):
    firestore = object()
    monkeypatch.setattr(main, "get_firestore_client", lambda: firestore)
    monkeypatch.setattr(main.firestore, "SERVER_TIMESTAMP", "SERVER_TIME")

    service = main.get_contact_group_service()

    assert service.client is firestore
    assert service.server_timestamp == "SERVER_TIME"


@pytest.mark.parametrize(
    "path",
    [
        "/api/contact-groups/bootstrap",
        "/api/contact-groups/list",
        "/api/contact-groups/create",
        "/api/contact-groups/update",
        "/api/contact-groups/reorder",
        "/api/contact-groups/assign",
        "/api/contact-groups/delete",
    ],
)
def test_all_contact_group_routes_require_authentication(client, path):
    response = client.post(path, json={})

    assert response.status_code == 401
    assert response.get_json() == {"ok": False, "error": "unauthorized"}


@pytest.mark.parametrize(
    ("path", "payload", "expected_json", "expected_calls"),
    [
        (
            "/api/contact-groups/list",
            {},
            {
                "ok": True,
                "groups": [{"id": "friends", "name": "Friends", "sort_order": 0}],
                "default_contact_group_id": "friends",
            },
            [("list_groups", "user-a"), ("get_default_group_id", "user-a")],
        ),
        (
            "/api/contact-groups/create",
            {"name": "Work"},
            {
                "ok": True,
                "groups": [{"id": "friends", "name": "Friends", "sort_order": 0}],
                "default_contact_group_id": "friends",
            },
            [("create", "user-a", "Work"), ("list_groups", "user-a"), ("get_default_group_id", "user-a")],
        ),
        (
            "/api/contact-groups/update",
            {"group_id": "work", "name": "Business"},
            {
                "ok": True,
                "groups": [{"id": "friends", "name": "Friends", "sort_order": 0}],
                "default_contact_group_id": "friends",
            },
            [
                ("rename", "user-a", "work", "Business"),
                ("list_groups", "user-a"),
                ("get_default_group_id", "user-a"),
            ],
        ),
        (
            "/api/contact-groups/reorder",
            {"ordered_group_ids": ["friends", "work"]},
            {"ok": True, "groups": [{"id": "friends"}, {"id": "work"}], "default_contact_group_id": "friends"},
            [("reorder", "user-a", ["friends", "work"]), ("get_default_group_id", "user-a")],
        ),
        (
            "/api/contact-groups/assign",
            {"contact_id": "user-b", "group_id": "friends"},
            {
                "ok": True,
                "assignment": {"contact_id": "user-b", "group_id": "friends"},
                "default_contact_group_id": "friends",
            },
            [("assign", "user-a", "user-b", "friends"), ("get_default_group_id", "user-a")],
        ),
        (
            "/api/contact-groups/delete",
            {"group_id": "work", "move_to_group_id": "friends"},
            {
                "ok": True,
                "deletion": {
                    "deleted_group_id": "work",
                    "move_to_group_id": "friends",
                },
                "groups": [{"id": "friends", "name": "Friends", "sort_order": 0}],
                "default_contact_group_id": "friends",
            },
            [("delete", "user-a", "work", "friends"), ("list_groups", "user-a"), ("get_default_group_id", "user-a")],
        ),
    ],
)
def test_contact_group_routes_dispatch_to_service(
    signed_in_client,
    monkeypatch,
    path,
    payload,
    expected_json,
    expected_calls,
):
    service = StubContactGroupService()
    monkeypatch.setattr(main, "get_contact_group_service", lambda: service)

    response = signed_in_client.post(path, json=payload)

    assert response.status_code == 200
    assert response.get_json() == expected_json
    assert service.calls == expected_calls


def test_contact_group_error_uses_domain_status(signed_in_client, monkeypatch):
    class FailingService(StubContactGroupService):
        def create(self, user_id, name):
            raise ContactGroupError("duplicate name", status_code=409)

    monkeypatch.setattr(main, "get_contact_group_service", FailingService)

    response = signed_in_client.post(
        "/api/contact-groups/create", json={"name": "Friends"}
    )

    assert response.status_code == 409
    assert response.get_json() == {"ok": False, "error": "duplicate name"}


def test_unexpected_contact_group_error_remains_server_error(
    app, signed_in_client, monkeypatch
):
    class BrokenService(StubContactGroupService):
        def list_groups(self, user_id):
            raise RuntimeError("database unavailable")

    app.config["PROPAGATE_EXCEPTIONS"] = False
    monkeypatch.setattr(main, "get_contact_group_service", BrokenService)

    response = signed_in_client.post("/api/contact-groups/list", json={})

    assert response.status_code == 500


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        ("/api/contact-groups/list", []),
        ("/api/contact-groups/bootstrap", {"locale": 7}),
        ("/api/contact-groups/create", {}),
        ("/api/contact-groups/create", {"name": 7}),
        (
            "/api/contact-groups/assign",
            {"contact_id": "user-b", "group_id": 7},
        ),
        (
            "/api/contact-groups/reorder",
            {"ordered_group_ids": ["friends", 7]},
        ),
        (
            "/api/contact-groups/delete",
            {"group_id": "work"},
        ),
    ],
)
def test_contact_group_routes_reject_malformed_inputs_before_dispatch(
    signed_in_client, monkeypatch, path, payload
):
    service = StubContactGroupService()
    monkeypatch.setattr(main, "get_contact_group_service", lambda: service)

    response = signed_in_client.post(path, json=payload)

    assert response.status_code == 400
    assert response.get_json()["ok"] is False
    assert response.get_json()["error"]
    assert service.calls == []


def test_contact_group_routes_require_a_json_object_body(
    signed_in_client, monkeypatch
):
    service = StubContactGroupService()
    monkeypatch.setattr(main, "get_contact_group_service", lambda: service)

    response = signed_in_client.post("/api/contact-groups/list")

    assert response.status_code == 400
    assert response.get_json() == {
        "ok": False,
        "error": "JSON object body is required",
    }
    assert service.calls == []


def test_upsert_chat_meta_preserves_existing_group_assignment(monkeypatch):
    firestore = FakeFirestoreClient()
    firestore.seed(
        "users/user-a/chat_meta/user-b",
        group_id="family",
        last_message_preview="old",
    )
    monkeypatch.setattr(main, "get_firestore_client", lambda: firestore)
    monkeypatch.setattr(main.firestore, "SERVER_TIMESTAMP", "SERVER_TIME")

    main.upsert_chat_meta("user-a", "user-b", preview_text="new")

    assert firestore.read("users/user-a/chat_meta/user-b")["group_id"] == "family"


def test_upsert_chat_meta_can_skip_last_message_fields(monkeypatch):
    firestore = FakeFirestoreClient()
    firestore.seed(
        "users/user-a/chat_meta/user-b",
        group_id="family",
        last_message_at="OLD_TIME",
        last_message_preview="old preview",
        unread_count=3,
    )
    monkeypatch.setattr(main, "get_firestore_client", lambda: firestore)
    monkeypatch.setattr(main.firestore, "SERVER_TIMESTAMP", "SERVER_TIME")

    main.upsert_chat_meta(
        "user-a",
        "user-b",
        force_unread_zero=True,
        touch_last_message=False,
    )

    metadata = firestore.read("users/user-a/chat_meta/user-b")
    assert metadata["last_message_at"] == "OLD_TIME"
    assert metadata["last_message_preview"] == "old preview"
    assert metadata["group_id"] == "family"
    assert metadata["unread_count"] == 0
    assert metadata["last_read_at"] == "SERVER_TIME"


def test_mark_read_does_not_touch_last_message_timestamp(
    signed_in_client, monkeypatch
):
    calls = []

    def fake_upsert(user_id, contact_id, **kwargs):
        calls.append((user_id, contact_id, kwargs))

    monkeypatch.setattr(main, "upsert_chat_meta", fake_upsert)
    monkeypatch.setattr(
        main,
        "get_firestore_client",
        lambda: (_ for _ in ()).throw(AssertionError("direct metadata write")),
    )

    response = signed_in_client.post(
        "/api/chat/mark-read", json={"contact_id": "user-b"}
    )

    assert response.status_code == 200
    assert calls == [
        (
            "user-a",
            "user-b",
            {"force_unread_zero": True, "touch_last_message": False},
        )
    ]


class InterleavingTransaction(FakeTransaction):
    def _commit(self):
        self._require_active()
        if self.client.interleave_assignment:
            self.client.interleave_assignment = False
            self.client.seed(
                "users/user-a/chat_meta/user-b", group_id="explicit-group"
            )
            self._rollback()
            raise FakeTransactionConflict(
                "transaction conflicted with explicit assignment"
            )
        super()._commit()


class InterleavingFirestoreClient(FakeFirestoreClient):
    def __init__(self):
        super().__init__()
        self.interleave_assignment = True

    def transaction(self):
        self.transaction_attempts += 1
        return InterleavingTransaction(self)


class TrackingFirestoreClient(FakeFirestoreClient):
    def transaction(self):
        transaction = super().transaction()
        self.last_transaction = transaction
        return transaction


def test_default_group_helper_requires_transactional_wrapper(monkeypatch):
    firestore = TrackingFirestoreClient()
    firestore.seed("users/user-a", default_contact_group_id="others")
    firestore.seed("users/user-a/contact_groups/others", name="Others")
    transaction = firestore.transaction()
    meta_ref = (
        firestore.collection("users")
        .document("user-a")
        .collection("chat_meta")
        .document("user-b")
    )

    with pytest.raises(RuntimeError, match="Transaction not in progress"):
        transaction.get(meta_ref)

    monkeypatch.setattr(main.firestore, "SERVER_TIMESTAMP", "SERVER_TIME")
    metadata = main.ensure_default_chat_group(
        firestore,
        "user-a",
        "user-b",
        "stale-default",
        metadata={},
    )

    assert metadata["group_id"] == "others"
    assert firestore.transaction_begin_attempts == 1
    assert firestore.last_transaction is not transaction
    assert firestore.last_transaction.active is False


def test_default_group_transaction_retries_and_explicit_assignment_wins(monkeypatch):
    firestore = InterleavingFirestoreClient()
    firestore.seed("users/user-a", default_contact_group_id="others")
    firestore.seed("users/user-a/contact_groups/others", name="Others")
    monkeypatch.setattr(main.firestore, "SERVER_TIMESTAMP", "SERVER_TIME")

    metadata = main.ensure_default_chat_group(
        firestore,
        "user-a",
        "user-b",
        "stale-default",
        metadata={},
    )

    assert metadata["group_id"] == "explicit-group"
    assert firestore.read("users/user-a/chat_meta/user-b")["group_id"] == "explicit-group"
    assert firestore.transaction_attempts == 1
    assert firestore.transaction_begin_attempts == 2


def test_default_group_transaction_redirects_deleting_default(monkeypatch):
    firestore = FakeFirestoreClient()
    firestore.seed("users/user-a", default_contact_group_id="source")
    firestore.seed(
        "users/user-a/contact_groups/source",
        name="Source",
        deletion_state="deleting",
        move_to_group_id="destination",
    )
    firestore.seed(
        "users/user-a/contact_groups/destination",
        name="Destination",
    )
    monkeypatch.setattr(main.firestore, "SERVER_TIMESTAMP", "SERVER_TIME")

    metadata = main.ensure_default_chat_group(
        firestore,
        "user-a",
        "user-b",
        "stale-default",
        metadata={},
    )

    assert metadata["group_id"] == "destination"
    assert firestore.read("users/user-a/chat_meta/user-b")["group_id"] == "destination"


def test_friend_list_bootstraps_and_returns_authoritative_metadata(
    signed_in_client, monkeypatch
):
    firestore = FakeFirestoreClient()
    firestore.seed(
        "users/user-a",
        email="a@example.com",
        default_contact_group_id="others",
    )
    firestore.seed("users/user-a/contact_groups/others", name="Others")
    firestore.seed(
        "users/user-a/chat_meta/user-b",
        last_message_at="2026-07-15T10:00:00Z",
        last_message_preview="hello b",
        unread_count=2,
    )
    firestore.seed(
        "users/user-a/chat_meta/user-c",
        group_id="family",
        last_message_at="2026-07-14T09:00:00Z",
        last_message_preview="hello c",
        unread_count=1,
    )
    firestore.seed(
        "friendships/user-a_user-b",
        pair_key="user-a_user-b",
        user_a_id="user-a",
        user_b_id="user-b",
        user_b_display_name="Bee",
        alias_for_a="B",
        status="accepted",
    )
    firestore.seed(
        "friendships/user-a_user-c",
        pair_key="user-a_user-c",
        user_a_id="user-a",
        user_b_id="user-c",
        user_b_display_name="Sea",
        alias_for_a="C",
        status="accepted",
    )

    class BootstrapService:
        def __init__(self):
            self.calls = []

        def bootstrap(self, user_id, locale):
            self.calls.append((user_id, locale))
            return []

    service = BootstrapService()
    monkeypatch.setattr(main, "get_firestore_client", lambda: firestore)
    monkeypatch.setattr(main, "get_contact_group_service", lambda: service)

    response = signed_in_client.post(
        "/api/friends/list", json={"locale": "zh-TW"}
    )

    assert response.status_code == 200
    assert service.calls == [("user-a", "zh-TW")]
    friends = {friend["id"]: friend for friend in response.get_json()["friends"]}
    assert {
        key: friends["user-b"][key]
        for key in (
            "group_id",
            "last_message_at",
            "last_message_preview",
            "unread_count",
        )
    } == {
        "group_id": "others",
        "last_message_at": "2026-07-15T10:00:00Z",
        "last_message_preview": "hello b",
        "unread_count": 2,
    }
    assert friends["user-c"]["group_id"] == "family"
    assert firestore.read("users/user-a/chat_meta/user-b")["group_id"] == "others"
    assert firestore.read("users/user-a/chat_meta/user-c")["group_id"] == "family"


def test_add_friend_applies_requesters_default_group_when_metadata_is_unassigned(
    signed_in_client, monkeypatch
):
    firestore = FakeFirestoreClient()
    firestore.seed(
        "users/user-a",
        email="a@example.com",
        display_name="A",
        default_contact_group_id="others",
    )
    firestore.seed("users/user-a/contact_groups/others", name="Others")
    firestore.seed(
        "users/user-b", email="b@example.com", display_name="B"
    )
    monkeypatch.setattr(main, "get_firestore_client", lambda: firestore)
    monkeypatch.setattr(main.firestore, "SERVER_TIMESTAMP", "SERVER_TIME")
    monkeypatch.setattr(
        main,
        "_validate_friend_payload",
        lambda body: (
            {
                "ok": True,
                "requester_user_id": "user-a",
                "friend": {
                    "id": "user-b",
                    "email": "b@example.com",
                    "display_name": "B",
                    "avatar_url": "",
                },
            },
            200,
        ),
    )

    response = signed_in_client.post(
        "/api/friend/add", json={"friend_alias": "Bee"}
    )

    assert response.status_code == 200
    assert {
        key: response.get_json()["friend"][key]
        for key in (
            "group_id",
            "last_message_at",
            "last_message_preview",
            "unread_count",
        )
    } == {
        "group_id": "others",
        "last_message_at": None,
        "last_message_preview": "",
        "unread_count": 0,
    }
    assert firestore.read("users/user-a/chat_meta/user-b")["group_id"] == "others"


def test_delete_friend_requires_authentication(client):
    response = client.post("/api/friend/delete", json={"friend_user_id": "user-b"})

    assert response.status_code == 401
    assert response.get_json() == {"ok": False, "error": "unauthorized"}


def test_delete_friend_rejects_invalid_or_unrelated_contact(signed_in_client, monkeypatch):
    firestore = FakeFirestoreClient()
    firestore.seed(
        "friendships/user-a_user-b",
        user_a_id="somebody-else",
        user_b_id="user-b",
        status="accepted",
    )
    monkeypatch.setattr(main, "get_firestore_client", lambda: firestore)

    missing = signed_in_client.post("/api/friend/delete", json={})
    self_delete = signed_in_client.post("/api/friend/delete", json={"friend_user_id": "user-a"})
    unrelated = signed_in_client.post("/api/friend/delete", json={"friend_user_id": "user-b"})

    assert missing.status_code == 400
    assert self_delete.status_code == 400
    assert unrelated.status_code == 404
    assert firestore.read("friendships/user-a_user-b") is not None


def test_delete_friend_rejects_malformed_swapped_members_at_the_canonical_key(
    signed_in_client, monkeypatch
):
    firestore = FakeFirestoreClient()
    firestore.seed(
        "friendships/user-a_user-b",
        user_a_id="user-b",
        user_b_id="user-a",
        status="accepted",
    )
    monkeypatch.setattr(main, "get_firestore_client", lambda: firestore)

    response = signed_in_client.post(
        "/api/friend/delete", json={"friend_user_id": "user-b"}
    )

    assert response.status_code == 404
    assert response.get_json() == {"ok": False, "error": "friendship not found"}
    assert firestore.read("friendships/user-a_user-b") is not None


def test_delete_friend_atomically_removes_friendship_and_both_metadata_docs(signed_in_client, monkeypatch):
    firestore = FakeFirestoreClient()
    firestore.seed(
        "friendships/user-a_user-b",
        pair_key="user-a_user-b",
        user_a_id="user-a",
        user_b_id="user-b",
        status="accepted",
    )
    firestore.seed("users/user-a/chat_meta/user-b", group_id="friends")
    firestore.seed("users/user-b/chat_meta/user-a", group_id="friends")
    monkeypatch.setattr(main, "get_firestore_client", lambda: firestore)

    response = signed_in_client.post("/api/friend/delete", json={"friend_user_id": "user-b"})

    assert response.status_code == 200
    assert response.get_json() == {
        "ok": True,
        "friend_user_id": "user-b",
        "pair_key": "user-a_user-b",
        "already_deleted": False,
    }
    assert firestore.read("friendships/user-a_user-b") is None
    assert firestore.read("users/user-a/chat_meta/user-b") is None
    assert firestore.read("users/user-b/chat_meta/user-a") is None


def test_delete_friend_is_idempotent_when_the_canonical_friendship_is_already_missing(
    signed_in_client, monkeypatch
):
    firestore = FakeFirestoreClient()
    monkeypatch.setattr(main, "get_firestore_client", lambda: firestore)

    first = signed_in_client.post(
        "/api/friend/delete", json={"friend_user_id": "user-b"}
    )
    second = signed_in_client.post(
        "/api/friend/delete", json={"friend_user_id": "user-b"}
    )

    assert first.status_code == 200
    assert first.get_json() == {
        "ok": True,
        "friend_user_id": "user-b",
        "pair_key": "user-a_user-b",
        "already_deleted": True,
    }
    assert second.get_json() == first.get_json()


def test_delete_friend_repeated_after_confirmed_delete_reports_already_deleted(
    signed_in_client, monkeypatch
):
    firestore = FakeFirestoreClient()
    firestore.seed(
        "friendships/user-a_user-b",
        user_a_id="user-a",
        user_b_id="user-b",
        status="accepted",
    )
    monkeypatch.setattr(main, "get_firestore_client", lambda: firestore)

    deleted = signed_in_client.post(
        "/api/friend/delete", json={"friend_user_id": "user-b"}
    )
    retried = signed_in_client.post(
        "/api/friend/delete", json={"friend_user_id": "user-b"}
    )

    assert deleted.status_code == 200
    assert deleted.get_json()["already_deleted"] is False
    assert retried.status_code == 200
    assert retried.get_json()["already_deleted"] is True


def test_post_delete_text_delivery_is_rejected_without_writes_or_publish(
    signed_in_client, monkeypatch
):
    firestore = FakeFirestoreClient()
    firestore.seed("users/user-a", display_name="Alice")
    firestore.seed("users/user-b", display_name="Bob")
    firestore.seed(
        "friendships/user-a_user-b",
        user_a_id="user-a",
        user_b_id="user-b",
        status="accepted",
    )
    monkeypatch.setattr(main, "get_firestore_client", lambda: firestore)
    published = []
    monkeypatch.setattr(
        main,
        "publish_user_channel_message",
        lambda *args: published.append(args),
    )

    assert signed_in_client.post(
        "/api/friend/delete", json={"friend_user_id": "user-b"}
    ).status_code == 200
    response = signed_in_client.post(
        "/api/messages/send",
        json={"recipient_user_id": "user-b", "text": "should not deliver"},
    )

    assert response.status_code == 403
    assert response.get_json() == {"ok": False, "error": "accepted friendship required"}
    assert published == []
    assert not any("messages" in path for path in firestore.data)
    assert firestore.read("users/user-a/chat_meta/user-b") is None
    assert firestore.read("users/user-b/chat_meta/user-a") is None


def test_post_delete_voice_delivery_is_rejected_before_provider_or_upload(
    signed_in_client, monkeypatch
):
    firestore = FakeFirestoreClient()
    firestore.seed("users/user-a", display_name="Alice")
    firestore.seed("users/user-b", display_name="Bob")
    monkeypatch.setattr(main, "get_firestore_client", lambda: firestore)
    provider_calls = []
    uploads = []
    published = []
    monkeypatch.setattr(
        main,
        "transcribe_audio_bytes",
        lambda *args: provider_calls.append(args) or "voice text",
    )
    monkeypatch.setattr(
        main,
        "upload_audio_to_vercel_blob",
        lambda *args: uploads.append(args) or "https://blob/voice.webm",
    )
    monkeypatch.setattr(
        main,
        "publish_user_channel_message",
        lambda *args: published.append(args),
    )

    response = signed_in_client.post(
        "/api/messages/send-voice",
        json={
            "recipient_user_id": "user-b",
            "audio_base64": base64.b64encode(b"voice").decode("ascii"),
            "mime_type": "audio/webm",
            "duration_seconds": 1,
        },
    )

    assert response.status_code == 403
    assert response.get_json() == {"ok": False, "error": "accepted friendship required"}
    assert provider_calls == []
    assert uploads == []
    assert published == []
    assert not any("messages" in path for path in firestore.data)


class DeleteWinsTransaction(FakeTransaction):
    def _commit(self):
        if self.client.delete_before_next_transaction_commit:
            self.client.delete_before_next_transaction_commit = False
            self.client.data.pop(("friendships", "user-a_user-b"), None)
            self._rollback()
            raise FakeTransactionConflict("friend deletion committed first")
        return super()._commit()


class DeleteWinsFirestore(FakeFirestoreClient):
    def __init__(self):
        super().__init__()
        self.delete_before_next_transaction_commit = True

    def transaction(self):
        self.transaction_attempts += 1
        return DeleteWinsTransaction(self)


def test_concurrent_delete_winning_transaction_prevents_text_delivery_and_publish(
    signed_in_client, monkeypatch
):
    firestore = DeleteWinsFirestore()
    firestore.seed("users/user-a", display_name="Alice")
    firestore.seed("users/user-b", display_name="Bob")
    firestore.seed(
        "friendships/user-a_user-b",
        user_a_id="user-a",
        user_b_id="user-b",
        status="accepted",
    )
    monkeypatch.setattr(main, "get_firestore_client", lambda: firestore)
    published = []
    monkeypatch.setattr(
        main,
        "publish_user_channel_message",
        lambda *args: published.append(args),
    )

    response = signed_in_client.post(
        "/api/messages/send",
        json={"recipient_user_id": "user-b", "text": "racing message"},
    )

    assert response.status_code == 403
    assert published == []
    assert not any("messages" in path for path in firestore.data)
    assert firestore.transaction_begin_attempts == 2


def test_concurrent_delete_winning_voice_persistence_prevents_delivery_and_publish(
    signed_in_client, monkeypatch
):
    firestore = DeleteWinsFirestore()
    firestore.seed("users/user-a", display_name="Alice")
    firestore.seed("users/user-b", display_name="Bob")
    firestore.seed(
        "friendships/user-a_user-b",
        user_a_id="user-a",
        user_b_id="user-b",
        status="accepted",
    )
    monkeypatch.setattr(main, "get_firestore_client", lambda: firestore)
    provider_calls = []
    uploads = []
    published = []
    monkeypatch.setattr(
        main,
        "transcribe_audio_bytes",
        lambda *args: provider_calls.append(args) or "racing voice",
    )
    monkeypatch.setattr(
        main,
        "upload_audio_to_vercel_blob",
        lambda *args: uploads.append(args) or "https://blob/voice.webm",
    )
    monkeypatch.setattr(
        main,
        "publish_user_channel_message",
        lambda *args: published.append(args),
    )

    response = signed_in_client.post(
        "/api/messages/send-voice",
        json={
            "recipient_user_id": "user-b",
            "audio_base64": base64.b64encode(b"voice").decode("ascii"),
            "mime_type": "audio/webm",
            "duration_seconds": 1,
        },
    )

    assert response.status_code == 403
    assert provider_calls
    assert uploads
    assert published == []
    assert not any("messages" in path for path in firestore.data)
    assert firestore.transaction_begin_attempts == 2


def _delete_friendship_after_persistence(firestore, persist):
    def wrapped(*args, **kwargs):
        persist(*args, **kwargs)
        firestore.data.pop(("friendships", "user-a_user-b"), None)
        firestore.data.pop(("users", "user-a", "chat_meta", "user-b"), None)
        firestore.data.pop(("users", "user-b", "chat_meta", "user-a"), None)

    return wrapped


def test_delete_after_text_persistence_before_publish_revokes_delivery(
    signed_in_client, monkeypatch
):
    firestore = FakeFirestoreClient()
    firestore.seed("users/user-a", display_name="Alice")
    firestore.seed("users/user-b", display_name="Bob")
    firestore.seed(
        "friendships/user-a_user-b",
        user_a_id="user-a",
        user_b_id="user-b",
        status="accepted",
    )
    monkeypatch.setattr(main, "get_firestore_client", lambda: firestore)
    monkeypatch.setattr(
        main,
        "persist_friend_delivery",
        _delete_friendship_after_persistence(
            firestore, main.persist_friend_delivery
        ),
    )
    published = []
    monkeypatch.setattr(
        main,
        "publish_user_channel_message",
        lambda *args: published.append(args),
    )

    response = signed_in_client.post(
        "/api/messages/send",
        json={"recipient_user_id": "user-b", "text": "too late"},
    )

    assert response.status_code == 403
    assert published == []
    assert not any("messages" in path for path in firestore.data)


def test_text_delivery_succeeds_after_durable_write_when_realtime_publish_fails(
    signed_in_client, monkeypatch
):
    firestore = FakeFirestoreClient()
    firestore.seed("users/user-a", display_name="Alice")
    firestore.seed("users/user-b", display_name="Bob")
    firestore.seed(
        "friendships/user-a_user-b",
        user_a_id="user-a",
        user_b_id="user-b",
        status="accepted",
    )
    monkeypatch.setattr(main, "get_firestore_client", lambda: firestore)

    private_provider_detail = "ably-secret-never-log"

    def fail_publish(*_args):
        raise RuntimeError(private_provider_detail)

    logged = []
    monkeypatch.setattr(main, "publish_user_channel_message", fail_publish)
    monkeypatch.setattr(
        main,
        "log_tool_error",
        lambda *args, **kwargs: logged.append((args, kwargs)),
    )

    response = signed_in_client.post(
        "/api/messages/send",
        json={"recipient_user_id": "user-b", "text": "durable hello"},
    )

    body = response.get_json()
    assert response.status_code == 200
    assert body["ok"] is True
    assert body["realtime_delivered"] is False
    message_id = body["message"]["message_id"]
    assert firestore.read(
        f"users/user-a/chats/user-b/messages/{message_id}"
    )["text"] == "durable hello"
    assert firestore.read(
        f"users/user-b/chats/user-a/messages/{message_id}"
    )["text"] == "durable hello"
    assert (
        firestore.read("users/user-b/chat_meta/user-a")["unread_count"].value
        == 1
    )
    assert logged[0][0][:5] == (
        "user-a",
        "user-b",
        "ably_publish",
        "send_message",
        "RuntimeError",
    )
    assert private_provider_detail not in repr(logged)


def test_voice_delivery_succeeds_after_durable_write_when_realtime_publish_fails(
    signed_in_client, monkeypatch
):
    firestore = FakeFirestoreClient()
    firestore.seed("users/user-a", display_name="Alice")
    firestore.seed("users/user-b", display_name="Bob")
    firestore.seed(
        "friendships/user-a_user-b",
        user_a_id="user-a",
        user_b_id="user-b",
        status="accepted",
    )
    monkeypatch.setattr(main, "get_firestore_client", lambda: firestore)
    monkeypatch.setattr(main, "transcribe_audio_bytes", lambda *_args: "durable voice")
    monkeypatch.setattr(
        main,
        "upload_audio_to_vercel_blob",
        lambda *_args: "https://blob/voice.webm",
    )

    private_provider_detail = "ably-secret-never-log"

    def fail_publish(*_args):
        raise RuntimeError(private_provider_detail)

    logged = []
    deleted_blobs = []
    monkeypatch.setattr(main, "publish_user_channel_message", fail_publish)
    monkeypatch.setattr(main, "delete_vercel_blob", deleted_blobs.append)
    monkeypatch.setattr(
        main,
        "log_tool_error",
        lambda *args, **kwargs: logged.append((args, kwargs)),
    )

    response = signed_in_client.post(
        "/api/messages/send-voice",
        json={
            "recipient_user_id": "user-b",
            "audio_base64": base64.b64encode(b"voice").decode("ascii"),
            "mime_type": "audio/webm",
            "duration_seconds": 1.5,
        },
    )

    body = response.get_json()
    assert response.status_code == 200
    assert body["ok"] is True
    assert body["realtime_delivered"] is False
    message_id = body["message"]["message_id"]
    sender_message = firestore.read(
        f"users/user-a/chats/user-b/messages/{message_id}"
    )
    recipient_message = firestore.read(
        f"users/user-b/chats/user-a/messages/{message_id}"
    )
    assert sender_message["audio_url"] == "https://blob/voice.webm"
    assert recipient_message["transcript_text"] == "durable voice"
    assert (
        firestore.read("users/user-b/chat_meta/user-a")["unread_count"].value
        == 1
    )
    assert deleted_blobs == []
    assert logged[0][0][:5] == (
        "user-a",
        "user-b",
        "ably_publish",
        "send_voice_message",
        "RuntimeError",
    )
    assert private_provider_detail not in repr(logged)


@pytest.mark.parametrize("kind", ["text", "voice"])
def test_direct_delivery_replays_same_request_without_duplicate_or_unread_increment(
    signed_in_client, monkeypatch, kind
):
    firestore = FakeFirestoreClient()
    firestore.seed("users/user-a", display_name="Alice")
    firestore.seed("users/user-b", display_name="Bob")
    firestore.seed("friendships/user-a_user-b", user_a_id="user-a", user_b_id="user-b", status="accepted")
    monkeypatch.setattr(main, "get_firestore_client", lambda: firestore)
    provider_calls = []
    uploads = []
    monkeypatch.setattr(main, "transcribe_audio_bytes", lambda *_args: provider_calls.append(True) or "voice replay")
    monkeypatch.setattr(main, "upload_audio_to_vercel_blob", lambda *_args: uploads.append(True) or "https://blob/voice.webm")
    attempts = []
    monkeypatch.setattr(main, "publish_user_channel_message", lambda uid, payload: attempts.append((uid, payload)))
    request_id = f"stable-{kind}-1"
    if kind == "text":
        path = "/api/messages/send"
        body = {"recipient_user_id": "user-b", "text": "once", "request_id": request_id}
    else:
        path = "/api/messages/send-voice"
        body = {"recipient_user_id": "user-b", "audio_base64": base64.b64encode(b"voice").decode("ascii"), "mime_type": "audio/webm", "request_id": request_id}

    first = signed_in_client.post(path, json=body)
    second = signed_in_client.post(path, json=body)

    assert first.status_code == second.status_code == 200
    assert first.get_json() == second.get_json()
    message_id = first.get_json()["message"]["message_id"]
    assert message_id == main.deterministic_message_id("user-a", f"direct_{kind}", "user-b", request_id, "outbound")
    assert len([path for path in firestore.data if path[-2:] == ("messages", message_id)]) == 2
    assert firestore.read("users/user-b/chat_meta/user-a")["unread_count"].value == 1
    assert len(attempts) == 1
    if kind == "voice":
        assert len(provider_calls) == len(uploads) == 1


@pytest.mark.parametrize("kind", ["text", "voice"])
def test_concurrent_direct_replay_after_commit_does_not_duplicate_durable_state(
    signed_in_client, monkeypatch, kind
):
    firestore = FakeFirestoreClient()
    firestore.seed("users/user-a", display_name="Alice")
    firestore.seed("users/user-b", display_name="Bob")
    firestore.seed("friendships/user-a_user-b", user_a_id="user-a", user_b_id="user-b", status="accepted")
    monkeypatch.setattr(main, "get_firestore_client", lambda: firestore)
    monkeypatch.setattr(main, "transcribe_audio_bytes", lambda *_args: "voice concurrent")
    monkeypatch.setattr(main, "upload_audio_to_vercel_blob", lambda *_args: "https://blob/voice.webm")
    request_id = f"concurrent-{kind}-1"
    path = "/api/messages/send" if kind == "text" else "/api/messages/send-voice"
    body = {"recipient_user_id": "user-b", "request_id": request_id, **({"text": "once"} if kind == "text" else {"audio_base64": "YQ==", "mime_type": "audio/webm"})}
    nested = []

    def publish(_uid, _payload):
        if not nested:
            nested.append(signed_in_client.post(path, json=body))

    monkeypatch.setattr(main, "publish_user_channel_message", publish)
    outer = signed_in_client.post(path, json=body)
    assert outer.status_code == nested[0].status_code == 200
    assert outer.get_json()["message"]["message_id"] == nested[0].get_json()["message"]["message_id"]
    message_id = outer.get_json()["message"]["message_id"]
    assert len([key for key in firestore.data if key[-2:] == ("messages", message_id)]) == 2
    assert firestore.read("users/user-b/chat_meta/user-a")["unread_count"].value == 1


def test_unpublished_text_replay_does_not_publish_after_friendship_revoked(
    signed_in_client, monkeypatch
):
    firestore = FakeFirestoreClient()
    firestore.seed("users/user-a", display_name="Alice")
    firestore.seed("users/user-b", display_name="Bob")
    request_id = "revoked-replay-1"
    payload = {"message_id": "message-1", "sender_user_id": "user-a", "recipient_user_id": "user-b", "text": "stored"}
    payload_hash = main.delivery_payload_hash("user-b", {"text": "stored", "image_url": "", "music_url": ""})
    receipt_id = main.hashlib.sha256(f"direct_text:{request_id}".encode()).hexdigest()
    firestore.seed(f"users/user-a/delivery_receipts/{receipt_id}", state="completed", payload_hash=payload_hash, published=False, ably_payload=payload, response={"ok": True, "message": payload})
    monkeypatch.setattr(main, "get_firestore_client", lambda: firestore)
    published = []
    monkeypatch.setattr(main, "publish_user_channel_message", lambda *args: published.append(args))
    response = signed_in_client.post("/api/messages/send", json={"recipient_user_id": "user-b", "text": "stored", "request_id": request_id})
    assert response.status_code == 200
    assert response.get_json()["realtime_delivered"] is False
    assert published == []


@pytest.mark.parametrize("publish_succeeds", [True, False])
def test_unpublished_text_replay_reports_and_records_republish_outcome(
    signed_in_client, monkeypatch, publish_succeeds
):
    firestore = FakeFirestoreClient()
    firestore.seed("users/user-a", display_name="Alice")
    firestore.seed("users/user-b", display_name="Bob")
    firestore.seed("friendships/user-a_user-b", user_a_id="user-a", user_b_id="user-b", status="accepted")
    request_id = f"republish-{publish_succeeds}"
    payload = {"message_id": "message-1", "sender_user_id": "user-a", "recipient_user_id": "user-b", "text": "stored"}
    payload_hash = main.delivery_payload_hash("user-b", {"text": "stored", "image_url": "", "music_url": ""})
    receipt_id = main.hashlib.sha256(f"direct_text:{request_id}".encode()).hexdigest()
    receipt_path = f"users/user-a/delivery_receipts/{receipt_id}"
    firestore.seed(receipt_path, state="completed", payload_hash=payload_hash, published=False, ably_payload=payload, response={"ok": True, "message": payload})
    monkeypatch.setattr(main, "get_firestore_client", lambda: firestore)
    def publish(*_args):
        if not publish_succeeds:
            raise RuntimeError("offline")
    monkeypatch.setattr(main, "publish_user_channel_message", publish)
    response = signed_in_client.post("/api/messages/send", json={"recipient_user_id": "user-b", "text": "stored", "request_id": request_id})
    assert response.status_code == 200
    assert response.get_json().get("realtime_delivered") is (None if publish_succeeds else False)
    assert firestore.read(receipt_path)["published"] is publish_succeeds


def test_idempotent_confirm_rollback_restores_own_metadata_and_preserves_newer_metadata(monkeypatch):
    firestore = FakeFirestoreClient()
    request_id = "rollback-1"
    receipt_id = main.hashlib.sha256(f"direct_text:{request_id}".encode()).hexdigest()
    firestore.seed("users/user-a/chats/user-b/messages/message-1", text="sent")
    firestore.seed("users/user-b/chats/user-a/messages/message-1", text="sent")
    firestore.seed("users/user-a/chat_meta/user-b", last_message_preview="sent", direct_delivery_guard="message-1")
    firestore.seed("users/user-b/chat_meta/user-a", last_message_preview="newer", direct_delivery_guard="newer-message", unread_count=7)
    firestore.seed(f"users/user-a/delivery_receipts/{receipt_id}", rollback_meta={"user-a:user-b": {"last_message_preview": "before"}, "user-b:user-a": {"last_message_preview": "before", "unread_count": 2}})
    monkeypatch.setattr(main, "get_firestore_client", lambda: firestore)
    assert main.confirm_friend_delivery_before_publish(firestore, "user-a", "user-b", "message-1", "direct_text", request_id) is False
    assert firestore.read("users/user-a/chat_meta/user-b") == {"last_message_preview": "before"}
    assert firestore.read("users/user-b/chat_meta/user-a")["last_message_preview"] == "newer"
    assert firestore.read(f"users/user-a/delivery_receipts/{receipt_id}") is None


def test_direct_request_id_conflict_is_409_and_legacy_request_remains_supported(signed_in_client, monkeypatch):
    firestore = FakeFirestoreClient()
    firestore.seed("users/user-a", display_name="Alice")
    firestore.seed("users/user-b", display_name="Bob")
    firestore.seed("friendships/user-a_user-b", user_a_id="user-a", user_b_id="user-b", status="accepted")
    monkeypatch.setattr(main, "get_firestore_client", lambda: firestore)
    monkeypatch.setattr(main, "publish_user_channel_message", lambda *_args: None)
    first = signed_in_client.post("/api/messages/send", json={"recipient_user_id": "user-b", "text": "one", "request_id": "same-id"})
    conflict = signed_in_client.post("/api/messages/send", json={"recipient_user_id": "user-b", "text": "different", "request_id": "same-id"})
    legacy = signed_in_client.post("/api/messages/send", json={"recipient_user_id": "user-b", "text": "legacy"})
    assert first.status_code == legacy.status_code == 200
    assert conflict.status_code == 409


def test_delete_after_voice_persistence_before_publish_revokes_delivery(
    signed_in_client, monkeypatch
):
    firestore = FakeFirestoreClient()
    firestore.seed("users/user-a", display_name="Alice")
    firestore.seed("users/user-b", display_name="Bob")
    firestore.seed(
        "friendships/user-a_user-b",
        user_a_id="user-a",
        user_b_id="user-b",
        status="accepted",
    )
    monkeypatch.setattr(main, "get_firestore_client", lambda: firestore)
    monkeypatch.setattr(
        main,
        "persist_friend_delivery",
        _delete_friendship_after_persistence(
            firestore, main.persist_friend_delivery
        ),
    )
    monkeypatch.setattr(main, "transcribe_audio_bytes", lambda *_args: "voice")
    monkeypatch.setattr(
        main,
        "upload_audio_to_vercel_blob",
        lambda *_args: "https://blob/voice.webm",
    )
    deleted_blobs = []
    monkeypatch.setattr(main, "delete_vercel_blob", deleted_blobs.append)
    published = []
    monkeypatch.setattr(
        main,
        "publish_user_channel_message",
        lambda *args: published.append(args),
    )

    response = signed_in_client.post(
        "/api/messages/send-voice",
        json={
            "recipient_user_id": "user-b",
            "audio_base64": base64.b64encode(b"voice").decode("ascii"),
            "mime_type": "audio/webm",
        },
    )

    assert response.status_code == 403
    assert published == []
    assert not any("messages" in path for path in firestore.data)
    assert deleted_blobs == ["https://blob/voice.webm"]


def test_pre_publish_rollback_preserves_metadata_from_a_newer_friendship_generation(monkeypatch):
    firestore = FakeFirestoreClient()
    firestore.seed(
        "users/user-a/chats/user-b/messages/stale-message",
        role="user",
        text="stale",
    )
    firestore.seed(
        "users/user-b/chats/user-a/messages/stale-message",
        role="peer",
        text="stale",
    )
    firestore.seed(
        "users/user-a/chat_meta/user-b",
        last_message_preview="new relationship message",
    )
    firestore.seed(
        "users/user-b/chat_meta/user-a",
        last_message_preview="new relationship message",
    )
    monkeypatch.setattr(main, "get_firestore_client", lambda: firestore)

    confirmed = main.confirm_friend_delivery_before_publish(
        firestore, "user-a", "user-b", "stale-message"
    )

    assert confirmed is False
    assert firestore.read(
        "users/user-a/chats/user-b/messages/stale-message"
    ) is None
    assert firestore.read(
        "users/user-b/chats/user-a/messages/stale-message"
    ) is None
    assert firestore.read("users/user-a/chat_meta/user-b") == {
        "last_message_preview": "new relationship message"
    }
    assert firestore.read("users/user-b/chat_meta/user-a") == {
        "last_message_preview": "new relationship message"
    }
