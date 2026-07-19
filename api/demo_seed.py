"""Idempotent Firestore seed for the OpenAI Build Week judge accounts."""

import hashlib

from contact_groups import ContactGroupService
from demo_accounts import DEMO_ACCOUNTS


def build_tester_user_id(email):
    digest = hashlib.sha1(email.strip().lower().encode("utf-8")).hexdigest()
    return f"tester_{digest[:24]}"


def _set_changed_fields(reference, required, server_timestamp, *, accepted=False):
    snapshot = reference.get()
    existing = snapshot.to_dict() if snapshot.exists else {}
    existing = existing or {}
    changes = {
        key: value
        for key, value in required.items()
        if existing.get(key) != value
    }
    if not changes:
        return existing
    changes["updated_at"] = server_timestamp
    if not snapshot.exists:
        changes["created_at"] = server_timestamp
        if accepted:
            changes["accepted_at"] = server_timestamp
    reference.set(changes, merge=True)
    return {**existing, **changes}


def _assign_default_group(service, client, owner_id, contact_id, group_id):
    metadata_ref = (
        client.collection("users")
        .document(owner_id)
        .collection("chat_meta")
        .document(contact_id)
    )
    snapshot = metadata_ref.get()
    values = snapshot.to_dict() if snapshot.exists else {}
    if (values or {}).get("group_id") != group_id:
        service.assign(owner_id, contact_id, group_id)


def seed_demo_accounts(client, server_timestamp):
    accounts = {
        key: {**dict(spec), "id": build_tester_user_id(spec["email"])}
        for key, spec in DEMO_ACCOUNTS.items()
    }
    for account in accounts.values():
        user_ref = client.collection("users").document(account["id"])
        snapshot = user_ref.get()
        existing = snapshot.to_dict() if snapshot.exists else {}
        existing = existing or {}
        _set_changed_fields(
            user_ref,
            {
                "display_name": account["display_name"],
                "email": account["email"],
                "email_verified": True,
                "provider": "tester",
                "ai_avatar_url": existing.get("ai_avatar_url") or "/images/fish.png",
            },
            server_timestamp,
        )

    service = ContactGroupService(client, server_timestamp)
    for account in accounts.values():
        service.bootstrap(account["id"], "en")

    judy = accounts["judy"]
    haland = accounts["haland"]
    user_a, user_b = sorted([judy, haland], key=lambda item: item["id"])
    pair_key = f'{user_a["id"]}_{user_b["id"]}'
    friendship = {
        "pair_key": pair_key,
        "user_a_id": user_a["id"],
        "user_b_id": user_b["id"],
        "user_a_email": user_a["email"],
        "user_b_email": user_b["email"],
        "user_a_display_name": user_a["display_name"],
        "user_b_display_name": user_b["display_name"],
        "alias_for_a": user_b["display_name"],
        "alias_for_b": user_a["display_name"],
        "special_prompt_for_a": "",
        "special_prompt_for_b": "",
        "relationship_for_a": "Build Week demo friend",
        "relationship_for_b": "Build Week demo friend",
        "status": "accepted",
        "requested_by": judy["id"],
    }
    friendship_ref = client.collection("friendships").document(pair_key)
    _set_changed_fields(
        friendship_ref,
        friendship,
        server_timestamp,
        accepted=True,
    )

    judy_group_id = service.get_default_group_id(judy["id"])
    haland_group_id = service.get_default_group_id(haland["id"])
    _assign_default_group(service, client, judy["id"], haland["id"], judy_group_id)
    _assign_default_group(service, client, haland["id"], judy["id"], haland_group_id)
    return {
        "accounts": accounts,
        "friendship": friendship,
        "judy_group_id": judy_group_id,
        "haland_group_id": haland_group_id,
    }
