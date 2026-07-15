# Convia Redesign and OpenAI Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved ChatGPT-style Convia interface, synchronized Firestore contact groups, and OpenAI-backed text and AI voice features without breaking real-person messaging, AI Assist, media generation, or deployment.

**Architecture:** Keep `App.jsx` as the top-level behavior coordinator while extracting the new visual shell into focused React components. Add isolated backend services for Firestore contact groups and OpenAI, then adapt existing Flask routes incrementally so every provider and data migration has a testable boundary. Firestore remains authoritative for history and unread state; OpenAI is stateless across requests except for a short-lived Realtime session.

**Tech Stack:** React 18, Vite 5, Vitest, React Testing Library, Flask, pytest, Firestore, Ably, OpenAI Responses/Audio/Realtime APIs, Google Gemini/Lyria for image and music only, Vercel, Google Cloud Run.

---

## Execution Order and File Map

Backend foundation:

- Create `api/contact_groups.py`: group normalization, defaults, Firestore mutations, contact assignment, and migration.
- Create `api/openai_service.py`: Responses, structured decisions, streaming, transcription, TTS, and Realtime client-secret creation.
- Create `api/tests/conftest.py`: Flask test client and provider fakes.
- Create `api/tests/test_contact_groups.py`: group-domain and Firestore-contract tests.
- Create `api/tests/test_group_routes.py`: authenticated route tests.
- Create `api/tests/test_openai_service.py`: provider request/response tests.
- Create `api/tests/test_openai_routes.py`: chat, audio, and Realtime route tests.
- Modify `api/main.py`: route wiring, provider replacement, metadata fields, and settings migration.
- Modify `api/requirements.txt`: OpenAI and test dependencies.

Frontend foundation:

- Create `web/src/lib/i18n.js`: Traditional-Chinese-versus-English selection.
- Create `web/src/lib/chatState.js`: group unread totals and contact sorting.
- Create `web/src/lib/stream.js`: NDJSON stream reader.
- Create `web/src/components/icons.jsx`: inline SVG controls.
- Create `web/src/components/Dialog.jsx`: accessible shared dialog.
- Create `web/src/features/chat/ChatShell.jsx`.
- Create `web/src/features/chat/ContactSidebar.jsx`.
- Create `web/src/features/chat/ContactGroup.jsx`.
- Create `web/src/features/chat/Conversation.jsx`.
- Create `web/src/features/chat/ConversationHeader.jsx`.
- Create `web/src/features/chat/MessageRow.jsx`.
- Create `web/src/features/chat/Composer.jsx`.
- Create `web/src/features/groups/GroupManagerDialog.jsx`.
- Create `web/src/features/calls/AiCallOverlay.jsx`.
- Create `web/src/features/calls/useOpenAIRealtime.js`.
- Create `web/src/styles/tokens.css`, `app-shell.css`, `chat.css`, and `dialogs.css`.
- Create focused tests beside frontend modules as `*.test.jsx` or `*.test.js`.
- Modify `web/src/App.jsx`: adopt extracted components while preserving existing callbacks and state transitions.
- Modify `web/src/main.jsx`, `web/index.html`, `web/package.json`, and `web/vite.config.js`.
- Remove `@google/genai` from the web package only after Gemini Live browser code is gone.

Documentation and operations:

- Modify `README.md`: Convia name, OpenAI configuration, provider ownership, and local test commands.
- Keep internal Cloud Run service name, Firestore database, `pisces-core`, session cookie, endpoint URLs, and repository remote unchanged.

### Task 1: Establish Backend Test and Configuration Foundations

**Files:**
- Modify: `api/requirements.txt`
- Create: `api/tests/conftest.py`
- Create: `api/tests/test_configuration.py`
- Modify: `api/main.py:89-110` (`get_config_value` and provider key helpers)

- [ ] **Step 1: Add failing configuration tests**

```python
# api/tests/test_configuration.py
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
```

- [ ] **Step 2: Run the focused test and verify the missing helper failure**

Run: `cd api && pytest -q tests/test_configuration.py`  
Expected: FAIL because `get_openai_api_key` is not defined.

- [ ] **Step 3: Add dependencies and the minimal key helper**

Add to `api/requirements.txt`:

```text
openai
pytest
```

Add beside the existing Gemini key helper in `api/main.py`:

```python
def get_openai_api_key():
    return get_config_value("OPENAI_KEY", "OPENAI_API_KEY")
```

- [ ] **Step 4: Add a reusable authenticated Flask test client**

```python
# api/tests/conftest.py
import os
import sys
from pathlib import Path

import pytest

API_DIR = Path(__file__).resolve().parents[1]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

os.environ.setdefault("SESSION_SECRET", "test-secret")

import main  # noqa: E402


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
```

- [ ] **Step 5: Run tests and compile the backend**

Run: `cd api && pytest -q tests/test_configuration.py && python -m py_compile main.py`  
Expected: PASS and no compiler output.

- [ ] **Step 6: Commit the foundation**

```bash
git add api/requirements.txt api/main.py api/tests/conftest.py api/tests/test_configuration.py
git commit -m "test: add backend provider configuration coverage"
```

### Task 2: Implement the Contact-Group Domain Service

**Files:**
- Create: `api/contact_groups.py`
- Create: `api/tests/test_contact_groups.py`

- [ ] **Step 1: Write failing pure-domain tests**

```python
# api/tests/test_contact_groups.py
import pytest

from contact_groups import (
    ContactGroupService,
    DuplicateGroupName,
    normalize_group_name,
    seed_group_specs,
    sort_contact_records,
)


def test_normalize_group_name_collapses_unicode_case_and_spaces():
    assert normalize_group_name("  ＦＡＭＩＬＹ   Team ") == "family team"


def test_seed_groups_choose_traditional_chinese_only_for_zh_hant():
    assert [g["name"] for g in seed_group_specs("zh-TW")] == ["家人", "朋友", "商務", "路人甲"]
    assert [g["name"] for g in seed_group_specs("zh-CN")] == ["Family", "Friends", "Business", "Others"]
    assert seed_group_specs("zh-TW")[-1]["is_default"] is True


def test_sort_contacts_uses_latest_message_then_display_name():
    contacts = [
        {"id": "b", "name": "Beta", "last_message_at": None},
        {"id": "a", "name": "Alpha", "last_message_at": None},
        {"id": "c", "name": "Recent", "last_message_at": "2026-07-15T10:00:00+00:00"},
    ]
    assert [c["id"] for c in sort_contact_records(contacts)] == ["c", "a", "b"]
```

- [ ] **Step 2: Run tests and confirm the module is missing**

Run: `cd api && pytest -q tests/test_contact_groups.py`  
Expected: FAIL with `ModuleNotFoundError: contact_groups`.

- [ ] **Step 3: Implement normalization, defaults, and sorting**

