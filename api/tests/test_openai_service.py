import json
from dataclasses import FrozenInstanceError
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from openai import OpenAI

from openai_service import OpenAIModels, OpenAIService


class FakeResponse:
    def __init__(
        self,
        output_text=None,
        output=None,
        status=None,
        error=None,
        incomplete_details=None,
    ):
        self.output_text = output_text
        self.output = output or []
        if status is not None:
            self.status = status
        self.error = error
        self.incomplete_details = incomplete_details


class FakeStream:
    def __init__(self, events=None):
        self.events = events or [
            SimpleNamespace(type="response.created"),
            SimpleNamespace(type="response.output_text.delta", delta="Hello"),
            SimpleNamespace(type="response.output_text.delta", delta=" world"),
            SimpleNamespace(type="response.completed"),
        ]

    def __enter__(self):
        return iter(self.events)

    def __exit__(self, *_args):
        return False


class FakeResponses:
    def __init__(self):
        self.create_calls = []
        self.stream_calls = []
        self.outputs = []
        self.stream_events = None

    def create(self, **kwargs):
        self.create_calls.append(kwargs)
        return self.outputs.pop(0)

    def stream(self, **kwargs):
        self.stream_calls.append(kwargs)
        return FakeStream(self.stream_events)


class FakeCreate:
    def __init__(self, result):
        self.calls = []
        self.result = result

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.result


class FakeClient:
    def __init__(self, api_key="sk-super-secret"):
        self.api_key = api_key
        self.responses = FakeResponses()
        self.transcriptions = FakeCreate("transcript")
        self.speech = FakeCreate(b"RIFFwav")
        self.client_secrets = FakeCreate({"value": "ek_public-client-secret"})
        self.audio = SimpleNamespace(
            transcriptions=self.transcriptions,
            speech=self.speech,
        )
        self.realtime = SimpleNamespace(client_secrets=self.client_secrets)

    def __repr__(self):
        return f"FakeClient(api_key={self.api_key!r})"


def response_with_json(value):
    return FakeResponse(output_text=json.dumps(value))


def test_models_use_approved_defaults_and_environment_overrides(monkeypatch):
    for name in (
        "OPENAI_TEXT_MODEL",
        "OPENAI_ROUTER_MODEL",
        "OPENAI_REALTIME_MODEL",
        "OPENAI_TRANSCRIBE_MODEL",
        "OPENAI_TTS_MODEL",
    ):
        monkeypatch.delenv(name, raising=False)

    defaults = OpenAIModels.from_environment()
    assert defaults == OpenAIModels(
        text="gpt-5.6-terra",
        router="gpt-5.6-luna",
        realtime="gpt-realtime-2.1",
        transcription="gpt-4o-mini-transcribe",
        tts="gpt-4o-mini-tts",
    )
    monkeypatch.setenv("OPENAI_TEXT_MODEL", "text-override")
    monkeypatch.setenv("OPENAI_ROUTER_MODEL", "router-override")
    monkeypatch.setenv("OPENAI_REALTIME_MODEL", "realtime-override")
    monkeypatch.setenv("OPENAI_TRANSCRIBE_MODEL", "transcribe-override")
    monkeypatch.setenv("OPENAI_TTS_MODEL", "tts-override")
    assert OpenAIModels.from_environment() == OpenAIModels(
        text="text-override",
        router="router-override",
        realtime="realtime-override",
        transcription="transcribe-override",
        tts="tts-override",
    )

    with pytest.raises(FrozenInstanceError):
        defaults.text = "changed"


def test_safety_identifier_is_stable_hashed_and_bounded():
    service = OpenAIService(object(), "server-salt")

    first = service.safety_identifier("user-a")

    assert first == service.safety_identifier("user-a")
    assert first != service.safety_identifier("user-b")
    assert "user-a" not in first
    assert "server-salt" not in first
    assert len(first) == 64


@pytest.mark.parametrize("salt", ["", "   ", "\t\n"])
def test_service_rejects_empty_or_whitespace_safety_salt(salt):
    with pytest.raises(ValueError, match="safety_salt must not be empty"):
        OpenAIService(object(), salt)


