"""Pure contact-group domain behavior backed by an injected Firestore client."""

from __future__ import annotations

from datetime import datetime
import hashlib
import math
import unicodedata

from google.cloud import firestore


class ContactGroupError(RuntimeError):
    status_code = 400

    def __init__(self, message="contact group error", status_code=None):
        super().__init__(message)
        if status_code is not None:
            self.status_code = status_code


class DuplicateGroupName(ContactGroupError):
    pass


class GroupNotFound(ContactGroupError):
    status_code = 404


class LastGroupDeletion(ContactGroupError):
    pass


def _clean_group_name(name):
    return " ".join(unicodedata.normalize("NFKC", str(name or "")).split())


def normalize_group_name(name):
    return _clean_group_name(name).casefold()


def seed_group_specs(locale):
    traditional_chinese_locales = {"zh-tw", "zh-hant", "zh-hant-tw"}
    names = (
        ["家人", "朋友", "商務", "路人甲"]
        if str(locale or "").lower() in traditional_chinese_locales
        else ["Family", "Friends", "Business", "Others"]
    )
    final_index = len(names) - 1
    return [
        {
            "name": name,
            "normalized_name": normalize_group_name(name),
            "sort_order": index,
            "is_default": index == final_index,
        }
        for index, name in enumerate(names)
    ]


def _timestamp_value(value):
    try:
        if isinstance(value, str):
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        timestamp = value.timestamp()
        if math.isfinite(timestamp):
            return timestamp
    except (AttributeError, TypeError, ValueError, OverflowError, OSError):
        pass
    return None


def sort_contact_records(contacts):
    def sort_key(contact):
        timestamp = _timestamp_value(contact.get("last_message_at"))
        missing = timestamp is None
        name = str(contact.get("name") or "").casefold()
        return (missing, -(timestamp or 0), name)

    return sorted(contacts, key=sort_key)


def _integer_sort_order(value):
    if isinstance(value, bool):
        return 0
    try:
        return int(value)
    except (TypeError, ValueError, OverflowError):
        return 0


