from datetime import datetime, timezone
import hashlib
from types import SimpleNamespace

import pytest

import contact_groups
from contact_groups import (
    ContactGroupError,
    ContactGroupService,
    DuplicateGroupName,
    GroupNotFound,
    LastGroupDeletion,
    normalize_group_name,
    seed_group_specs,
    sort_contact_records,
)


class FakeSnapshot:
    def __init__(self, reference, data):
        self.reference = reference
        self.id = reference.id
        self._data = None if data is None else dict(data)
        self.exists = data is not None

    def to_dict(self):
        return None if self._data is None else dict(self._data)


class FakeDocumentReference:
    def __init__(self, client, path):
        self.client = client
        self.path = path
        self.id = path[-1]

    def collection(self, name):
        return FakeCollectionReference(self.client, self.path + (name,))

    def get(self, transaction=None):
        del transaction
        return FakeSnapshot(self, self.client.data.get(self.path))

    def set(self, values, merge=False):
        self.client._set(self, values, merge=merge)

    def delete(self):
        self.client.data.pop(self.path, None)


class FakeQuery:
    def __init__(self, collection, field=None, op=None, value=None, order_field=None):
        self.collection = collection
        self.field = field
        self.op = op
        self.value = value
        self.order_field = order_field

    def stream(self):
        snapshots = list(self.collection.stream())
        if self.op is not None:
            assert self.op == "=="
            snapshots = [
                snapshot
                for snapshot in snapshots
                if snapshot.to_dict().get(self.field) == self.value
            ]
        if self.order_field == "__name__":
            snapshots.sort(key=lambda snapshot: snapshot.id)
        return snapshots


class FakeCollectionReference:
    def __init__(self, client, path):
        self.client = client
        self.path = path

    def document(self, document_id=None):
        if document_id is None:
            self.client.sequence += 1
            document_id = f"auto-{self.client.sequence:03d}"
        return FakeDocumentReference(self.client, self.path + (document_id,))

    def stream(self):
        expected_length = len(self.path) + 1
        snapshots = []
        for path, data in self.client.data.items():
            if len(path) == expected_length and path[:-1] == self.path:
                snapshots.append(FakeSnapshot(FakeDocumentReference(self.client, path), data))
        return snapshots

    def where(self, field=None, op=None, value=None, filter=None):
        if filter is not None:
            field = filter.field_path
            op = filter.op_string
            value = filter.value
        return FakeQuery(self, field, op, value)

    def order_by(self, field):
        return FakeQuery(self, order_field=field)


class FakeBatch:
    def __init__(self, client):
        self.client = client
        self.operations = []

    def set(self, reference, values, merge=False):
        self.operations.append(("set", reference, dict(values), merge))
        return self

    def delete(self, reference):
        self.operations.append(("delete", reference, None, False))
        return self

    def commit(self):
        self.client.batch_sizes.append(len(self.operations))
        if len(self.operations) > 450:
            raise RuntimeError("batch exceeds 450 writes")
        if self.client.fail_next_batch_commit:
            self.client.fail_next_batch_commit = False
            raise RuntimeError("injected batch failure")
        self.client._apply_operations(self.operations)
        self.operations.clear()


class FakeTransactionConflict(RuntimeError):
    pass


class FakeTransaction:
    def __init__(self, client):
        self.client = client
        self.operations = []
        self.active = False

    def _require_active(self):
        if not self.active:
            raise RuntimeError("Transaction not in progress")

    def _begin(self):
        self.active = True
        self.operations.clear()
        self.client.transaction_begin_attempts += 1

    def _rollback(self):
        self.operations.clear()
        self.active = False

    def _commit(self):
        self._require_active()
        if self.client.transaction_failures_remaining:
            self.client.transaction_failures_remaining -= 1
            self._rollback()
            raise FakeTransactionConflict("injected transaction conflict")
        self.client._apply_operations(self.operations)
        self.operations.clear()
        self.active = False

    def get(self, reference_or_query):
        self._require_active()
        if isinstance(reference_or_query, FakeDocumentReference):
            return iter([reference_or_query.get()])
        if isinstance(reference_or_query, FakeQuery):
            self.client.transaction_query_reads += 1
            return list(reference_or_query.stream())
        raise TypeError("transaction.get requires a document reference or query")

    def set(self, reference, values, merge=False):
        self._require_active()
        self.operations.append(("set", reference, dict(values), merge))
        return self

    def delete(self, reference):
        self._require_active()
        self.operations.append(("delete", reference, None, False))
        return self