@pytest.mark.parametrize("user_id", ["", "   ", "\t\n"])
def test_safety_identifier_rejects_empty_or_whitespace_user_id(user_id):
    service = OpenAIService(object(), "never-echo-this-salt")

    with pytest.raises(ValueError, match="user_id must not be empty") as error:
        service.safety_identifier(user_id)

    assert "never-echo-this-salt" not in str(error.value)


def test_router_methods_use_strict_responses_schemas_and_validate_results():
    client = FakeClient()
    client.responses.outputs = [
        response_with_json(
            {
                "should_read_aloud": True,
                "language": "zh-TW",
                "tone_prompt": "溫暖",
                "reason": "user asked",
            }
        ),
        response_with_json(
            {"send_to_friend": True, "voice": False, "reason": "direct request"}
        ),
        response_with_json({"draw_image": False, "create_music": True}),
        response_with_json(
            {"as_user": True, "message_to_friend": "Dinner at seven?"}
        ),
    ]
    service = OpenAIService(client, "server-salt")
    history = [{"role": "user", "content": "Earlier"}]

    chat = service.decide_chat_output(
        user_id="user-a",
        user_message="Read this aloud",
        global_prompt="Be kind",
        history_messages=history,
        extra_context_text="Context",
    )
    assist = service.decide_assist_action(
        user_id="user-a",
        user_message="Tell Amy",
        history_messages=history,
        friend_name="Amy",
    )
    media = service.decide_media_tools(
        user_id="user-a", user_message="Make music", history_messages=history
    )
    outbound = service.compose_message_for_friend(
        user_id="user-a",
        user_message="Ask about dinner",
        history_messages=history,
        user_name="Bo",
        friend_name="Amy",
        ai_name="Convia",
        style_prompt="casual",
        relationship="friends",
    )

    assert chat == {
        "should_read_aloud": True,
        "language": "zh-TW",
        "tone_prompt": "溫暖",
        "reason": "user asked",
    }
    assert assist == {
        "send_to_friend": True,
        "voice": False,
        "reason": "direct request",
    }
    assert media == {"draw_image": False, "create_music": True}
    assert outbound == {
        "as_user": True,
        "message_to_friend": "Dinner at seven?",
    }

    safety_id = service.safety_identifier("user-a")
    assert "user-a" not in safety_id
    assert client.responses.create_calls == [
        {
            "model": "gpt-5.6-luna",
            "instructions": (
                "Decide only routing and audio metadata for the user's message. "
                "Do not generate a visible reply; visible reply text is generated separately. "
                "Use this global behavior context only to inform the metadata: Be kind"
            ),
            "input": [
                {"role": "user", "content": "Earlier"},
                {"role": "developer", "content": "Context"},
                {"role": "user", "content": "Read this aloud"},
            ],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "chat_output_decision",
                    "strict": True,
                    "schema": {
                        "type": "object",
                        "properties": {
                            "should_read_aloud": {"type": "boolean"},
                            "language": {
                                "type": "string",
                                "enum": ["zh-TW", "en-US"],
                            },
                            "tone_prompt": {"type": "string"},
                            "reason": {"type": "string"},
                        },
                        "required": [
                            "should_read_aloud",
                            "language",
                            "tone_prompt",
                            "reason",
                        ],
                        "additionalProperties": False,
                    },
                }
            },
            "store": False,
            "safety_identifier": safety_id,
        },
        {
            "model": "gpt-5.6-luna",
            "instructions": (
                "Decide only whether to send a message or voice artifact to Amy. "
                "Do not generate reply_to_user or any visible reply; visible text is generated separately."
            ),
            "input": [
                {"role": "user", "content": "Earlier"},
                {"role": "user", "content": "Tell Amy"},
            ],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "assist_action_decision",
                    "strict": True,
                    "schema": {
                        "type": "object",
                        "properties": {
                            "send_to_friend": {"type": "boolean"},
                            "voice": {"type": "boolean"},
                            "reason": {"type": "string"},
                        },
                        "required": ["send_to_friend", "voice", "reason"],
                        "additionalProperties": False,
                    },
                }
            },
            "store": False,
            "safety_identifier": safety_id,
        },
        {
            "model": "gpt-5.6-luna",
            "instructions": "Decide which media tools the user's request explicitly needs.",
            "input": [
                {"role": "user", "content": "Earlier"},
                {"role": "user", "content": "Make music"},
            ],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "media_tool_decision",
                    "strict": True,
                    "schema": {
                        "type": "object",
                        "properties": {
                            "draw_image": {"type": "boolean"},
                            "create_music": {"type": "boolean"},
                        },
                        "required": ["draw_image", "create_music"],
                        "additionalProperties": False,
                    },
                }
            },
            "store": False,
            "safety_identifier": safety_id,
        },
        {
            "model": "gpt-5.6-luna",
            "instructions": (
                "Compose an outbound message from Convia to Amy, relaying Bo's intent. "
                "Relationship: friends. Style: casual. "
                "Convia is a third-party messenger, not Bo. "
                "By default, set as_user=false and write message_to_friend in third person: say that Bo says, asks, feels, wants, or is wondering. "
                "When as_user=false, do not write as if Convia or the speaker is Bo; avoid first-person phrasing such as 我, 我們, 我的, I, we, my, or our for Bo's plans, feelings, promises, or offers. "
                "Only set as_user=true if the requester explicitly asks to send in Bo's own voice. "
                "You may soften conflict or make wording warmer, but do not change the core meaning. "
                "This is the outbound structured artifact, separate from the visible AI reply."
            ),
            "input": [
                {"role": "user", "content": "Earlier"},
                {"role": "user", "content": "Ask about dinner"},
            ],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "friend_message",
                    "strict": True,
                    "schema": {
                        "type": "object",
                        "properties": {
                            "as_user": {"type": "boolean"},
                            "message_to_friend": {
                                "type": "string",
                                "minLength": 1,
                            },
                        },
                        "required": ["as_user", "message_to_friend"],
                        "additionalProperties": False,
                    },
                }
            },
            "store": False,
            "safety_identifier": safety_id,
        },
    ]

    chat_schema = client.responses.create_calls[0]["text"]["format"]["schema"]
    assist_schema = client.responses.create_calls[1]["text"]["format"]["schema"]
    assert all("reply" not in field for field in chat_schema["properties"])
    assert "reply_to_user" not in assist_schema["properties"]
    assert "do not generate a visible reply" in client.responses.create_calls[0][
        "instructions"
    ].lower()
    friend_instructions = client.responses.create_calls[3]["instructions"]
    assert "third-party messenger" in friend_instructions
    assert "write message_to_friend in third person" in friend_instructions
    assert "avoid first-person phrasing" in friend_instructions
    assert "Only set as_user=true if the requester explicitly asks" in friend_instructions


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ({"draw_image": True}, "missing required field 'create_music'"),
        (
            {"draw_image": "yes", "create_music": False},
            "field 'draw_image' must be a boolean",
        ),
    ],
)
def test_router_validation_rejects_missing_and_wrong_types(payload, message):
    client = FakeClient()
    client.responses.outputs = [response_with_json(payload)]
    service = OpenAIService(client, "salt")

    with pytest.raises(ValueError, match=message):
        service.decide_media_tools(
            user_id="u", user_message="anything", history_messages=[]
        )