```python
# api/contact_groups.py
import unicodedata
from datetime import datetime, timezone


class ContactGroupError(RuntimeError):
    status_code = 400


class DuplicateGroupName(ContactGroupError):
    pass


class GroupNotFound(ContactGroupError):
    status_code = 404


class LastGroupDeletion(ContactGroupError):
    pass


def normalize_group_name(name):
    normalized = unicodedata.normalize("NFKC", str(name or ""))
    return " ".join(normalized.strip().split()).casefold()


def seed_group_specs(locale):
    names = ["家人", "朋友", "商務", "路人甲"] if str(locale or "").lower() in {"zh-tw", "zh-hant", "zh-hant-tw"} else ["Family", "Friends", "Business", "Others"]
    return [
        {"name": name, "normalized_name": normalize_group_name(name), "sort_order": index, "is_default": index == 3}
        for index, name in enumerate(names)
    ]


def _timestamp_value(value):
    if hasattr(value, "timestamp"):
        return value.timestamp()
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return float("-inf")
    return float("-inf")


def sort_contact_records(contacts):
    return sorted(
        contacts,
        key=lambda item: (-_timestamp_value(item.get("last_message_at")), str(item.get("name") or "").casefold()),
    )
```

- [ ] **Step 4: Add service methods with injected Firestore client**

Implement `ContactGroupService(client, server_timestamp)` with these explicit methods and return shapes:

```python
class ContactGroupService:
    def __init__(self, client, server_timestamp):
        self.client = client
        self.server_timestamp = server_timestamp

    def _user_ref(self, user_id):
        return self.client.collection("users").document(user_id)

    def _groups(self, user_id):
        return self._user_ref(user_id).collection("contact_groups")

    def _require_group(self, user_id, group_id):
        snapshot = self._groups(user_id).document(group_id).get()
        if not snapshot.exists:
            raise GroupNotFound("group not found")
        return {"id": snapshot.id, **(snapshot.to_dict() or {})}

    def _validate_unique(self, user_id, name, excluded_id=""):
        normalized = normalize_group_name(name)
        if not normalized:
            raise ContactGroupError("group name is required")
        for row in self.list_groups(user_id):
            if row["id"] != excluded_id and row.get("normalized_name") == normalized:
                raise DuplicateGroupName("group name already exists")
        return normalized

    def list_groups(self, user_id):
        docs = self.client.collection("users").document(user_id).collection("contact_groups").stream()
        rows = [{"id": doc.id, **(doc.to_dict() or {})} for doc in docs]
        return sorted(rows, key=lambda row: (int(row.get("sort_order") or 0), row["id"]))

    def bootstrap(self, user_id, locale):
        existing = self.list_groups(user_id)
        if existing:
            return existing
        created = []
        batch = self.client.batch()
        for spec in seed_group_specs(locale):
            ref = self._groups(user_id).document()
            payload = {
                **{key: value for key, value in spec.items() if key != "is_default"},
                "created_at": self.server_timestamp,
                "updated_at": self.server_timestamp,
            }
            batch.set(ref, payload)
            created.append({"id": ref.id, **payload, "is_default": spec["is_default"]})
        default_id = next(row["id"] for row in created if row["is_default"])
        batch.set(self._user_ref(user_id), {"default_contact_group_id": default_id}, merge=True)
        batch.commit()
        return created

    def create(self, user_id, name):
        normalized = self._validate_unique(user_id, name)
        groups = self.list_groups(user_id)
        ref = self._groups(user_id).document()
        payload = {
            "name": " ".join(str(name).strip().split()),
            "normalized_name": normalized,
            "sort_order": max([int(row.get("sort_order") or 0) for row in groups], default=-1) + 1,
            "created_at": self.server_timestamp,
            "updated_at": self.server_timestamp,
        }
        ref.set(payload)
        if not groups:
            self._user_ref(user_id).set({"default_contact_group_id": ref.id}, merge=True)
        return {"id": ref.id, **payload}

    def rename(self, user_id, group_id, name):
        self._require_group(user_id, group_id)
        normalized = self._validate_unique(user_id, name, excluded_id=group_id)
        payload = {
            "name": " ".join(str(name).strip().split()),
            "normalized_name": normalized,
            "updated_at": self.server_timestamp,
        }
        self._groups(user_id).document(group_id).set(payload, merge=True)
        return self._require_group(user_id, group_id)

    def reorder(self, user_id, ordered_group_ids):
        current_ids = [row["id"] for row in self.list_groups(user_id)]
        requested = list(ordered_group_ids or [])
        if len(requested) != len(set(requested)) or set(requested) != set(current_ids):
            raise ContactGroupError("ordered_group_ids must contain every group exactly once")
        batch = self.client.batch()
        for index, group_id in enumerate(requested):
            batch.set(
                self._groups(user_id).document(group_id),
                {"sort_order": index, "updated_at": self.server_timestamp},
                merge=True,
            )
        batch.commit()
        return self.list_groups(user_id)

    def assign(self, user_id, contact_id, group_id):
        self._require_group(user_id, group_id)
        self._user_ref(user_id).collection("chat_meta").document(contact_id).set(
            {"group_id": group_id, "updated_at": self.server_timestamp},
            merge=True,
        )
        return {"contact_id": contact_id, "group_id": group_id}

    def delete(self, user_id, group_id, move_to_group_id):
        groups = self.list_groups(user_id)
        if len(groups) <= 1:
            raise LastGroupDeletion("at least one group must remain")
        self._require_group(user_id, group_id)
        if not move_to_group_id or move_to_group_id == group_id:
            raise ContactGroupError("a different destination group is required")
        self._require_group(user_id, move_to_group_id)

        meta_collection = self._user_ref(user_id).collection("chat_meta")
        matching = list(meta_collection.where("group_id", "==", group_id).stream())
        for start in range(0, len(matching), 450):
            batch = self.client.batch()
            for snapshot in matching[start:start + 450]:
                batch.set(
                    snapshot.reference,
                    {"group_id": move_to_group_id, "updated_at": self.server_timestamp},
                    merge=True,
                )
            batch.commit()

        user_snapshot = self._user_ref(user_id).get()
        user_data = user_snapshot.to_dict() if user_snapshot.exists else {}
        final_batch = self.client.batch()
        if user_data.get("default_contact_group_id") == group_id:
            final_batch.set(
                self._user_ref(user_id),
                {"default_contact_group_id": move_to_group_id},
                merge=True,
            )
        final_batch.delete(self._groups(user_id).document(group_id))
        final_batch.commit()
        return {"deleted_group_id": group_id, "move_to_group_id": move_to_group_id}
```

- [ ] **Step 5: Add fake-client tests for create, rename, assign, reorder, and delete**

Add this in-memory Firestore fake to `api/tests/test_contact_groups.py`:

