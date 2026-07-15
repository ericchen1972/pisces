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
