import base64
import io
import wave
from types import SimpleNamespace

import main
import media_providers


def test_image_adapter_preserves_model_fallback_and_inline_image_decoding(monkeypatch):
    calls = []

    def fake_generate(api_key, payload, *, model, timeout):
        calls.append((api_key, payload, model, timeout))
        if len(calls) == 1:
            raise RuntimeError("first model unavailable")
        return {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "inlineData": {
                                    "data": base64.b64encode(b"image-bytes").decode(),
                                    "mimeType": "image/webp",
                                }
                            }
                        ]
                    }
                }
            ]
        }

    monkeypatch.setattr(media_providers, "_call_generate_content", fake_generate)

    image_bytes, mime_type = media_providers.generate_gemini_image(
        "gemini-key", "draw a garden"
    )

    assert (image_bytes, mime_type) == (b"image-bytes", "image/webp")
    assert [call[2] for call in calls] == list(
        media_providers.IMAGE_MODEL_CANDIDATES[:2]
    )
    assert all(call[0] == "gemini-key" and call[3] == 90 for call in calls)


def test_music_wave_encoder_preserves_pcm_metadata():
    encoded = media_providers._encode_wave(b"\x01\x00\x02\x00", 48000, 1)

    with wave.open(io.BytesIO(encoded), "rb") as wav_file:
        assert wav_file.getframerate() == 48000
        assert wav_file.getnchannels() == 1
        assert wav_file.getsampwidth() == 2
        assert wav_file.readframes(2) == b"\x01\x00\x02\x00"


def test_lyria_adapter_runs_async_session_until_pcm_duration_target(monkeypatch):
    events = []
    yielded = []
    first_chunk = b"\x01\x00" * 20
    second_chunk = b"\x02\x00" * 20

    monkeypatch.setattr(
        media_providers,
        "_plan_music_request",
        lambda api_key, seed_text: events.append(("plan", api_key, seed_text))
        or {"prompt": "locked jazz", "bpm": 123, "temperature": 0.8},
    )

    def weighted_prompt(**kwargs):
        events.append(("weighted_prompt", kwargs))
        return SimpleNamespace(**kwargs)

    def music_config(**kwargs):
        events.append(("music_config", kwargs))
        return SimpleNamespace(**kwargs)

    monkeypatch.setattr(media_providers.genai_types, "WeightedPrompt", weighted_prompt)
    monkeypatch.setattr(
        media_providers.genai_types,
        "LiveMusicGenerationConfig",
        music_config,
    )

    class Stream:
        def __init__(self):
            self._chunks = iter((first_chunk, second_chunk, b"extra"))

        def __aiter__(self):
            return self

        async def __anext__(self):
            try:
                pcm = next(self._chunks)
            except StopIteration as exc:
                raise StopAsyncIteration from exc
            yielded.append(pcm)
            return SimpleNamespace(
                server_content=SimpleNamespace(
                    audio_chunks=[
                        SimpleNamespace(
                            data=pcm,
                            mime_type="audio/L16;rate=10;channels=1",
                        )
                    ]
                )
            )

    class Session:
        async def set_weighted_prompts(self, *, prompts):
            events.append(("set_weighted_prompts", prompts))

        async def set_music_generation_config(self, *, config):
            events.append(("set_music_generation_config", config))

        async def play(self):
            events.append(("play",))

        def receive(self):
            events.append(("receive",))
            return Stream()

    class Connection:
        async def __aenter__(self):
            events.append(("enter",))
            return Session()

        async def __aexit__(self, exc_type, exc, traceback):
            events.append(("exit", exc_type))

    class Music:
        def connect(self, *, model):
            events.append(("connect", model))
            return Connection()

    class Client:
        def __init__(self, *, api_key, http_options):
            events.append(("client", api_key, http_options))
            self.aio = SimpleNamespace(
                live=SimpleNamespace(music=Music())
            )

    monkeypatch.setattr(media_providers.genai, "Client", Client)

    encoded = media_providers.generate_lyria_music(
        "gemini-key", "late night jazz", duration_seconds=1
    )

    with wave.open(io.BytesIO(encoded), "rb") as wav_file:
        assert wav_file.getframerate() == 10
        assert wav_file.getnchannels() == 1
        assert wav_file.getsampwidth() == 2
        assert wav_file.getnframes() == 40
        assert wav_file.readframes(40) == first_chunk + second_chunk

    assert ("client", "gemini-key", {"api_version": "v1alpha"}) in events
    assert ("plan", "gemini-key", "late night jazz") in events
    assert ("connect", media_providers.MUSIC_MODEL) in events
    assert ("music_config", {"bpm": 123, "temperature": 0.8}) in events
    assert ("play",) in events
    assert ("exit", None) in events
    assert yielded == [first_chunk, second_chunk]


def test_main_media_facades_delegate_only_key_and_product_arguments(monkeypatch):
    calls = []
    monkeypatch.setattr(main, "get_gemini_api_key", lambda: "configured-key")
    monkeypatch.setattr(
        media_providers,
        "generate_gemini_image",
        lambda api_key, prompt: calls.append(("image", api_key, prompt))
        or (b"image", "image/png"),
    )
    monkeypatch.setattr(
        media_providers,
        "generate_lyria_music",
        lambda api_key, prompt, duration_seconds: calls.append(
            ("music", api_key, prompt, duration_seconds)
        )
        or b"music",
    )

    assert main.generate_image_with_gemini("garden") == (b"image", "image/png")
    assert main.generate_music_with_lyria("jazz", duration_seconds=12) == b"music"
    assert calls == [
        ("image", "configured-key", "garden"),
        ("music", "configured-key", "jazz", 12),
    ]