```python
class MemorySnapshot:
    def __init__(self, reference, data):
        self.reference = reference
        self.id = reference.id
        self.exists = data is not None
        self._data = data

    def to_dict(self):
        return dict(self._data or {})


class MemoryDocument:
    def __init__(self, client, path):
        self.client = client
        self.path = path
        self.id = path.rsplit("/", 1)[-1]

    def collection(self, name):
        return MemoryCollection(self.client, f"{self.path}/{name}")

    def get(self):
        return MemorySnapshot(self, self.client.data.get(self.path))

    def set(self, payload, merge=False):
        current = dict(self.client.data.get(self.path) or {}) if merge else {}
        current.update(payload)
        self.client.data[self.path] = current

    def delete(self):
        self.client.data.pop(self.path, None)


class MemoryQuery:
    def __init__(self, collection, field, value):
        self.collection = collection
        self.field = field
        self.value = value

    def stream(self):
        return [row for row in self.collection.stream() if row.to_dict().get(self.field) == self.value]


class MemoryCollection:
    def __init__(self, client, path):
        self.client = client
        self.path = path

    def document(self, document_id=None):
        if document_id is None:
            self.client.counter += 1
            document_id = f"auto-{self.client.counter}"
        return MemoryDocument(self.client, f"{self.path}/{document_id}")

    def stream(self):
        prefix = f"{self.path}/"
        snapshots = []
        for path, data in self.client.data.items():
            suffix = path.removeprefix(prefix)
            if path.startswith(prefix) and "/" not in suffix:
                snapshots.append(MemorySnapshot(MemoryDocument(self.client, path), data))
        return snapshots

    def where(self, field, operator, value):
        assert operator == "=="
        return MemoryQuery(self, field, value)


class MemoryBatch:
    def __init__(self):
        self.operations = []

    def set(self, reference, payload, merge=False):
        self.operations.append(lambda: reference.set(payload, merge=merge))

    def delete(self, reference):
        self.operations.append(reference.delete)

    def commit(self):
        for operation in self.operations:
            operation()


class MemoryClient:
    def __init__(self):
        self.data = {}
        self.counter = 0

    def collection(self, name):
        return MemoryCollection(self, name)

    def batch(self):
        return MemoryBatch()

    def doc(self, path):
        return dict(self.data[path])


@pytest.fixture
def fake_client():
    return MemoryClient()


@pytest.fixture
def service(fake_client):
    return ContactGroupService(fake_client, server_timestamp="SERVER_TIMESTAMP")
```

Then cover:

```python
def test_rename_rejects_normalized_duplicate(service):
    service.create("user-a", "Family")
    other = service.create("user-a", "Work")
    with pytest.raises(DuplicateGroupName):
        service.rename("user-a", other["id"], "  ＦＡＭＩＬＹ ")


def test_delete_moves_contacts_and_promotes_destination_default(service, fake_client):
    groups = service.bootstrap("user-a", "zh-TW")
    source, destination = groups[-1], groups[0]
    service.assign("user-a", "friend-1", source["id"])
    service.delete("user-a", source["id"], destination["id"])
    meta = fake_client.doc("users/user-a/chat_meta/friend-1")
    user = fake_client.doc("users/user-a")
    assert meta["group_id"] == destination["id"]
    assert user["default_contact_group_id"] == destination["id"]
```

- [ ] **Step 6: Run the group-domain suite**

Run: `cd api && pytest -q tests/test_contact_groups.py`  
Expected: PASS.

- [ ] **Step 7: Commit the domain service**

```bash
git add api/contact_groups.py api/tests/test_contact_groups.py
git commit -m "feat: add synchronized contact group service"
```

### Task 3: Add Group Routes and Friend Metadata Migration

**Files:**
- Modify: `api/main.py:1182-1274` (chat metadata helpers)
- Modify: `api/main.py:2528-2703` (friend add/list and group routes)
- Create: `api/tests/test_group_routes.py`

- [ ] **Step 1: Write failing authenticated route tests**

```python
# api/tests/test_group_routes.py
def test_group_routes_require_session(client):
    response = client.post("/api/contact-groups/list", json={})
    assert response.status_code == 401


def test_group_list_bootstraps_and_returns_default(signed_in_client, monkeypatch):
    class StubService:
        def bootstrap(self, user_id, locale):
            assert user_id == "user-a"
            assert locale == "zh-TW"
            return [{"id": "others", "name": "路人甲", "sort_order": 3, "is_default": True}]

    monkeypatch.setattr("main.get_contact_group_service", lambda: StubService())
    response = signed_in_client.post("/api/contact-groups/bootstrap", json={"locale": "zh-TW"})
    assert response.status_code == 200
    assert response.get_json()["groups"][0]["id"] == "others"
```

- [ ] **Step 2: Run the route tests and verify 404 failures**

Run: `cd api && pytest -q tests/test_group_routes.py`  
Expected: FAIL because the group routes do not exist.

- [ ] **Step 3: Wire the service and six authenticated endpoints**

Add `get_contact_group_service()` and routes for bootstrap, list, create, update, reorder, assign, and delete. Use one error adapter:

```python
def contact_group_error_response(exc):
    status = getattr(exc, "status_code", 400)
    return jsonify({"ok": False, "error": str(exc)}), status
```

Each successful response must be shaped as `{ "ok": true, ... }` and return authoritative groups or assignment data.

- [ ] **Step 4: Extend `upsert_chat_meta` without overwriting group membership**

Keep `group_id` untouched during message updates. Add an optional `touch_last_message=True` argument so mark-read does not modify `last_message_at`.

- [ ] **Step 5: Bootstrap or migrate contacts in friend add/list**

On first friend-list load:

1. Bootstrap groups using the request locale.
2. Read the user's `default_contact_group_id`.
3. For every accepted friend missing `chat_meta.group_id`, merge the default ID.
4. Return `group_id`, `last_message_at`, `last_message_preview`, and `unread_count`.

Do not overwrite an existing group assignment.

- [ ] **Step 6: Add tests for metadata and non-destructive migration**

```python
def test_friend_list_returns_group_and_last_message(signed_in_client, monkeypatch):
    # Patch Firestore and group bootstrap, then assert the JSON contains all four metadata fields.
    response = signed_in_client.post("/api/friends/list", json={"locale": "en-US"})
    friend = response.get_json()["friends"][0]
    assert set(["group_id", "last_message_at", "last_message_preview", "unread_count"]) <= set(friend)
```

- [ ] **Step 7: Run group and existing API checks**

Run: `cd api && pytest -q tests/test_contact_groups.py tests/test_group_routes.py && python -m py_compile main.py contact_groups.py`  
Expected: PASS.

- [ ] **Step 8: Commit the API layer**

```bash
git add api/main.py api/tests/test_group_routes.py
git commit -m "feat: expose contact groups and friend metadata"
```

### Task 4: Build the Isolated OpenAI Service

**Files:**
- Create: `api/openai_service.py`
- Create: `api/tests/test_openai_service.py`

- [ ] **Step 1: Write failing provider-unit tests with an injected fake client**

```python
# api/tests/test_openai_service.py
from openai_service import OpenAIModels, OpenAIService


def test_models_use_approved_defaults(monkeypatch):
    monkeypatch.delenv("OPENAI_TEXT_MODEL", raising=False)
    models = OpenAIModels.from_environment()
    assert models.text == "gpt-5.6-terra"
    assert models.router == "gpt-5.6-luna"
    assert models.realtime == "gpt-realtime-2.1"
    assert models.transcription == "gpt-4o-mini-transcribe"
    assert models.tts == "gpt-4o-mini-tts"


def test_safety_identifier_is_stable_and_not_raw_user_id():
    service = OpenAIService(object(), "server-salt")
    first = service.safety_identifier("user-a")
    assert first == service.safety_identifier("user-a")
    assert first != "user-a"
    assert len(first) <= 64
```