def test_router_validation_rejects_bad_enum_empty_message_and_invalid_json():
    client = FakeClient()
    client.responses.outputs = [
        response_with_json(
            {
                "should_read_aloud": False,
                "language": "fr-FR",
                "tone_prompt": "neutral",
                "reason": "test",
            }
        ),
        response_with_json({"as_user": False, "message_to_friend": "   "}),
        FakeResponse(output_text="not json"),
    ]
    service = OpenAIService(client, "salt")

    with pytest.raises(ValueError, match="field 'language' must be one of"):
        service.decide_chat_output("u", "hi", "prompt", [])
    with pytest.raises(ValueError, match="field 'message_to_friend' must not be empty"):
        service.compose_message_for_friend("u", "hi", [], "U", "F", "AI", "style")
    with pytest.raises(RuntimeError, match="invalid JSON"):
        service.decide_media_tools("u", "hi", [])


def test_router_extracts_json_from_nested_response_output():
    content = SimpleNamespace(type="output_text", text='{"draw_image":true,"create_music":false}')
    message = SimpleNamespace(type="message", content=[content])
    client = FakeClient()
    client.responses.outputs = [FakeResponse(output_text=None, output=[message])]

    result = OpenAIService(client, "salt").decide_media_tools("u", "draw", [])

    assert result == {"draw_image": True, "create_music": False}