def fake_transactional(operation):
    def wrapped(transaction, *args, **kwargs):
        for attempt in range(5):
            transaction._begin()
            try:
                result = operation(transaction, *args, **kwargs)
                transaction._commit()
                return result
            except FakeTransactionConflict:
                if attempt == 4:
                    raise
            except Exception:
                transaction._rollback()
                raise

    return wrapped


class FakeFirestoreClient:
    def __init__(self):
        self.data = {}
        self.sequence = 0
        self.batch_sizes = []
        self.transaction_attempts = 0
        self.transaction_begin_attempts = 0
        self.transaction_query_reads = 0
        self.transaction_failures_remaining = 0
        self.fail_next_batch_commit = False

    def collection(self, name):
        return FakeCollectionReference(self, (name,))

    def batch(self):
        return FakeBatch(self)

    def transaction(self):
        self.transaction_attempts += 1
        return FakeTransaction(self)

    def _set(self, reference, values, merge=False):
        current = self.data.get(reference.path, {}) if merge else {}
        self.data[reference.path] = {**current, **dict(values)}

    def _apply_operations(self, operations):
        updated = {path: dict(values) for path, values in self.data.items()}
        for operation, reference, values, merge in operations:
            if operation == "set":
                current = updated.get(reference.path, {}) if merge else {}
                updated[reference.path] = {**current, **dict(values)}
            else:
                updated.pop(reference.path, None)
        self.data = updated

    def seed(self, path, **values):
        self.data[tuple(path.split("/"))] = dict(values)

    def read(self, path):
        return self.data.get(tuple(path.split("/")))


@pytest.fixture
def firestore():
    return FakeFirestoreClient()


@pytest.fixture(autouse=True)
def firestore_transactional_wrapper(monkeypatch):
    monkeypatch.setattr(
        contact_groups,
        "firestore",
        SimpleNamespace(transactional=fake_transactional),
        raising=False,
    )


@pytest.fixture
def service(firestore):
    return ContactGroupService(firestore, server_timestamp="SERVER_TIME")


def test_normalize_group_name_nfkc_casefolds_and_collapses_spaces():
    assert normalize_group_name("  ＦＡＭＩＬＹ   Team ") == "family team"


@pytest.mark.parametrize("locale", ["ZH-TW", "zh-Hant", "zh-Hant-HK", "zh-Hant-MO"])
def test_seed_group_specs_localizes_explicit_traditional_chinese_locales(locale):
    groups = seed_group_specs(locale)

    assert [group["name"] for group in groups] == ["家人", "朋友", "商務", "路人甲"]
    assert [group["sort_order"] for group in groups] == [0, 1, 2, 3]
    assert [group["is_default"] for group in groups] == [False, False, False, True]


@pytest.mark.parametrize("locale", ["zh-HK", "zh-MO", "zh-CN", "en"])
def test_seed_group_specs_uses_english_without_explicit_traditional_script(locale):
    groups = seed_group_specs(locale)

    assert [group["name"] for group in groups] == [
        "Family",
        "Friends",
        "Business",
        "Others",
    ]


def test_sort_contact_records_orders_latest_first_then_name_and_invalid_last():
    contacts = [
        {"id": "b", "name": "Beta", "last_message_at": "not-a-date"},
        {"id": "a", "name": "Alpha", "last_message_at": "2026-01-01T00:00:00Z"},
        {
            "id": "c",
            "name": "Recent",
            "last_message_at": datetime(2026, 2, 1, tzinfo=timezone.utc),
        },
    ]

    assert [contact["id"] for contact in sort_contact_records(contacts)] == ["c", "a", "b"]


def test_sort_contact_records_ties_by_name_not_display_name():
    contacts = [
        {"id": "z", "name": "Zulu", "display_name": "Alpha"},
        {"id": "a", "name": "alpha", "display_name": "Zulu"},
    ]

    assert [contact["id"] for contact in sort_contact_records(contacts)] == ["a", "z"]


