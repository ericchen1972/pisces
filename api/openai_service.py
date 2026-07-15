"""Narrow, testable wrapper around the OpenAI APIs used by Convia."""

from __future__ import annotations

import hashlib
import inspect
import json
import os
import re
from dataclasses import dataclass
from typing import Any, Iterable, Iterator, Mapping


@dataclass(frozen=True)
class OpenAIModels:
    text: str = "gpt-5.6-terra"
    router: str = "gpt-5.6-luna"
    realtime: str = "gpt-realtime-2.1"
    transcription: str = "gpt-4o-mini-transcribe"
    tts: str = "gpt-4o-mini-tts"

    @classmethod
    def from_environment(cls) -> "OpenAIModels":
        return cls(
            text=os.getenv("OPENAI_TEXT_MODEL", cls.text),
            router=os.getenv("OPENAI_ROUTER_MODEL", cls.router),
            realtime=os.getenv("OPENAI_REALTIME_MODEL", cls.realtime),
            transcription=os.getenv("OPENAI_TRANSCRIBE_MODEL", cls.transcription),
            tts=os.getenv("OPENAI_TTS_MODEL", cls.tts),
        )


class OpenAIService:
    def __init__(
        self,
        client: Any,
        safety_salt: str,
        models: OpenAIModels | None = None,
    ) -> None:
        if not isinstance(safety_salt, str) or not safety_salt.strip():
            raise ValueError("safety_salt must not be empty")
        self._client = client
        self._safety_salt = safety_salt
        self.models = models or OpenAIModels.from_environment()

    def __repr__(self) -> str:
        return f"{type(self).__name__}(models={self.models!r})"

    def safety_identifier(self, user_id: str) -> str:
        if not isinstance(user_id, str) or not user_id.strip():
            raise ValueError("user_id must not be empty")
        raw_identifier = f"{self._safety_salt}:{user_id}".encode("utf-8")
        return hashlib.sha256(raw_identifier).hexdigest()

    def decide_chat_output(
        self,
        user_id: str,
        user_message: str,
        global_prompt: str,
        history_messages: Iterable[Mapping[str, Any]],
        extra_context_text: str = "",
    ) -> dict[str, Any]:
        properties = {
            "should_read_aloud": {"type": "boolean"},
            "language": {"type": "string", "enum": ["zh-TW", "en-US"]},
            "tone_prompt": {"type": "string"},
            "reason": {"type": "string"},
        }
        instructions = (
            "Decide only routing and audio metadata for the user's message. "
            "Do not generate a visible reply; visible reply text is generated separately. "
            f"Use this global behavior context only to inform the metadata: {global_prompt}"
        )
        input_items = self._router_input(
            history_messages,
            user_message,
            extra_context_text=extra_context_text,
        )
        result = self._structured_decision(
            user_id=user_id,
            name="chat_output_decision",
            instructions=instructions,
            input_items=input_items,
            properties=properties,
        )
        return self._validate_object(
            result,
            {
                "should_read_aloud": bool,
                "language": str,
                "tone_prompt": str,
                "reason": str,
            },
            enums={"language": {"zh-TW", "en-US"}},
        )

    def decide_assist_action(
        self,
        user_id: str,
        user_message: str,
        history_messages: Iterable[Mapping[str, Any]],
        friend_name: str,
    ) -> dict[str, Any]:
        properties = {
            "send_to_friend": {"type": "boolean"},
            "voice": {"type": "boolean"},
            "reason": {"type": "string"},
        }
        return self._validate_object(
            self._structured_decision(
                user_id=user_id,
                name="assist_action_decision",
                instructions=(
                    f"Decide only whether to send a message or voice artifact to {friend_name}. "
                    "Do not generate reply_to_user or any visible reply; visible text is generated separately."
                ),
                input_items=self._router_input(history_messages, user_message),
                properties=properties,
            ),
            {"send_to_friend": bool, "voice": bool, "reason": str},
        )

    def decide_media_tools(
        self,
        user_id: str,
        user_message: str,
        history_messages: Iterable[Mapping[str, Any]],
    ) -> dict[str, Any]:
        properties = {
            "draw_image": {"type": "boolean"},
            "create_music": {"type": "boolean"},
        }
        return self._validate_object(
            self._structured_decision(
                user_id=user_id,
                name="media_tool_decision",
                instructions="Decide which media tools the user's request explicitly needs.",
                input_items=self._router_input(history_messages, user_message),
                properties=properties,
            ),
            {"draw_image": bool, "create_music": bool},
        )

    def compose_message_for_friend(
        self,
        user_id: str,
        user_message: str,
        history_messages: Iterable[Mapping[str, Any]],
        user_name: str,
        friend_name: str,
        ai_name: str,
        style_prompt: str,
        relationship: str = "",
    ) -> dict[str, Any]:
        properties = {
            "as_user": {"type": "boolean"},
            "message_to_friend": {"type": "string", "minLength": 1},
        }
        relationship_context = relationship or "not specified"
        result = self._structured_decision(
            user_id=user_id,
            name="friend_message",
            instructions=(
                f"Compose an outbound message from {user_name} or {ai_name} to {friend_name}. "
                f"Relationship: {relationship_context}. Style: {style_prompt}. "
                "This is the outbound structured artifact, separate from the visible AI reply."
            ),
            input_items=self._router_input(history_messages, user_message),
            properties=properties,
        )
        validated = self._validate_object(
            result,
            {"as_user": bool, "message_to_friend": str},
            nonempty={"message_to_friend"},
        )
        validated["message_to_friend"] = validated["message_to_friend"].strip()
        return validated

    def stream_text(
        self,
        *,
        user_id: str,
        instructions: str,
        input_items: Any,
    ) -> Iterator[str]:
        saw_completed = False
        with self._client.responses.stream(
            model=self.models.text,
            instructions=instructions,
            input=input_items,
            store=False,
            safety_identifier=self.safety_identifier(user_id),
            reasoning={"effort": "low"},
        ) as stream:
            for event in stream:
                event_type = getattr(event, "type", None)
                if event_type == "response.output_text.delta":
                    yield event.delta
                elif event_type == "response.failed":
                    self._validate_response_state(
                        getattr(event, "response", event), status_hint="failed"
                    )
                elif event_type == "response.incomplete":
                    self._validate_response_state(
                        getattr(event, "response", event), status_hint="incomplete"
                    )
                elif event_type == "error":
                    self._validate_response_state(event, status_hint="failed")
                elif event_type in {
                    "response.refusal.delta",
                    "response.refusal.done",
                }:
                    raise RuntimeError("OpenAI refused the request")
                elif event_type == "response.completed":
                    completed_response = getattr(event, "response", event)
                    self._validate_response_state(
                        completed_response, status_hint="completed"
                    )
                    if self._has_refusal(completed_response):
                        raise RuntimeError("OpenAI refused the request")
                    saw_completed = True
        if not saw_completed:
            raise RuntimeError("OpenAI stream ended before completion")

    def generate_text(
        self,
        *,
        user_id: str,
        instructions: str,
        input_items: Any,
    ) -> str:
        response = self._client.responses.create(
            model=self.models.text,
            instructions=instructions,
            input=input_items,
            store=False,
            safety_identifier=self.safety_identifier(user_id),
            reasoning={"effort": "low"},
        )
        self._validate_response_state(response)
        if self._has_refusal(response):
            raise RuntimeError("OpenAI refused the request")
        text = str(getattr(response, "output_text", "") or "").strip()
        if not text:
            raise RuntimeError("OpenAI returned an empty response")
        return text

    def transcribe(self, *, audio_file: Any, prompt: str = "") -> Any:
        return self._client.audio.transcriptions.create(
            model=self.models.transcription,
            file=audio_file,
            prompt=prompt or None,
            response_format="text",
        )

    def synthesize(
        self,
        *,
        text: str,
        voice: str,
        instructions: str,
    ) -> Any:
        return self._client.audio.speech.create(
            model=self.models.tts,
            voice=voice,
            input=text,
            instructions=instructions,
            response_format="wav",
        )

    def create_realtime_client_secret(
        self,
        *,
        user_id: str,
        instructions: str,
        voice: str,
        mode: str,
    ) -> Any:
        if mode not in {"ai", "assist"}:
            raise ValueError("Realtime mode must be ai or assist")
        session = {
            "type": "realtime",
            "model": self.models.realtime,
            "instructions": instructions,
            "reasoning": {"effort": "low"},
            "audio": {
                "input": {
                    "transcription": {"model": self.models.transcription},
                    "turn_detection": {
                        "type": "server_vad",
                        "create_response": mode != "ai",
                    },
                },
                "output": {"voice": voice},
            },
            "max_output_tokens": 2048,
        }
        expires_after = {"anchor": "created_at", "seconds": 600}
        headers = {"OpenAI-Safety-Identifier": self.safety_identifier(user_id)}
        typed_create = self._typed_realtime_create()
        if typed_create is not None:
            return typed_create(
                expires_after=expires_after,
                session=session,
                extra_headers=headers,
            )
        return self._client.post(
            "/realtime/client_secrets",
            body={"expires_after": expires_after, "session": session},
            cast_to=dict[str, Any],
            options={"headers": headers},
        )

    def _structured_decision(
        self,
        *,
        user_id: str,
        name: str,
        instructions: str,
        input_items: Any,
        properties: dict[str, Any],
    ) -> dict[str, Any]:
        schema = {
            "type": "object",
            "properties": properties,
            "required": list(properties),
            "additionalProperties": False,
        }
        response = self._client.responses.create(
            model=self.models.router,
            instructions=instructions,
            input=input_items,
            text={
                "format": {
                    "type": "json_schema",
                    "name": name,
                    "strict": True,
                    "schema": schema,
                }
            },
            store=False,
            safety_identifier=self.safety_identifier(user_id),
        )
        return self._parse_response_json(response)

    @staticmethod
    def _router_input(
        history_messages: Iterable[Mapping[str, Any]],
        user_message: str,
        *,
        extra_context_text: str = "",
    ) -> list[dict[str, Any]]:
        input_items = [dict(message) for message in history_messages]
        if extra_context_text:
            input_items.append({"role": "developer", "content": extra_context_text})
        input_items.append({"role": "user", "content": user_message})
        return input_items

    @classmethod
    def _parse_response_json(cls, response: Any) -> dict[str, Any]:
        cls._validate_response_state(response)
        if cls._has_refusal(response):
            raise RuntimeError("OpenAI refused the request")
        output_text = getattr(response, "output_text", None)
        if not output_text:
            output_text = cls._nested_output_text(getattr(response, "output", None))
        if not isinstance(output_text, str) or not output_text.strip():
            raise RuntimeError("OpenAI returned no structured output text")
        try:
            parsed = json.loads(output_text)
        except json.JSONDecodeError as error:
            raise RuntimeError(f"OpenAI returned invalid JSON: {error.msg}") from error
        if not isinstance(parsed, dict):
            raise ValueError("OpenAI structured output must be a JSON object")
        return parsed

    @classmethod
    def _validate_response_state(
        cls,
        response: Any,
        *,
        status_hint: str | None = None,
    ) -> None:
        status = cls._field(response, "status") or status_hint
        if status is None or status == "completed":
            return
        if status == "failed":
            error = cls._field(response, "error")
            code = cls._safe_reason(
                cls._field(error, "code") or cls._field(response, "code")
            )
            suffix = f" (code: {code})" if code else ""
            raise RuntimeError(f"OpenAI response failed{suffix}")
        if status == "incomplete":
            reason = cls._safe_reason(
                cls._field(
                    cls._field(response, "incomplete_details"),
                    "reason",
                )
            )
            suffix = f" (reason: {reason})" if reason else ""
            raise RuntimeError(f"OpenAI response incomplete{suffix}")
        safe_status = cls._safe_reason(status)
        suffix = f" (status: {safe_status})" if safe_status else ""
        raise RuntimeError(f"OpenAI response did not complete{suffix}")

    @classmethod
    def _has_refusal(cls, response: Any) -> bool:
        for item in cls._field(response, "output") or []:
            for part in cls._field(item, "content") or []:
                if cls._field(part, "type") == "refusal":
                    return True
        return False

    @staticmethod
    def _field(value: Any, name: str) -> Any:
        if value is None:
            return None
        if isinstance(value, Mapping):
            return value.get(name)
        return getattr(value, name, None)

    @staticmethod
    def _safe_reason(value: Any) -> str | None:
        if not isinstance(value, str):
            return None
        normalized = value.strip().lower()
        if not re.fullmatch(r"[a-z][a-z0-9_.-]{0,63}", normalized):
            return None
        safe_reasons = {
            "bio_policy",
            "cancelled",
            "content_filter",
            "empty_image_file",
            "failed_to_download_image",
            "image_content_policy_violation",
            "image_file_not_found",
            "image_file_too_large",
            "image_parse_error",
            "image_too_large",
            "image_too_small",
            "insufficient_quota",
            "invalid_base64_image",
            "invalid_image",
            "invalid_image_format",
            "invalid_image_mode",
            "invalid_image_url",
            "invalid_prompt",
            "invalid_request_error",
            "max_output_tokens",
            "rate_limit_exceeded",
            "server_error",
            "timeout",
            "tool_call_limit",
            "unsupported_image_media_type",
            "vector_store_timeout",
        }
        return normalized if normalized in safe_reasons else None

    @staticmethod
    def _nested_output_text(output: Any) -> str | None:
        for item in output or []:
            content = item.get("content", []) if isinstance(item, dict) else getattr(item, "content", [])
            for part in content or []:
                part_type = part.get("type") if isinstance(part, dict) else getattr(part, "type", None)
                if part_type == "output_text":
                    text = part.get("text") if isinstance(part, dict) else getattr(part, "text", None)
                    if isinstance(text, str):
                        return text
        return None

    @staticmethod
    def _validate_object(
        value: dict[str, Any],
        fields: dict[str, type],
        *,
        enums: dict[str, set[str]] | None = None,
        nonempty: set[str] | None = None,
    ) -> dict[str, Any]:
        for field, expected_type in fields.items():
            if field not in value:
                raise ValueError(f"OpenAI structured output missing required field '{field}'")
            if type(value[field]) is not expected_type:
                type_name = "boolean" if expected_type is bool else expected_type.__name__
                raise ValueError(
                    f"OpenAI structured output field '{field}' must be a {type_name}"
                )
        for field, allowed_values in (enums or {}).items():
            if value[field] not in allowed_values:
                choices = ", ".join(sorted(allowed_values))
                raise ValueError(
                    f"OpenAI structured output field '{field}' must be one of: {choices}"
                )
        for field in nonempty or set():
            if not value[field].strip():
                raise ValueError(
                    f"OpenAI structured output field '{field}' must not be empty"
                )
        return {field: value[field] for field in fields}

    def _typed_realtime_create(self) -> Any | None:
        realtime = getattr(self._client, "realtime", None)
        client_secrets = getattr(realtime, "client_secrets", None)
        create = getattr(client_secrets, "create", None)
        if not callable(create):
            return None
        try:
            parameters = inspect.signature(create).parameters.values()
        except (TypeError, ValueError):
            return None
        names = {parameter.name for parameter in parameters}
        accepts_kwargs = any(
            parameter.kind is inspect.Parameter.VAR_KEYWORD
            for parameter in parameters
        )
        if accepts_kwargs or {
            "expires_after",
            "session",
            "extra_headers",
        }.issubset(names):
            return create
        return None