@pytest.mark.parametrize(
    ("response", "message"),
    [
        (
            FakeResponse(
                output_text='{"draw_image":true,"create_music":false}',
                status="incomplete",
                incomplete_details=SimpleNamespace(reason="max_output_tokens"),
            ),
            r"OpenAI response incomplete \(reason: max_output_tokens\)",
        ),
        (
            FakeResponse(
                output_text='{"draw_image":true,"create_music":false}',
                status="failed",
                error=SimpleNamespace(code="server_error", message="sk-never-leak"),
            ),
            r"OpenAI response failed \(code: server_error\)",
        ),
        (
            FakeResponse(
                output_text='{"draw_image":true,"create_music":false}',
                status="failed",
                error=SimpleNamespace(code="invalid_prompt", message="do not echo"),
            ),
            r"OpenAI response failed \(code: invalid_prompt\)",
        ),
    ],
)
def test_router_rejects_non_completed_status_even_with_valid_json(response, message):
    client = FakeClient()
    client.responses.outputs = [response]

    with pytest.raises(RuntimeError, match=message) as error:
        OpenAIService(client, "salt").decide_media_tools("u", "draw", [])

    assert "sk-never-leak" not in str(error.value)


def test_router_reports_refusal_content_explicitly_without_echoing_it():
    refusal = SimpleNamespace(type="refusal", refusal="sk-sensitive-provider-refusal")
    message = SimpleNamespace(type="message", content=[refusal])
    client = FakeClient()
    client.responses.outputs = [
        FakeResponse(output_text=None, output=[message], status="completed")
    ]

    with pytest.raises(RuntimeError, match="^OpenAI refused the request$") as error:
        OpenAIService(client, "salt").decide_media_tools("u", "draw", [])

    assert "sk-sensitive-provider-refusal" not in str(error.value)


def test_stream_text_yields_only_output_text_deltas_with_exact_payload():
    client = FakeClient()
    service = OpenAIService(client, "salt")
    input_items = [{"role": "user", "content": "Hi"}]

    assert list(
        service.stream_text(
            user_id="user-a", instructions="Be concise", input_items=input_items
        )
    ) == ["Hello", " world"]
    assert client.responses.stream_calls == [
        {
            "model": "gpt-5.6-terra",
            "instructions": "Be concise",
            "input": input_items,
            "store": False,
            "safety_identifier": service.safety_identifier("user-a"),
            "reasoning": {"effort": "low"},
        }
    ]


def test_stream_text_raises_when_iterator_ends_without_completed_event():
    client = FakeClient()
    client.responses.stream_events = [
        SimpleNamespace(type="response.created"),
        SimpleNamespace(type="response.output_text.delta", delta="partial"),
    ]
    stream = OpenAIService(client, "salt").stream_text(
        user_id="u", instructions="Answer", input_items=[]
    )

    assert next(stream) == "partial"
    with pytest.raises(
        RuntimeError, match="^OpenAI stream ended before completion$"
    ):
        next(stream)


@pytest.mark.parametrize(
    ("terminal_event", "message"),
    [
        (
            SimpleNamespace(
                type="response.failed",
                response=FakeResponse(
                    status="failed",
                    error=SimpleNamespace(code="server_error", message="sk-never-leak"),
                ),
            ),
            r"OpenAI response failed \(code: server_error\)",
        ),
        (
            SimpleNamespace(
                type="response.incomplete",
                response=FakeResponse(
                    status="incomplete",
                    incomplete_details=SimpleNamespace(reason="max_output_tokens"),
                ),
            ),
            r"OpenAI response incomplete \(reason: max_output_tokens\)",
        ),
    ],
)
def test_stream_text_yields_prior_delta_then_raises_for_terminal_state(
    terminal_event, message
):
    client = FakeClient()
    client.responses.stream_events = [
        SimpleNamespace(type="response.output_text.delta", delta="partial"),
        terminal_event,
    ]
    stream = OpenAIService(client, "salt").stream_text(
        user_id="u", instructions="Answer", input_items=[]
    )

    assert next(stream) == "partial"
    with pytest.raises(RuntimeError, match=message) as error:
        next(stream)

    assert "sk-never-leak" not in str(error.value)