- [ ] **Step 2: Run the tests and confirm the module is missing**

Run: `cd api && pytest -q tests/test_openai_service.py`  
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement model configuration and safety identifiers**

```python
# api/openai_service.py
import hashlib
import json
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class OpenAIModels:
    text: str
    router: str
    realtime: str
    transcription: str
    tts: str

    @classmethod
    def from_environment(cls):
        return cls(
            text=os.getenv("OPENAI_TEXT_MODEL", "gpt-5.6-terra"),
            router=os.getenv("OPENAI_ROUTER_MODEL", "gpt-5.6-luna"),
            realtime=os.getenv("OPENAI_REALTIME_MODEL", "gpt-realtime-2.1"),
            transcription=os.getenv("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe"),
            tts=os.getenv("OPENAI_TTS_MODEL", "gpt-4o-mini-tts"),
        )


class OpenAIService:
    def __init__(self, client, safety_salt, models=None):
        self.client = client
        self.safety_salt = safety_salt
        self.models = models or OpenAIModels.from_environment()

    def safety_identifier(self, user_id):
        raw = f"{self.safety_salt}:{user_id}".encode("utf-8")
        return hashlib.sha256(raw).hexdigest()[:64]
```

- [ ] **Step 4: Implement structured router decisions**

Add `decide_chat_output`, `decide_assist_action`, `decide_media_tools`, and `compose_message_for_friend`. Each method must:

- Use `self.models.router`.
- Use Responses structured output with an explicit JSON schema.
- Pass `store=False`.
- Pass the hashed `safety_identifier`.
- Validate missing fields and return a typed plain dictionary.
- Never include a visible reply in a router decision when the visible reply will stream separately.

- [ ] **Step 5: Implement visible-text streaming**

```python
def stream_text(self, *, user_id, instructions, input_items):
    with self.client.responses.stream(
        model=self.models.text,
        instructions=instructions,
        input=input_items,
        store=False,
        safety_identifier=self.safety_identifier(user_id),
        reasoning={"effort": "low"},
    ) as stream:
        for event in stream:
            if event.type == "response.output_text.delta":
                yield event.delta


def generate_text(self, *, user_id, instructions, input_items):
    response = self.client.responses.create(
        model=self.models.text,
        instructions=instructions,
        input=input_items,
        store=False,
        safety_identifier=self.safety_identifier(user_id),
        reasoning={"effort": "low"},
    )
    text = str(response.output_text or "").strip()
    if not text:
        raise RuntimeError("OpenAI returned an empty response")
    return text
```

- [ ] **Step 6: Implement audio and Realtime methods**

```python
def transcribe(self, *, audio_file, prompt=""):
    return self.client.audio.transcriptions.create(
        model=self.models.transcription,
        file=audio_file,
        prompt=prompt or None,
        response_format="text",
    )


def synthesize(self, *, text, voice, instructions):
    return self.client.audio.speech.create(
        model=self.models.tts,
        voice=voice,
        input=text,
        instructions=instructions,
        response_format="wav",
    )


def create_realtime_client_secret(self, *, user_id, instructions, voice):
    return self.client.realtime.client_secrets.create(
        session={
            "type": "realtime",
            "model": self.models.realtime,
            "instructions": instructions,
            "reasoning": {"effort": "low"},
            "audio": {"output": {"voice": voice}},
        },
        extra_headers={"OpenAI-Safety-Identifier": self.safety_identifier(user_id)},
    )
```

Before implementing this step, inspect the installed `openai` package signature for `client.realtime.client_secrets.create` and compare its serialized request with the current OpenAI OpenAPI specification. If the typed method is absent, use `client.post("/realtime/client_secrets", body={"session": ...}, cast_to=dict, options={"extra_headers": ...})` with the identical session payload above.

- [ ] **Step 7: Test payloads, parsed output, streaming deltas, and secret redaction**

The fake client must record calls and emit two deltas (`"Hello"`, `" world"`). Assert the service yields both in order and never returns the configured key.

- [ ] **Step 8: Run and commit**

Run: `cd api && pytest -q tests/test_openai_service.py && python -m py_compile openai_service.py`  
Expected: PASS.

```bash
git add api/openai_service.py api/tests/test_openai_service.py
git commit -m "feat: add isolated OpenAI service"
```

### Task 5: Migrate Text, Routing, and AI Assist to OpenAI

**Files:**
- Modify: `api/main.py:492-648` (chat decisions and TTS entry points)
- Modify: `api/main.py:1454-1655` (reply, assist, media, compose helpers)
- Modify: `api/main.py:1740-2008` (chat route)
- Modify: `api/main.py:3007-3263` (AI Assist route)
- Create: `api/tests/test_openai_routes.py`

- [ ] **Step 1: Write failing route tests proving Gemini text is not called**

```python
def test_chat_uses_openai_and_never_gemini(signed_in_client, monkeypatch):
    class StubOpenAIService:
        def generate_text(self, **kwargs):
            return "Hello"

    monkeypatch.setattr("main.call_gemini_generate_content", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("Gemini text called")))
    monkeypatch.setattr("main.get_chat_messages", lambda *args, **kwargs: [])
    monkeypatch.setattr("main.get_user_ai_settings", lambda *args, **kwargs: dict(main.DEFAULT_AI_SETTINGS))
    monkeypatch.setattr("main.get_user_history_range", lambda *args, **kwargs: 30)
    monkeypatch.setattr("main.save_chat_message", lambda *args, **kwargs: None)
    monkeypatch.setattr("main.get_openai_service", lambda: StubOpenAIService())
    response = signed_in_client.post("/api/chat", json={"message": "Hi", "contact_id": "pisces-core"})
    assert response.status_code == 200
    assert response.get_json()["reply"] == "Hello"
```

- [ ] **Step 2: Add `get_openai_service()` with dependency injection support**

Construct `OpenAI(api_key=get_openai_api_key())`, pass a secret-derived safety salt, and raise a clear configuration error when the key is absent. Cache only the client/service object, not user context.

- [ ] **Step 3: Replace the four Gemini text planners**

Keep existing public helper names temporarily to reduce route churn, but have them delegate to `OpenAIService`:

```python
def decide_media_tools(user_id, user_message, history_messages):
    return get_openai_service().decide_media_tools(
        user_id=user_id,
        user_message=user_message,
        history_messages=history_messages,
    )
```

Perform the same delegation for chat output decisions, AI Assist decisions, and composing a message for a friend. Update all callers to pass `user_id`.

- [ ] **Step 4: Preserve image and music generation only**

Keep `generate_image_with_gemini` and `generate_music_with_lyria` unchanged. Add a test that patches both and verifies they are invoked only after the OpenAI media decision requests them.

- [ ] **Step 5: Add a POST streaming route using NDJSON**

Create `/api/chat/stream`. Emit exactly one JSON object per line:

```json
{"type":"delta","text":"partial"}
{"type":"audio","audio_base64":"...","audio_mime_type":"audio/wav"}
{"type":"done","message_id":"...","reply":"complete","image_url":"","music_url":""}
```

On failure after deltas:

```json
{"type":"error","error":"AI reply was interrupted","retryable":true}
```

Use Flask `Response(generate(), mimetype="application/x-ndjson")`. Accumulate deltas server-side, save the final AI message only after successful completion, then emit `done`.

- [ ] **Step 6: Keep `/api/chat` temporarily compatible**

Route the old endpoint through a non-streaming OpenAI helper so existing UI keeps working until Task 10 switches to `/api/chat/stream`. Do not remove it in the same commit.

- [ ] **Step 7: Migrate AI Assist planning and replies**

Use OpenAI for the private Assist response, sender-identity decision, and composed outbound message. Preserve Firestore roles (`assist_user`, `assist_ai`, `ai_proxy`) and Ably payload shapes.

- [ ] **Step 8: Run route tests and targeted syntax checks**

Run: `cd api && pytest -q tests/test_openai_service.py tests/test_openai_routes.py && python -m py_compile main.py openai_service.py`  
Expected: PASS.

- [ ] **Step 9: Commit the text migration**

```bash
git add api/main.py api/tests/test_openai_routes.py
git commit -m "feat: migrate AI text and assist flows to OpenAI"
```

### Task 6: Migrate Transcription, TTS, and Voice Settings

**Files:**
- Modify: `api/main.py:1127-1180` (AI settings)
- Modify: `api/main.py:1656-1724` (transcription)
- Modify: `api/main.py:2009-2106` (voice chat)
- Modify: `api/main.py:2340-2406` (AI settings route)
- Modify: `api/main.py:2889-3006` (voice messages)
- Modify: `api/main.py:3007-3263` (Assist TTS)
- Modify: `api/tests/test_openai_routes.py`

- [ ] **Step 1: Add failing tests for voice migration defaults**

```python
def test_legacy_voice_maps_to_openai_voice():
    settings = main.sanitize_ai_settings("female", "Leda", "prompt", openai_voice="")
    assert settings["openai_voice"] == "marin"


def test_openai_voice_whitelist():
    settings = main.sanitize_ai_settings("male", "Puck", "prompt", openai_voice="not-a-voice")
    assert settings["openai_voice"] == "cedar"
```

- [ ] **Step 2: Add the shared voice set and migration**

```python
OPENAI_VOICES = {"alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"}


def default_openai_voice(gender):
    return "cedar" if str(gender).lower() == "male" else "marin"
```

Read and write `ai_openai_voice`; keep `ai_voice` and `ai_gender` for historical compatibility.

- [ ] **Step 3: Replace Google Speech transcription**

Wrap bytes in a named `io.BytesIO`, call `OpenAIService.transcribe`, and normalize the returned string. Remove `google-cloud-speech` imports only after no code path uses them.

- [ ] **Step 4: Replace Gemini TTS**

Call `OpenAIService.synthesize`, read the returned bytes, and return base64 WAV using the existing route response fields. Keep the 100-Chinese-character and 50-English-word product limits.

- [ ] **Step 5: Update AI settings API**

Accept `openai_voice`, validate it against `OPENAI_VOICES`, store `ai_openai_voice`, and return it from session/user settings responses.

- [ ] **Step 6: Add an authenticated TTS preview endpoint**

Create `POST /api/speech/synthesize` accepting `text`, `voice`, and optional `instructions`. Limit preview text to 200 characters, validate the voice, call `OpenAIService.synthesize`, and return the existing `{ok, audio_base64, audio_mime_type}` shape. Add tests for authentication, invalid voice, length limit, and a successful mocked WAV response.

- [ ] **Step 7: Verify all recorded voice paths**

Tests must cover:

- Real-person voice message transcription and Blob upload.
- AI-room recorded voice transcription followed by OpenAI reply.
- Explicit read-aloud TTS.
- Assist outbound voice and private Assist voice.
- TTS failure leaves text available.

- [ ] **Step 8: Remove unused Google speech dependency and run tests**

Run: `cd api && pytest -q tests/test_openai_routes.py tests/test_configuration.py && python -m py_compile main.py`  
Expected: PASS.

Remove `google-cloud-speech` from `api/requirements.txt` only when `rg "google\.cloud import speech|speech\.SpeechClient" api` returns no matches.

- [ ] **Step 9: Commit audio migration**

```bash
git add api/main.py api/requirements.txt api/tests/test_openai_routes.py
git commit -m "feat: migrate speech workflows to OpenAI"
```

### Task 7: Replace Gemini Live with OpenAI Realtime Credentials

**Files:**
- Modify: `api/main.py:1331-1453` (live context)
- Modify: `api/main.py:3264-3352` (live routes)
- Modify: `api/tests/test_openai_routes.py`

- [ ] **Step 1: Add failing Realtime route tests**

```python
def test_realtime_secret_is_short_lived_and_key_is_not_returned(signed_in_client, monkeypatch):
    class StubOpenAIService:
        models = type("Models", (), {"realtime": "gpt-realtime-2.1"})()

        def create_realtime_client_secret(self, **kwargs):
            return type("Secret", (), {"value": "ek_test", "expires_at": 1784090000})()

    monkeypatch.setattr("main.get_openai_service", lambda: StubOpenAIService())
    response = signed_in_client.post("/api/openai/realtime/client-secret", json={"mode": "ai", "contact_id": "pisces-core"})
    payload = response.get_json()
    assert response.status_code == 200
    assert payload["client_secret"] == "ek_test"
    assert "OPENAI_KEY" not in response.get_data(as_text=True)


def test_contact_assist_mode_includes_context_but_not_peer_call(signed_in_client, monkeypatch):
    response = signed_in_client.post("/api/openai/realtime/client-secret", json={"mode": "assist", "contact_id": "friend-1"})
    assert response.status_code == 200
```

- [ ] **Step 2: Add the new authenticated route**

Accept only:

- `mode="ai"` with `contact_id="pisces-core"`.
- `mode="assist"` with an accepted real contact.

Reject `mode="peer"` with 501 and `person_to_person_call_not_implemented`.

- [ ] **Step 3: Reuse and rename live context builders**

Rename Gemini-specific functions to provider-neutral names. Preserve:

- AI room history.
- Contact relationship and selected history in Assist mode.
- The instruction that the AI speaks only to the current user.
- Dynamic `about_friend` only in the main AI room.

- [ ] **Step 4: Return only browser-safe Realtime fields**

```python
return jsonify({
    "ok": True,
    "client_secret": secret.value,
    "expires_at": secret.expires_at,
    "model": get_openai_service().models.realtime,
    "voice": voice,
    "mode": mode,
})
```

- [ ] **Step 5: Rename the dynamic context route**

Expose `/api/openai/realtime/about-friend-context` with the existing authenticated behavior. Keep `/api/live/about-friend-context` as a compatibility alias until Task 11 switches the frontend. Both paths must return identical JSON and must reject dynamic friend lookup outside the main AI room.

- [ ] **Step 6: Keep the old token route temporarily as a compatibility alias**