class ContactGroupService:
    def __init__(self, client, server_timestamp):
        self.client = client
        self.server_timestamp = server_timestamp

    def _user_ref(self, user_id):
        return self.client.collection("users").document(user_id)

    def _groups(self, user_id):
        return self._user_ref(user_id).collection("contact_groups")

    def _reservations(self, user_id):
        return self._user_ref(user_id).collection("contact_group_name_reservations")

    def _reservation_ref(self, user_id, normalized_name):
        reservation_id = hashlib.sha256(normalized_name.encode("utf-8")).hexdigest()
        return self._reservations(user_id).document(reservation_id)

    def _run_transaction(self, operation):
        transactional_operation = firestore.transactional(operation)
        return transactional_operation(self.client.transaction())

    @staticmethod
    def _transaction_rows(transaction, collection):
        query = collection.order_by("__name__")
        return list(transaction.get(query))

    @staticmethod
    def _transaction_snapshot(transaction, reference):
        return next(iter(transaction.get(reference)))

    @staticmethod
    def _group_row(snapshot):
        return {"id": snapshot.id, **snapshot.to_dict()}

    @staticmethod
    def _ensure_not_deleting(group):
        if group.get("deletion_state") == "deleting":
            raise ContactGroupError("group deletion is in progress")

    @staticmethod
    def _check_group_name_available(
        normalized_name,
        group_snapshots,
        reservation_snapshot,
        excluded_id="",
    ):
        for snapshot in group_snapshots:
            if snapshot.id == excluded_id:
                continue
            values = snapshot.to_dict()
            existing = values.get("normalized_name")
            if existing is None:
                existing = normalize_group_name(values.get("name"))
            if existing == normalized_name:
                raise DuplicateGroupName("group name already exists")

        if not reservation_snapshot.exists:
            return
        reservation = reservation_snapshot.to_dict()
        if reservation.get("normalized_name") != normalized_name:
            raise ContactGroupError("group name reservation collision")
        if reservation.get("group_id") != excluded_id:
            raise DuplicateGroupName("group name already exists")

    def _require_group(self, user_id, group_id):
        reference = self._groups(user_id).document(group_id)
        snapshot = reference.get()
        if not snapshot.exists:
            raise GroupNotFound("group not found")
        return {"id": snapshot.id, **snapshot.to_dict()}

    def _validate_unique(self, user_id, name, excluded_id=""):
        normalized_name = normalize_group_name(name)
        if not normalized_name:
            raise ContactGroupError("group name is required")
        for snapshot in self._groups(user_id).stream():
            if snapshot.id == excluded_id:
                continue
            values = snapshot.to_dict()
            existing_name = values.get("normalized_name")
            if existing_name is None:
                existing_name = normalize_group_name(values.get("name"))
            if existing_name == normalized_name:
                raise DuplicateGroupName("group name already exists")
        return normalized_name

    def list_groups(self, user_id):
        groups = [
            {"id": snapshot.id, **snapshot.to_dict()}
            for snapshot in self._groups(user_id).stream()
        ]
        return sorted(
            groups,
            key=lambda group: (_integer_sort_order(group.get("sort_order")), group["id"]),
        )

    def get_default_group_id(self, user_id):
        snapshot = self._user_ref(user_id).get()
        if not snapshot.exists:
            return ""
        value = (snapshot.to_dict() or {}).get("default_contact_group_id")
        return value.strip() if isinstance(value, str) else ""

    def bootstrap(self, user_id, locale):
        specs = seed_group_specs(locale)
        references = [self._groups(user_id).document() for _ in specs]

        def operation(transaction):
            group_snapshots = self._transaction_rows(transaction, self._groups(user_id))
            if group_snapshots:
                return sorted(
                    [self._group_row(snapshot) for snapshot in group_snapshots],
                    key=lambda group: (
                        _integer_sort_order(group.get("sort_order")),
                        group["id"],
                    ),
                )

            reservation_snapshots = [
                self._transaction_snapshot(
                    transaction,
                    self._reservation_ref(user_id, spec["normalized_name"]),
                )
                for spec in specs
            ]
            for spec, reservation_snapshot in zip(specs, reservation_snapshots):
                self._check_group_name_available(
                    spec["normalized_name"],
                    group_snapshots,
                    reservation_snapshot,
                )

            created = []
            for spec, reference in zip(specs, references):
                stored = {
                    key: value for key, value in spec.items() if key != "is_default"
                }
                stored.update(
                    created_at=self.server_timestamp,
                    updated_at=self.server_timestamp,
                )
                transaction.set(reference, stored)
                transaction.set(
                    self._reservation_ref(user_id, spec["normalized_name"]),
                    {
                        "normalized_name": spec["normalized_name"],
                        "group_id": reference.id,
                    },
                )
                created.append(
                    {"id": reference.id, **stored, "is_default": spec["is_default"]}
                )

            transaction.set(
                self._user_ref(user_id),
                {
                    "default_contact_group_id": created[-1]["id"],
                    "contact_groups_initialized": True,
                },
                merge=True,
            )
            return created

        return self._run_transaction(operation)

    def create(self, user_id, name):
        normalized_name = normalize_group_name(name)
        if not normalized_name:
            raise ContactGroupError("group name is required")
        reference = self._groups(user_id).document()
        values = {
            "name": _clean_group_name(name),
            "normalized_name": normalized_name,
            "created_at": self.server_timestamp,
            "updated_at": self.server_timestamp,
        }

        def operation(transaction):
            group_snapshots = self._transaction_rows(transaction, self._groups(user_id))
            reservation_ref = self._reservation_ref(user_id, normalized_name)
            reservation_snapshot = self._transaction_snapshot(
                transaction, reservation_ref
            )
            self._check_group_name_available(
                normalized_name,
                group_snapshots,
                reservation_snapshot,
            )
            next_sort_order = (
                max(
                    _integer_sort_order(snapshot.to_dict().get("sort_order"))
                    for snapshot in group_snapshots
                )
                + 1
                if group_snapshots
                else 0
            )
            stored = {**values, "sort_order": next_sort_order}
            transaction.set(reference, stored)
            transaction.set(
                reservation_ref,
                {"normalized_name": normalized_name, "group_id": reference.id},
            )
            if not group_snapshots:
                transaction.set(
                    self._user_ref(user_id),
                    {"default_contact_group_id": reference.id},
                    merge=True,
                )
            return {"id": reference.id, **stored}

        return self._run_transaction(operation)

    def rename(self, user_id, group_id, name):
        normalized_name = normalize_group_name(name)
        if not normalized_name:
            raise ContactGroupError("group name is required")
        group_ref = self._groups(user_id).document(group_id)

        def operation(transaction):
            group_snapshot = self._transaction_snapshot(transaction, group_ref)
            if not group_snapshot.exists:
                raise GroupNotFound("group not found")
            group = self._group_row(group_snapshot)
            self._ensure_not_deleting(group)
            group_snapshots = self._transaction_rows(transaction, self._groups(user_id))
            new_reservation_ref = self._reservation_ref(user_id, normalized_name)
            new_reservation = self._transaction_snapshot(
                transaction, new_reservation_ref
            )
            old_normalized_name = group.get("normalized_name") or normalize_group_name(
                group.get("name")
            )
            old_reservation_ref = self._reservation_ref(user_id, old_normalized_name)
            if old_reservation_ref.id != new_reservation_ref.id:
                self._transaction_snapshot(transaction, old_reservation_ref)
            self._check_group_name_available(
                normalized_name,
                group_snapshots,
                new_reservation,
                excluded_id=group_id,
            )

            transaction.set(
                group_ref,
                {
                    "name": _clean_group_name(name),
                    "normalized_name": normalized_name,
                    "updated_at": self.server_timestamp,
                },
                merge=True,
            )
            transaction.set(
                new_reservation_ref,
                {"normalized_name": normalized_name, "group_id": group_id},
            )
            if old_reservation_ref.id != new_reservation_ref.id:
                transaction.delete(old_reservation_ref)
            return {
                **group,
                "name": _clean_group_name(name),
                "normalized_name": normalized_name,
                "updated_at": self.server_timestamp,
            }

        return self._run_transaction(operation)

    def reorder(self, user_id, ordered_group_ids):
        ordered_ids = list(ordered_group_ids or [])

        def operation(transaction):
            snapshots = self._transaction_rows(transaction, self._groups(user_id))
            groups = [self._group_row(snapshot) for snapshot in snapshots]
            current_ids = [group["id"] for group in groups]
            if len(ordered_ids) != len(current_ids) or set(ordered_ids) != set(
                current_ids
            ):
                raise ContactGroupError(
                    "ordered_group_ids must contain every group exactly once"
                )
            if any(group.get("deletion_state") == "deleting" for group in groups):
                raise ContactGroupError("group deletion is in progress")
            for sort_order, group_id in enumerate(ordered_ids):
                transaction.set(
                    self._groups(user_id).document(group_id),
                    {"sort_order": sort_order, "updated_at": self.server_timestamp},
                    merge=True,
                )

        self._run_transaction(operation)
        return self.list_groups(user_id)

    def assign(self, user_id, contact_id, group_id):
        group_ref = self._groups(user_id).document(group_id)
        contact_ref = self._user_ref(user_id).collection("chat_meta").document(contact_id)

        def operation(transaction):
            group_snapshot = self._transaction_snapshot(transaction, group_ref)
            if not group_snapshot.exists:
                raise GroupNotFound("group not found")
            self._ensure_not_deleting(group_snapshot.to_dict())
            transaction.set(
                contact_ref,
                {"group_id": group_id, "updated_at": self.server_timestamp},
                merge=True,
            )

        self._run_transaction(operation)
        return {"contact_id": contact_id, "group_id": group_id}

    def delete(self, user_id, group_id, move_to_group_id):
        if not move_to_group_id:
            raise ContactGroupError("move_to_group_id is required")
        if move_to_group_id == group_id:
            raise ContactGroupError("move_to_group_id must differ from group_id")

        source_ref = self._groups(user_id).document(group_id)
        destination_ref = self._groups(user_id).document(move_to_group_id)

        def mark_deleting(transaction):
            source_snapshot = self._transaction_snapshot(transaction, source_ref)
            destination_snapshot = self._transaction_snapshot(
                transaction, destination_ref
            )
            group_snapshots = self._transaction_rows(transaction, self._groups(user_id))
            if not source_snapshot.exists:
                raise GroupNotFound("group not found")
            if len(group_snapshots) <= 1:
                raise LastGroupDeletion("cannot delete the last group")
            if not destination_snapshot.exists:
                raise GroupNotFound("group not found")
            source = source_snapshot.to_dict()
            destination = destination_snapshot.to_dict()
            self._ensure_not_deleting(destination)
            deleting_groups = [
                snapshot
                for snapshot in group_snapshots
                if snapshot.to_dict().get("deletion_state") == "deleting"
            ]
            if deleting_groups and not (
                len(deleting_groups) == 1 and deleting_groups[0].id == group_id
            ):
                raise ContactGroupError("group deletion is in progress")
            if source.get("deletion_state") == "deleting":
                if source.get("move_to_group_id") != move_to_group_id:
                    raise ContactGroupError(
                        "group deletion is already targeting another group"
                    )
                return
            transaction.set(
                source_ref,
                {
                    "deletion_state": "deleting",
                    "move_to_group_id": move_to_group_id,
                    "updated_at": self.server_timestamp,
                },
                merge=True,
            )

        self._run_transaction(mark_deleting)

        contacts = list(
            self._user_ref(user_id)
            .collection("chat_meta")
            .where("group_id", "==", group_id)
            .stream()
        )
        for start in range(0, len(contacts), 450):
            batch = self.client.batch()
            for snapshot in contacts[start : start + 450]:
                batch.set(
                    snapshot.reference,
                    {
                        "group_id": move_to_group_id,
                        "updated_at": self.server_timestamp,
                    },
                    merge=True,
                )
            batch.commit()

        def finish_deleting(transaction):
            source_snapshot = self._transaction_snapshot(transaction, source_ref)
            destination_snapshot = self._transaction_snapshot(
                transaction, destination_ref
            )
            user_snapshot = self._transaction_snapshot(
                transaction, self._user_ref(user_id)
            )
            if not source_snapshot.exists:
                return
            source = source_snapshot.to_dict()
            if source.get("deletion_state") != "deleting" or source.get(
                "move_to_group_id"
            ) != move_to_group_id:
                raise ContactGroupError("group deletion state changed")
            if not destination_snapshot.exists:
                raise GroupNotFound("group not found")
            self._ensure_not_deleting(destination_snapshot.to_dict())
            normalized_name = source.get("normalized_name") or normalize_group_name(
                source.get("name")
            )
            reservation_ref = self._reservation_ref(user_id, normalized_name)
            reservation_snapshot = self._transaction_snapshot(
                transaction, reservation_ref
            )

            user_values = user_snapshot.to_dict() or {}
            if user_values.get("default_contact_group_id") == group_id:
                transaction.set(
                    self._user_ref(user_id),
                    {"default_contact_group_id": move_to_group_id},
                    merge=True,
                )
            transaction.delete(source_ref)
            if reservation_snapshot.exists:
                reservation = reservation_snapshot.to_dict()
                if (
                    reservation.get("normalized_name") == normalized_name
                    and reservation.get("group_id") == group_id
                ):
                    transaction.delete(reservation_ref)

        self._run_transaction(finish_deleting)
        return {
            "deleted_group_id": group_id,
            "move_to_group_id": move_to_group_id,
        }