def test_stream_text_yields_prior_delta_then_raises_for_top_level_error():
    client = FakeClient()
    client.responses.stream_events = [
        SimpleNamespace(type="response.output_text.delta", delta="partial"),
        SimpleNamespace(
            type="error",
            code="server_error",
            message="sk-never-leak",
        ),
    ]
    stream = OpenAIService(client, "salt").stream_text(
        user_id="u", instructions="Answer", input_items=[]
    )

    assert next(stream) == "partial"
    with pytest.raises(
        RuntimeError, match=r"OpenAI response failed \(code: server_error\)"
    ) as error:
        next(stream)

    assert "sk-never-leak" not in str(error.value)


@pytest.mark.parametrize("event_type", ["response.refusal.delta", "response.refusal.done"])
def test_stream_text_raises_for_refusal_events_after_prior_delta(event_type):
    client = FakeClient()
    client.responses.stream_events = [
        SimpleNamespace(type="response.output_text.delta", delta="partial"),
        SimpleNamespace(type=event_type, delta="sk-sensitive-refusal"),
    ]
    stream = OpenAIService(client, "salt").stream_text(
        user_id="u", instructions="Answer", input_items=[]
    )

    assert next(stream) == "partial"
    with pytest.raises(RuntimeError, match="^OpenAI refused the request$") as error:
        next(stream)

    assert "sk-sensitive-refusal" not in str(error.value)


def test_stream_text_validates_completed_response_and_rejects_embedded_refusal():
    refusal = SimpleNamespace(type="refusal", refusal="sk-sensitive-refusal")
    completed_response = FakeResponse(
        output=[SimpleNamespace(type="message", content=[refusal])],
        status="completed",
    )
    client = FakeClient()
    client.responses.stream_events = [
        SimpleNamespace(type="response.output_text.delta", delta="partial"),
        SimpleNamespace(type="response.completed", response=completed_response),
    ]
    stream = OpenAIService(client, "salt").stream_text(
        user_id="u", instructions="Answer", input_items=[]
    )

    assert next(stream) == "partial"
    with pytest.raises(RuntimeError, match="^OpenAI refused the request$") as error:
        next(stream)

    assert "sk-sensitive-refusal" not in str(error.value)


def test_generate_text_strips_output_and_rejects_empty_response():
    client = FakeClient()
    client.responses.outputs = [FakeResponse(output_text="  Hello there  "), FakeResponse(output_text="  ")]
    service = OpenAIService(client, "salt")
    input_items = [{"role": "user", "content": "Hi"}]

    assert service.generate_text(
        user_id="u", instructions="Answer", input_items=input_items
    ) == "Hello there"
    with pytest.raises(RuntimeError, match="^OpenAI returned an empty response$"):
        service.generate_text(user_id="u", instructions="Answer", input_items=input_items)
    assert client.responses.create_calls[0] == {
        "model": "gpt-5.6-terra",
        "instructions": "Answer",
        "input": input_items,
        "store": False,
        "safety_identifier": service.safety_identifier("u"),
        "reasoning": {"effort": "low"},
    }


@pytest.mark.parametrize(
    ("response", "message"),
    [
        (
            FakeResponse(
                output_text="plausible partial text",
                status="incomplete",
                incomplete_details=SimpleNamespace(reason="max_output_tokens"),
            ),
            r"OpenAI response incomplete \(reason: max_output_tokens\)",
        ),
        (
            FakeResponse(
                output_text="plausible failed text",
                status="failed",
                error=SimpleNamespace(code="server_error", message="sk-never-leak"),
            ),
            r"OpenAI response failed \(code: server_error\)",
        ),
    ],
)
def test_generate_text_rejects_incomplete_and_failed_responses(response, message):
    client = FakeClient()
    client.responses.outputs = [response]

    with pytest.raises(RuntimeError, match=message) as error:
        OpenAIService(client, "salt").generate_text(
            user_id="u", instructions="Answer", input_items=[]
        )

    assert "sk-never-leak" not in str(error.value)