Make `/api/live/token` call the new handler or return a deprecation response understood by the old frontend until Task 11 removes Gemini Live. Do not return Gemini tokens.

- [ ] **Step 7: Run tests and commit**

Run: `cd api && pytest -q tests/test_openai_routes.py && python -m py_compile main.py`  
Expected: PASS.

```bash
git add api/main.py api/tests/test_openai_routes.py
git commit -m "feat: add OpenAI Realtime session credentials"
```

### Task 8: Establish Frontend Tests, Localization, SVG Icons, and Theme Tokens

**Files:**
- Modify: `web/package.json`
- Modify: `web/vite.config.js`
- Modify: `web/src/main.jsx`
- Modify: `web/index.html`
- Create: `web/src/test/setup.js`
- Create: `web/src/lib/i18n.js`
- Create: `web/src/lib/i18n.test.js`
- Create: `web/src/components/icons.jsx`
- Create: `web/src/components/icons.test.jsx`
- Create: `web/src/styles/tokens.css`

- [ ] **Step 1: Add frontend test dependencies and scripts**

Add scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Add development dependencies: `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, and `@testing-library/user-event`.

- [ ] **Step 2: Configure Vitest**

```javascript
// web/vite.config.js
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
  },
})
```

```javascript
// web/src/test/setup.js
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 3: Write failing locale tests**

```javascript
import { describe, expect, it } from 'vitest'
import { localeFromLanguage } from './i18n'

describe('localeFromLanguage', () => {
  it('uses Traditional Chinese only for Hant or Taiwan locales', () => {
    expect(localeFromLanguage('zh-TW')).toBe('zh-TW')
    expect(localeFromLanguage('zh-Hant-HK')).toBe('zh-TW')
    expect(localeFromLanguage('zh-CN')).toBe('en')
    expect(localeFromLanguage('ja-JP')).toBe('en')
  })
})
```

- [ ] **Step 4: Implement locale selection and translation helper**

```javascript
export function localeFromLanguage(language = '') {
  const value = language.toLowerCase()
  return value === 'zh-tw' || value.startsWith('zh-hant') ? 'zh-TW' : 'en'
}

export function translate(locale, english, traditionalChinese) {
  return locale === 'zh-TW' ? traditionalChinese : english
}
```

- [ ] **Step 5: Build inline SVG icon components and a guard test**

Export all required icons from `components/icons.jsx`: menu, plus, chevron, more, settings, phone, AI voice, microphone, send, close, edit, trash, arrow up/down, attachment, play, stop, speaker, and logout. Each component renders `<svg viewBox="0 0 24 24" ...>` and accepts `size`, `title`, and `className`.

Test that rendering the icon set produces SVG nodes and no `img` or emoji text.

- [ ] **Step 6: Add dark theme tokens and global reset**

Define `--bg`, `--sidebar`, `--surface`, `--surface-hover`, `--border`, `--text`, `--muted`, `--danger`, `--unread`, spacing, radii, and focus ring. Import `tokens.css` from `main.jsx`.

- [ ] **Step 7: Update HTML branding**

Set `<html lang>` dynamically from the app, remove the Waterfall font, and set `<title>Convia</title>`.

- [ ] **Step 8: Run tests/build and commit**

Run: `cd web && npm test && npm run build`  
Expected: PASS and Vite build succeeds.

```bash
git add web/package.json web/package-lock.json web/vite.config.js web/src/test web/src/lib/i18n* web/src/components/icons* web/src/styles/tokens.css web/src/main.jsx web/index.html
git commit -m "feat: add Convia UI foundations"
```

### Task 9: Build the Responsive Shell, Sidebar, and Group Manager

**Files:**
- Create: `web/src/lib/chatState.js`
- Create: `web/src/lib/chatState.test.js`
- Create: `web/src/features/chat/ChatShell.jsx`
- Create: `web/src/features/chat/ContactSidebar.jsx`
- Create: `web/src/features/chat/ContactGroup.jsx`
- Create: `web/src/features/chat/ContactSidebar.test.jsx`
- Create: `web/src/features/groups/GroupManagerDialog.jsx`
- Create: `web/src/features/groups/GroupManagerDialog.test.jsx`
- Create: `web/src/components/Dialog.jsx`
- Create: `web/src/styles/app-shell.css`
- Create: `web/src/styles/dialogs.css`
- Modify: `web/src/App.jsx:631-735` (state and contacts)
- Modify: `web/src/App.jsx:2464-3710` (authenticated shell)

- [ ] **Step 1: Write failing group state tests**

```javascript
import { groupContacts, unreadTotal } from './chatState'

it('groups and sorts contacts by latest message', () => {
  const groups = [{ id: 'family', sort_order: 0 }]
  const contacts = [
    { id: 'old', group_id: 'family', last_message_at: '2026-07-14T00:00:00Z' },
    { id: 'new', group_id: 'family', last_message_at: '2026-07-15T00:00:00Z' },
  ]
  expect(groupContacts(groups, contacts).family.map((c) => c.id)).toEqual(['new', 'old'])
  expect(unreadTotal(contacts, { old: 2, new: 3 })).toBe(5)
})
```

- [ ] **Step 2: Implement deterministic state helpers**

`groupContacts(groups, contacts)` must return every group ID, apply the default group to missing assignments, sort by timestamp descending and name second, and never include the AI contact. `unreadTotal` must sum non-negative integers.

- [ ] **Step 3: Build the accessible reusable Dialog**

Implement portal rendering, Escape handling, focus capture/restoration, backdrop close when allowed, `aria-modal`, and labelled title. Add focused tests.

- [ ] **Step 4: Build ChatShell and mobile drawer behavior**

Use CSS grid on desktop and an overlay drawer below 768px. The drawer closes after selection and restores focus to the menu button. Test open, select, close, and Escape.

- [ ] **Step 5: Build ContactSidebar and ContactGroup**

Required visual order:

1. Convia plus add-friend SVG.
2. Fixed Convia AI entry.
3. Ordered group sections.
4. Bottom account/settings row.

Use Google `avatar_url`; on image error set an internal fallback flag and render initials. Render group and contact unread badges with accessible labels.

- [ ] **Step 6: Build GroupManagerDialog**

Implement create, inline rename, up/down ordering, delete destination selection, save disabling, normalized duplicate errors, and server-authoritative refresh callbacks. Do not implement drag-and-drop.

- [ ] **Step 7: Wire group loading and mutations in App**

On sign-in:

1. POST bootstrap with the locale.
2. Load friends with locale.
3. Store groups and `default_contact_group_id`.
4. Reconcile contacts and unread values.

On Ably reconnect, repeat list requests without recreating defaults.

- [ ] **Step 8: Run component tests and build**

Run: `cd web && npm test -- ContactSidebar GroupManagerDialog chatState && npm run build`  
Expected: PASS.

- [ ] **Step 9: Commit sidebar and groups**

```bash
git add web/src/App.jsx web/src/lib/chatState* web/src/components/Dialog.jsx web/src/features/chat/ChatShell.jsx web/src/features/chat/ContactSidebar* web/src/features/chat/ContactGroup.jsx web/src/features/groups web/src/styles/app-shell.css web/src/styles/dialogs.css
git commit -m "feat: add responsive Convia contact groups"
```

