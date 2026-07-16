"""Pure helpers for shared Convia invocations and conversation context."""

import json
import re


CONVIA_PREFIX = re.compile(
    r"^\s*convia(?=$|[\s,:，：])(?:[\s,:，：]+)?",
    re.IGNORECASE,
)

MAX_SHARED_HISTORY_MESSAGES = 50
MAX_SHARED_HISTORY_TEXT_CHARS = 4000
MAX_SHARED_HISTORY_JSON_CHARS = 60000
MAX_SHARED_SPEAKER_NAME_CHARS = 256
SHARED_ROLES = {"user", "peer", "ai_proxy"}


def parse_convia_invocation(text):
    if not isinstance(text, str):
        return None
    match = CONVIA_PREFIX.match(text)
    if not match:
        return None
    return text[match.end() :].strip()


def _bounded_speaker_name(value, fallback):
    if not isinstance(value, str):
        return fallback
    return value.strip()[:MAX_SHARED_SPEAKER_NAME_CHARS] or fallback


def select_shared_history(messages, caller_name, contact_name):
    caller_speaker = _bounded_speaker_name(caller_name, "User")
    contact_speaker = _bounded_speaker_name(contact_name, "Contact")
    speakers = {
        "user": caller_speaker,
        "peer": contact_speaker,
        "ai_proxy": "Convia",
    }

    selected = []
    for message in messages or []:
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        visibility = message.get("visibility", "shared")
        text = message.get("text")
        if (
            role not in SHARED_ROLES
            or visibility != "shared"
            or not isinstance(text, str)
        ):
            continue
        text = text.strip()[:MAX_SHARED_HISTORY_TEXT_CHARS]
        if not text:
            continue
        selected.append({"speaker": speakers[role], "text": text})

    selected = selected[-MAX_SHARED_HISTORY_MESSAGES:]
    while selected and len(
        json.dumps(selected, ensure_ascii=False, separators=(",", ":"))
    ) > MAX_SHARED_HISTORY_JSON_CHARS:
        selected.pop(0)
    return selected