def test_bootstrap_creates_localized_groups_and_marks_only_returned_default(service, firestore):
    rows = service.bootstrap("user-a", "zh-Hant-TW")

    assert [row["name"] for row in rows] == ["家人", "朋友", "商務", "路人甲"]
    assert rows[-1]["is_default"] is True
    assert firestore.read("users/user-a")["default_contact_group_id"] == rows[-1]["id"]
    assert firestore.read("users/user-a")["contact_groups_initialized"] is True
    assert all("is_default" not in firestore.read(f"users/user-a/contact_groups/{row['id']}") for row in rows)
    reservations = [path for path in firestore.data if path[:3] == ("users", "user-a", "contact_group_name_reservations")]
    assert len(reservations) == 4


def test_create_retries_atomically_and_initializes_first_default(service, firestore):
    firestore.transaction_failures_remaining = 1

    row = service.create("user-a", "Family")

    assert firestore.transaction_attempts == 1
    assert firestore.transaction_begin_attempts == 2
    assert firestore.read("users/user-a")["default_contact_group_id"] == row["id"]
    assert len(service.list_groups("user-a")) == 1
    reservations = [path for path in firestore.data if path[:3] == ("users", "user-a", "contact_group_name_reservations")]
    assert len(reservations) == 1


def test_fresh_transaction_rejects_reads_until_transactional_wrapper_activates(
    service, firestore
):
    transaction = firestore.transaction()
    reference = firestore.collection("users").document("user-a")

    with pytest.raises(RuntimeError, match="Transaction not in progress"):
        transaction.get(reference)

    row = service.create("user-a", "Family")
    assert row["id"]


def test_create_replaces_stale_default_when_no_groups_exist(service, firestore):
    firestore.seed("users/user-a", default_contact_group_id="deleted-group")

    row = service.create("user-a", "Family")

    assert firestore.read("users/user-a")["default_contact_group_id"] == row["id"]


def test_transaction_document_reads_follow_firestore_iterator_contract(service, firestore):
    seeded = service.bootstrap("user-a", "en")
    created = service.create("user-a", "Colleagues")
    renamed = service.rename("user-a", created["id"], "Close Colleagues")
    assigned = service.assign("user-a", "contact-1", created["id"])
    service.reorder(
        "user-a",
        [created["id"], *[group["id"] for group in seeded]],
    )
    deleted = service.delete("user-a", created["id"], seeded[0]["id"])

    assert renamed["name"] == "Close Colleagues"
    assert assigned["group_id"] == created["id"]
    assert deleted["move_to_group_id"] == seeded[0]["id"]
    assert firestore.transaction_query_reads >= 5


def test_create_respects_existing_normalized_name_reservation(service, firestore):
    normalized_name = normalize_group_name("ＦＡＭＩＬＹ")
    reservation_id = hashlib.sha256(normalized_name.encode("utf-8")).hexdigest()
    firestore.seed(
        f"users/user-a/contact_group_name_reservations/{reservation_id}",
        normalized_name=normalized_name,
        group_id="concurrent-winner",
    )

    with pytest.raises(DuplicateGroupName, match="group name already exists"):
        service.create("user-a", "family")


def test_rename_rejects_nfkc_case_and_space_duplicate(service, firestore):
    firestore.seed("users/user-a/contact_groups/family", name="Family Team", normalized_name="family team", sort_order=0)
    firestore.seed("users/user-a/contact_groups/friends", name="Friends", normalized_name="friends", sort_order=1)

    with pytest.raises(DuplicateGroupName, match="group name already exists"):
        service.rename("user-a", "friends", "  ＦＡＭＩＬＹ   team ")


def test_create_assign_and_reorder(service, firestore):
    first = service.create("user-a", "  Family   Team ")
    second = service.create("user-a", "Friends")
    assigned = service.assign("user-a", "contact-1", second["id"])
    reordered = service.reorder("user-a", [second["id"], first["id"]])

    assert first["name"] == "Family Team"
    assert first["normalized_name"] == "family team"
    assert firestore.read("users/user-a")["default_contact_group_id"] == first["id"]
    assert assigned == {"contact_id": "contact-1", "group_id": second["id"]}
    assert firestore.read("users/user-a/chat_meta/contact-1")["group_id"] == second["id"]
    assert [row["id"] for row in reordered] == [second["id"], first["id"]]
    assert [row["sort_order"] for row in reordered] == [0, 1]

    with pytest.raises(ContactGroupError, match="ordered_group_ids must contain every group exactly once"):
        service.reorder("user-a", [first["id"], first["id"]])