### Task 10: Build ChatGPT-Style Messages, Composer, and Streaming

**Files:**
- Create: `web/src/lib/stream.js`
- Create: `web/src/lib/stream.test.js`
- Create: `web/src/features/chat/Conversation.jsx`
- Create: `web/src/features/chat/ConversationHeader.jsx`
- Create: `web/src/features/chat/MessageRow.jsx`
- Create: `web/src/features/chat/MessageRow.test.jsx`
- Create: `web/src/features/chat/Composer.jsx`
- Create: `web/src/features/chat/Composer.test.jsx`
- Create: `web/src/styles/chat.css`
- Modify: `web/src/App.jsx:586-630` (rich message content)
- Modify: `web/src/App.jsx:2464-3260` (conversation and send handlers)

- [ ] **Step 1: Write failing message-role tests**

```javascript
it.each([
  ['user', true],
  ['peer', true],
  ['ai', false],
  ['ai_proxy', false],
  ['assist_ai', false],
])('renders %s bubble=%s', (role, expectedBubble) => {
  const { container } = render(<MessageRow message={{ id: '1', role, text: 'Hello' }} />)
  expect(Boolean(container.querySelector('[data-bubble]'))).toBe(expectedBubble)
})
```

- [ ] **Step 2: Implement MessageRow and preserve rich media**

Move the existing audio/image/music rendering behind MessageRow props. Label Assist output `Convia AI · 只有你看得到` or English equivalent. Use no bubble for every AI-authored role.

- [ ] **Step 3: Implement the NDJSON stream reader**

```javascript
export async function readNdjson(response, onEvent) {
  if (!response.ok || !response.body) throw new Error(`Request failed (${response.status})`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line))
    if (done) break
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer))
}
```

- [ ] **Step 4: Build Conversation and Composer**

Conversation owns scroll anchoring and the sticky header. Composer owns auto-height, composition events, recording status, attachment actions, AI Assist toggle, and send state. It receives existing callbacks rather than duplicating API logic.

- [ ] **Step 5: Switch AI room text to `/api/chat/stream`**

Create a temporary AI message with `status="streaming"`. Append `delta` events. On `done`, replace temporary IDs/metadata and attach audio or media. On `error`, preserve the partial message with `status="incomplete"` and a retry callback.

- [ ] **Step 6: Preserve normal person and Assist send behavior**

Real-person text still calls `/api/messages/send`. AI Assist still calls `/api/assist/message`, displays private AI output without a bubble, and preserves outbound message identity semantics.

- [ ] **Step 7: Test IME, failure preservation, and retry**

Cover Traditional Chinese composition so Enter during composition does not send. Cover a partial stream followed by an error and assert the text remains visible and retry reuses the original user input.

- [ ] **Step 8: Run tests/build and commit**

Run: `cd web && npm test -- MessageRow Composer stream && npm run build`  
Expected: PASS.

```bash
git add web/src/App.jsx web/src/lib/stream* web/src/features/chat/Conversation.jsx web/src/features/chat/MessageRow* web/src/features/chat/Composer* web/src/styles/chat.css
git commit -m "feat: add ChatGPT-style streaming conversations"
```

### Task 11: Implement OpenAI Realtime AI Calls and Reserved Person Calls

**Files:**
- Create: `web/src/features/calls/useOpenAIRealtime.js`
- Create: `web/src/features/calls/useOpenAIRealtime.test.js`
- Create: `web/src/features/calls/AiCallOverlay.jsx`
- Create: `web/src/features/calls/AiCallOverlay.test.jsx`
- Modify: `web/src/features/chat/ConversationHeader.jsx`
- Modify: `web/src/App.jsx:1640-2170` (remove Gemini Live transport)
- Modify: `web/src/App.jsx:4348-4466` (replace phone overlay)
- Modify: `web/package.json`
- Modify: `api/main.py` (remove old live-route compatibility aliases after frontend cutover)

- [ ] **Step 1: Write failing call-entry tests**

```javascript
it('keeps person phone disabled and enables AI Assist voice', () => {
  render(<ConversationHeader contact={{ id: 'friend', isAi: false }} aiAssistMode />)
  expect(screen.getByRole('button', { name: 'Person-to-person calls coming later' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Start private AI voice assist' })).toBeEnabled()
})
```

- [ ] **Step 2: Implement the WebRTC hook**

The hook must:

1. Request `/api/openai/realtime/client-secret` with `mode` and `contact_id`.
2. Create `RTCPeerConnection` and an audio element.
3. Add the microphone track.
4. Create a data channel for Realtime events.
5. POST the SDP offer to the OpenAI Realtime calls endpoint with the ephemeral secret.
6. Apply the answer SDP.
7. Expose `connecting`, `connected`, `muted`, `error`, and `closed` states.
8. Stop tracks, close the data channel, close the peer connection, and clear audio on teardown.

- [ ] **Step 3: Build AiCallOverlay**

Use the approved dark centered overlay on desktop and full-screen mobile. Render AI avatar, name, connection state, timer, waveform animation, mute, speaker, and hang-up SVG controls. Include the AI-generated-voice disclosure.

- [ ] **Step 4: Implement the three call semantics**

- AI room phone: enabled and calls mode `ai`.
- Normal real-contact phone: visible, disabled, future-call accessible text.
- AI Assist mode: separate enabled AI voice SVG and mode `assist`.

- [ ] **Step 5: Preserve `about_friend` in AI room**

Listen for input transcription events on the Realtime data channel. In AI mode only, call `/api/openai/realtime/about-friend-context` and send returned context through a Realtime conversation item. Do not enable this dynamic lookup in contact Assist mode because context is preloaded. Remove the old `/api/live/about-friend-context` compatibility alias after this frontend path passes.

- [ ] **Step 6: Remove Gemini Live browser code and package**

Remove `GoogleGenAI`, `Modality`, manual PCM playback, and Gemini live-session refs only after OpenAI call tests pass. Then remove `@google/genai` from `web/package.json` and regenerate the lockfile.

- [ ] **Step 7: Test teardown and permission errors**

Mock `RTCPeerConnection` and `getUserMedia`. Assert that hang-up and unmount stop every track and close every connection. Assert microphone denial renders a retryable message without repeated automatic prompts.

- [ ] **Step 8: Run tests/build and commit**

Run: `cd web && npm test -- AiCallOverlay useOpenAIRealtime && npm run build`  
Expected: PASS.

```bash
git add api/main.py web/src/App.jsx web/src/features/calls web/package.json web/package-lock.json
git commit -m "feat: migrate AI calls to OpenAI Realtime"
```

### Task 12: Reskin Login, Settings, Friend Management, and Remaining Screens