def test_audio_methods_send_exact_payloads():
    client = FakeClient()
    service = OpenAIService(client, "salt")
    audio_file = object()

    assert service.transcribe(audio_file=audio_file, prompt="") == "transcript"
    assert client.transcriptions.calls == [
        {
            "model": "gpt-4o-mini-transcribe",
            "file": audio_file,
            "prompt": None,
            "response_format": "text",
        }
    ]
    assert service.synthesize(
        text="Hello", voice="alloy", instructions="Warm and calm"
    ) == b"RIFFwav"
    assert client.speech.calls == [
        {
            "model": "gpt-4o-mini-tts",
            "voice": "alloy",
            "input": "Hello",
            "instructions": "Warm and calm",
            "response_format": "wav",
        }
    ]


def test_realtime_uses_typed_client_with_exact_session_and_safety_header():
    client = FakeClient()
    service = OpenAIService(client, "server-salt")

    result = service.create_realtime_client_secret(
        user_id="user-a", instructions="Be friendly", voice="marin", mode="ai"
    )

    assert result == {"value": "ek_public-client-secret"}
    assert client.client_secrets.calls == [
        {
            "expires_after": {"anchor": "created_at", "seconds": 600},
            "session": {
                "type": "realtime",
                "model": "gpt-realtime-2.1",
                "instructions": "Be friendly",
                "reasoning": {"effort": "low"},
                "audio": {
                    "input": {
                        "transcription": {"model": "gpt-4o-mini-transcribe"},
                        "turn_detection": {
                            "type": "server_vad",
                            "create_response": False,
                        },
                    },
                    "output": {"voice": "marin"},
                },
                "max_output_tokens": 2048,
            },
            "extra_headers": {
                "OpenAI-Safety-Identifier": service.safety_identifier("user-a")
            },
        }
    ]


def test_realtime_assist_keeps_automatic_server_vad_responses():
    client = FakeClient()
    service = OpenAIService(client, "server-salt")

    service.create_realtime_client_secret(
        user_id="user-a", instructions="Private assist", voice="marin", mode="assist"
    )

    assert client.client_secrets.calls[0]["session"]["audio"]["input"] == {
        "transcription": {"model": "gpt-4o-mini-transcribe"},
        "turn_detection": {
            "type": "server_vad",
            "create_response": True,
        },
    }


def test_realtime_falls_back_to_raw_post_when_typed_resource_is_absent():
    class FallbackClient:
        def __init__(self):
            self.calls = []

        def post(self, path, **kwargs):
            self.calls.append((path, kwargs))
            return {"value": "ek_fallback"}

    client = FallbackClient()
    service = OpenAIService(client, "salt")

    assert service.create_realtime_client_secret(
        user_id="u", instructions="Help", voice="alloy", mode="ai"
    ) == {"value": "ek_fallback"}
    assert client.calls == [
        (
            "/realtime/client_secrets",
            {
                "body": {
                    "expires_after": {"anchor": "created_at", "seconds": 600},
                    "session": {
                        "type": "realtime",
                        "model": "gpt-realtime-2.1",
                        "instructions": "Help",
                        "reasoning": {"effort": "low"},
                        "audio": {
                            "input": {
                                "transcription": {"model": "gpt-4o-mini-transcribe"},
                                "turn_detection": {
                                    "type": "server_vad",
                                    "create_response": False,
                                },
                            },
                            "output": {"voice": "alloy"},
                        },
                        "max_output_tokens": 2048,
                    }
                },
                "cast_to": dict[str, Any],
                "options": {
                    "headers": {
                        "OpenAI-Safety-Identifier": service.safety_identifier("u")
                    }
                },
            },
        )
    ]


def test_realtime_falls_back_when_typed_create_signature_is_incompatible():
    class IncompatibleClientSecrets:
        def __init__(self):
            self.calls = []

        def create(self, *, session, extra_headers):
            self.calls.append((session, extra_headers))
            raise AssertionError("incompatible typed method must not be called")

    class IncompatibleTypedClient:
        def __init__(self):
            self.client_secrets = IncompatibleClientSecrets()
            self.realtime = SimpleNamespace(client_secrets=self.client_secrets)
            self.post_calls = []

        def post(self, path, **kwargs):
            self.post_calls.append((path, kwargs))
            return {"value": "ek_incompatible_fallback"}

    client = IncompatibleTypedClient()
    service = OpenAIService(client, "salt")

    assert service.create_realtime_client_secret(
        user_id="u", instructions="Help", voice="alloy", mode="ai"
    ) == {"value": "ek_incompatible_fallback"}
    assert client.client_secrets.calls == []
    assert client.post_calls == [
        (
            "/realtime/client_secrets",
            {
                "body": {
                    "expires_after": {"anchor": "created_at", "seconds": 600},
                    "session": {
                        "type": "realtime",
                        "model": "gpt-realtime-2.1",
                        "instructions": "Help",
                        "reasoning": {"effort": "low"},
                        "audio": {
                            "input": {
                                "transcription": {"model": "gpt-4o-mini-transcribe"},
                                "turn_detection": {
                                    "type": "server_vad",
                                    "create_response": False,
                                },
                            },
                            "output": {"voice": "alloy"},
                        },
                        "max_output_tokens": 2048,
                    }
                },
                "cast_to": dict[str, Any],
                "options": {
                    "headers": {
                        "OpenAI-Safety-Identifier": service.safety_identifier("u")
                    }
                },
            },
        )
    ]