def test_create_rejects_empty_and_normalized_duplicate_names(service):
    service.create("user-a", "Family Team")

    with pytest.raises(ContactGroupError, match="group name is required"):
        service.create("user-a", " \t ")
    with pytest.raises(DuplicateGroupName, match="group name already exists"):
        service.create("user-a", "  ＦＡＭＩＬＹ   team ")


def test_assign_rejects_unknown_group(service):
    with pytest.raises(GroupNotFound, match="group not found"):
        service.assign("user-a", "contact-1", "missing")


def test_assign_rejects_group_being_deleted(service, firestore):
    firestore.seed(
        "users/user-a/contact_groups/source",
        name="Source",
        normalized_name="source",
        sort_order=0,
        deletion_state="deleting",
        move_to_group_id="destination",
    )

    with pytest.raises(ContactGroupError, match="group deletion is in progress"):
        service.assign("user-a", "contact-1", "source")


def test_delete_moves_contacts_and_promotes_destination_when_source_is_default(service, firestore):
    firestore.seed("users/user-a", default_contact_group_id="source")
    firestore.seed("users/user-a/contact_groups/source", name="Source", normalized_name="source", sort_order=0)
    firestore.seed("users/user-a/contact_groups/destination", name="Destination", normalized_name="destination", sort_order=1)
    firestore.seed("users/user-a/chat_meta/contact-1", group_id="source")
    firestore.seed("users/user-a/chat_meta/contact-2", group_id="source")

    result = service.delete("user-a", "source", "destination")

    assert result == {"deleted_group_id": "source", "move_to_group_id": "destination"}
    assert firestore.read("users/user-a/contact_groups/source") is None
    assert firestore.read("users/user-a/chat_meta/contact-1")["group_id"] == "destination"
    assert firestore.read("users/user-a/chat_meta/contact-2")["group_id"] == "destination"
    assert firestore.read("users/user-a")["default_contact_group_id"] == "destination"


def test_delete_migrates_451_contacts_in_batches_of_at_most_450(service, firestore):
    firestore.seed("users/user-a/contact_groups/source", name="Source", normalized_name="source", sort_order=0)
    firestore.seed("users/user-a/contact_groups/destination", name="Destination", normalized_name="destination", sort_order=1)
    for index in range(451):
        firestore.seed(f"users/user-a/chat_meta/contact-{index}", group_id="source")

    service.delete("user-a", "source", "destination")

    assert firestore.batch_sizes == [450, 1]
    assert all(
        firestore.read(f"users/user-a/chat_meta/contact-{index}")["group_id"] == "destination"
        for index in range(451)
    )


def test_delete_resumes_after_interrupted_contact_migration(service, firestore):
    firestore.seed("users/user-a/contact_groups/source", name="Source", normalized_name="source", sort_order=0)
    firestore.seed("users/user-a/contact_groups/destination", name="Destination", normalized_name="destination", sort_order=1)
    firestore.seed("users/user-a/chat_meta/contact-1", group_id="source")
    firestore.fail_next_batch_commit = True

    with pytest.raises(RuntimeError, match="injected batch failure"):
        service.delete("user-a", "source", "destination")

    source = firestore.read("users/user-a/contact_groups/source")
    assert source["deletion_state"] == "deleting"
    assert source["move_to_group_id"] == "destination"

    service.delete("user-a", "source", "destination")
    assert firestore.read("users/user-a/contact_groups/source") is None
    assert firestore.read("users/user-a/chat_meta/contact-1")["group_id"] == "destination"


def test_delete_protects_last_group_and_rejects_invalid_destination(service, firestore):
    firestore.seed("users/user-a/contact_groups/only", name="Only", normalized_name="only", sort_order=0)

    with pytest.raises(LastGroupDeletion):
        service.delete("user-a", "only", "missing")

    firestore.seed("users/user-a/contact_groups/other", name="Other", normalized_name="other", sort_order=1)
    with pytest.raises(ContactGroupError):
        service.delete("user-a", "only", "only")
    with pytest.raises(GroupNotFound):
        service.delete("user-a", "only", "missing")