**Files:**
- Modify: `web/src/App.jsx:631-1437` (login/session/settings state)
- Modify: `web/src/App.jsx:3435-4347` (login and dialogs)
- Create: `web/src/features/settings/SettingsDialog.jsx`
- Create: `web/src/features/settings/AiSettingsDialog.jsx`
- Create: `web/src/features/contacts/AddFriendDialog.jsx`
- Create: `web/src/features/contacts/EditContactDialog.jsx`
- Create: `web/src/styles/forms.css`
- Modify: `web/public/images/*` references only; do not delete user media fallbacks until unused

- [ ] **Step 1: Add tests for login and voice settings**

Assert the logged-out screen contains `Convia`, Google sign-in, no `Pisces`, and no simulated phone chrome. Assert AI settings lists approved OpenAI voices and contains an AI-voice disclosure.

- [ ] **Step 2: Extract and reskin dialogs**

Move existing validation and submit callbacks into props for shared Dialog-based components. Preserve friend verification code, alias, special prompt, relationship, history range, tester login, avatar upload, and image preview behavior.

- [ ] **Step 3: Replace voice controls**

Display OpenAI voice names, select `ai_openai_voice`, and add preview using a short fixed disclosure-safe phrase through the TTS endpoint. Do not present Gemini voice names as active choices.

- [ ] **Step 4: Remove purple and phone-frame styles**

Remove background image effects, Waterfall typography, simulated time/Bluetooth/battery controls, glass gradients, and bottom four-icon navigation. Ensure every remaining control uses the SVG library.

- [ ] **Step 5: Verify every user-visible path**

Cover logged out, tester login, add friend, edit AI, edit friend, settings, group manager, image viewer, AI chat, person chat, AI Assist, recording, and AI call.

- [ ] **Step 6: Run full frontend tests and build**

Run: `cd web && npm test && npm run build`  
Expected: all tests PASS and the bundle builds.

- [ ] **Step 7: Commit the full reskin**

```bash
git add web/src web/public web/index.html
git commit -m "feat: complete Convia dark interface redesign"
```

### Task 13: Remove Stale Provider Code and Update Documentation

**Files:**
- Modify: `api/main.py`
- Modify: `api/requirements.txt`
- Modify: `web/src/App.jsx`
- Modify: `web/package.json`
- Modify: `README.md`
- Modify: `api/test.py`

- [ ] **Step 1: Add a static provider-boundary test**

```python
def test_gemini_calls_are_limited_to_image_and_music():
    source = Path("main.py").read_text(encoding="utf-8")
    forbidden = ["generate_gemini_reply(", "Gemini Live", "SpeechClient("]
    for token in forbidden:
        assert token not in source
```

- [ ] **Step 2: Remove unused imports, constants, and helpers**

Remove Gemini chat/TTS/live constants, Google speech imports, obsolete token creation, manual PCM helpers, and frontend Live refs. Keep Gemini image and Lyria music functions and their required backend imports.

- [ ] **Step 3: Update README**

Document:

- Convia as the user-facing name.
- `OPENAI_KEY` with `OPENAI_API_KEY` fallback.
- Default OpenAI model environment overrides.
- Gemini/Lyria limited to image/music.
- `pytest -q` and `npm test` commands.
- Existing deployed URLs and internal service names unchanged.

- [ ] **Step 4: Update smoke test text**

Change `api/test.py` output from Pisces to Convia and make it import `app` or call a pure readiness helper so it checks more than a string.

- [ ] **Step 5: Run repository-wide stale-name/provider scans**

Run:

```bash
rg -n "Pisces|GoogleGenAI|Modality|SpeechClient|generate_gemini_reply|Gemini Live" web/src web/index.html api README.md
```

Expected: any remaining `Pisces` or `Gemini` match is either an approved internal compatibility identifier, an image/music provider path, or a migration comment with a clear reason.

- [ ] **Step 6: Run complete local verification**

Run:

```bash
cd api && pytest -q && python -m py_compile main.py contact_groups.py openai_service.py
cd ../web && npm test && npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit cleanup and docs**

```bash
git add api web README.md
git commit -m "chore: finalize Convia provider migration"
```

### Task 14: Visual QA, Live Deployment, and Production Verification

**Files:**
- Modify only files required by discovered defects.
- Do not commit `.superpowers/brainstorm/**`, local `api/config.json`, service-account keys, screenshots, or generated build directories.

- [ ] **Step 1: Start the local stack**

Run: `./dev.sh`  
Expected: Flask on `127.0.0.1:8080` and Vite on `127.0.0.1:5173`.

- [ ] **Step 2: Verify responsive layouts in the browser**

Check at least:

- 1440×900 desktop.
- 1024×768 tablet.
- 390×844 mobile.

Capture and inspect login, contact list, expanded/collapsed groups, person chat, AI chat, Group Manager, settings, and AI call overlay. Fix overflow, focus, contrast, and safe-area defects immediately and rerun the relevant test.

- [ ] **Step 3: Verify group and unread flows with two test users**

Create/rename/reorder/delete groups, move contacts, send messages in both directions, verify group totals, open the conversation to clear unread, and confirm reload/device-width changes preserve synchronized group data.

- [ ] **Step 4: Verify OpenAI paths without exposing the key**

Test visible streaming text, AI Assist advice, AI relay, recorded voice transcription, explicit TTS, AI-room Realtime call, contact-room private AI Assist call, microphone denial, and call hang-up. Inspect network responses to confirm only ephemeral Realtime secrets reach the browser.

- [ ] **Step 5: Verify Gemini/Lyria media paths**

Generate one image and one music response. Confirm no text or voice route invokes Gemini.

- [ ] **Step 6: Run the final clean verification gate**

Run:

```bash
git status --short
cd api && pytest -q && python -m py_compile main.py contact_groups.py openai_service.py
cd ../web && npm test && npm run build
```

Expected: only intentional tracked changes, all tests pass, and the build succeeds.

- [ ] **Step 7: Push the reviewed `main` branch to trigger existing deploy integrations**

Run:

```bash
git push origin main
```

Expected: push succeeds. The repository's existing Cloud Build configuration deploys the `pisces` Cloud Run service; the connected Vercel project deploys the frontend.

- [ ] **Step 8: Verify production endpoints**

Check:

- `https://pisces-315346868518.asia-east1.run.app/`
- `https://pisces-plum.vercel.app/`

Confirm the Cloud Run root/readiness response, the Convia title/login screen, authenticated group behavior, one text stream, and the correct call-button semantics. Do not expose or print secrets while inspecting logs.

- [ ] **Step 9: Commit any deployment-only fixes and repeat verification**

For each defect, add a focused regression test, implement the smallest fix, rerun the relevant suite, commit with a descriptive message, push, and recheck the live surface.

## Final Completion Checklist

- [ ] Every acceptance criterion in `docs/superpowers/specs/2026-07-15-convia-chatgpt-redesign-openai-migration-design.md` maps to a completed task above.
- [ ] No placeholder, temporary compatibility route, or deprecated Gemini text/voice path remains.
- [ ] No `.superpowers`, config, key, screenshot, `dist`, or `node_modules` artifact is committed.
- [ ] Backend tests, frontend tests, production build, local browser QA, and production verification all pass.
- [ ] Final handoff lists commits, deployed URLs, model defaults, test commands, and any explicitly deferred person-to-person call work.