def test_realtime_real_sdk_serializes_expiry_and_bounded_session_exactly():
    captured = {}

    def handler(request):
        captured["path"] = request.url.path
        captured["body"] = json.loads(request.content)
        captured["safety_identifier"] = request.headers.get(
            "OpenAI-Safety-Identifier"
        )
        return httpx.Response(
            200,
            json={
                "value": "ek_test",
                "expires_at": 1,
                "session": {"type": "realtime"},
            },
        )

    client = OpenAI(
        api_key="sk-test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    service = OpenAIService(client, "salt")

    result = service.create_realtime_client_secret(
        user_id="u", instructions="Help", voice="marin", mode="ai"
    )

    assert result.value == "ek_test"
    assert captured == {
        "path": "/v1/realtime/client_secrets",
        "body": {
            "expires_after": {"anchor": "created_at", "seconds": 600},
            "session": {
                "type": "realtime",
                "model": "gpt-realtime-2.1",
                "instructions": "Help",
                "reasoning": {"effort": "low"},
                "audio": {
                    "input": {
                        "transcription": {"model": "gpt-4o-mini-transcribe"},
                        "turn_detection": {
                            "type": "server_vad",
                            "create_response": False,
                        },
                    },
                    "output": {"voice": "marin"},
                },
                "max_output_tokens": 2048,
            },
        },
        "safety_identifier": service.safety_identifier("u"),
    }


def test_realtime_real_sdk_raw_post_returns_dict_and_sends_safety_header():
    captured = {}

    def handler(request):
        captured["path"] = request.url.path
        captured["body"] = json.loads(request.content)
        captured["safety_identifier"] = request.headers.get(
            "OpenAI-Safety-Identifier"
        )
        return httpx.Response(
            200,
            json={"value": "ek_raw", "expires_at": 12345},
        )

    sdk_client = OpenAI(
        api_key="sk-test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    class RawSDKClient:
        def __init__(self, client):
            self.post = client.post

    service = OpenAIService(RawSDKClient(sdk_client), "salt")

    result = service.create_realtime_client_secret(
        user_id="u", instructions="Help", voice="marin", mode="ai"
    )

    assert result == {"value": "ek_raw", "expires_at": 12345}
    assert captured == {
        "path": "/v1/realtime/client_secrets",
        "body": {
            "expires_after": {"anchor": "created_at", "seconds": 600},
            "session": {
                "type": "realtime",
                "model": "gpt-realtime-2.1",
                "instructions": "Help",
                "reasoning": {"effort": "low"},
                "audio": {
                    "input": {
                        "transcription": {"model": "gpt-4o-mini-transcribe"},
                        "turn_detection": {
                            "type": "server_vad",
                            "create_response": False,
                        },
                    },
                    "output": {"voice": "marin"},
                },
                "max_output_tokens": 2048,
            },
        },
        "safety_identifier": service.safety_identifier("u"),
    }


def test_service_repr_and_results_do_not_expose_api_key_or_salt():
    api_key = "sk-never-print-this"
    salt = "never-print-this-salt"
    client = FakeClient(api_key=api_key)
    service = OpenAIService(client, salt)

    result = service.create_realtime_client_secret(
        user_id="u", instructions="Help", voice="alloy", mode="ai"
    )
    exposed_text = repr(service) + repr(result) + str(result)

    assert api_key not in exposed_text
    assert salt not in exposed_text
