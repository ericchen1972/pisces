import json

import pytest

from shared_convia import (
    MAX_SHARED_HISTORY_JSON_CHARS,
    MAX_SHARED_HISTORY_TEXT_CHARS,
    parse_convia_invocation,
    select_shared_history,
)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Convia check weather", "check weather"),
        ("  convia, check weather", "check weather"),
        ("CONVIA：查一下", "查一下"),
        ("Convia，查一下", "查一下"),
        ("Convia", ""),
        (" \tConVia  ,：  do it  ", "do it"),
        ("hello Convia", None),
        ("Conviable is a word", None),
        ("Conviax", None),
        (None, None),
        (123, None),
    ],
)
def test_parse_convia_invocation(text, expected):
    assert parse_convia_invocation(text) == expected


def test_select_shared_history_keeps_newest_50_in_chronological_order():
    messages = [
        {
            "role": "user" if index % 2 == 0 else "peer",
            "text": f"m{index}",
            "visibility": "shared",
        }
        for index in range(55)
    ]
    messages.append(
        {"role": "ai_proxy", "text": "shared ai", "visibility": "shared"}
    )

    result = select_shared_history(
        messages,
        caller_name="Eric",
        contact_name="Judy",
    )

    assert len(result) == 50
    assert result[0] == {"speaker": "Eric", "text": "m6"}
    assert result[1] == {"speaker": "Judy", "text": "m7"}
    assert result[-1] == {"speaker": "Convia", "text": "shared ai"}


def test_select_shared_history_excludes_non_shared_and_malformed_records():
    messages = [
        {"role": "user", "text": "historical default"},
        {"role": "peer", "text": "private", "visibility": "private_to_user"},
        {"role": "peer", "text": "revoked", "visibility": "revoked"},
        {"role": "assist_user", "text": "old human", "visibility": "shared"},
        {"role": "assist_ai", "text": "old ai", "visibility": "shared"},
        {"role": "user", "text": "   ", "visibility": "shared"},
        {"text": "missing role", "visibility": "shared"},
        None,
        "not a message",
        {"role": "peer", "text": "visible", "visibility": "shared"},
    ]

    assert select_shared_history(messages, "Eric", "Judy") == [
        {"speaker": "Eric", "text": "historical default"},
        {"speaker": "Judy", "text": "visible"},
    ]


def test_select_shared_history_bounds_text_and_speaker_names():
    long_name = "N" * 300
    messages = [
        {"role": "user", "text": "x" * (MAX_SHARED_HISTORY_TEXT_CHARS + 25)},
        {"role": "peer", "text": "hello"},
    ]

    result = select_shared_history(messages, caller_name=long_name, contact_name=" ")

    assert result[0] == {
        "speaker": "N" * 256,
        "text": "x" * MAX_SHARED_HISTORY_TEXT_CHARS,
    }
    assert result[1] == {"speaker": "Contact", "text": "hello"}


def test_select_shared_history_uses_caller_fallback():
    result = select_shared_history(
        [{"role": "user", "text": "hello", "visibility": "shared"}],
        caller_name=None,
        contact_name="Judy",
    )

    assert result == [{"speaker": "User", "text": "hello"}]


def test_select_shared_history_drops_oldest_until_serialized_json_fits():
    messages = [
        {"role": "user", "text": str(index) + ("界" * 3999), "visibility": "shared"}
        for index in range(20)
    ]

    result = select_shared_history(messages, "Eric", "Judy")
    serialized = json.dumps(result, ensure_ascii=False, separators=(",", ":"))

    assert len(serialized) <= MAX_SHARED_HISTORY_JSON_CHARS
    assert len(result) < len(messages)
    assert result[-1]["text"].startswith("19")
    assert int(result[0]["text"].split("界", 1)[0]) > 0
