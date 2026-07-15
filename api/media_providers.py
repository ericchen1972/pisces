"""Narrow Gemini image and Lyria music adapter for Convia."""

from __future__ import annotations

import asyncio
import base64
import io
import json
import re
import wave
from typing import Any
from urllib import error, request

from google import genai
from google.genai import types as genai_types


__all__ = ["generate_gemini_image", "generate_lyria_music"]

MUSIC_PLANNER_MODEL = "gemini-2.5-flash"
IMAGE_MODEL_CANDIDATES = (
    "gemini-3.1-flash-image-preview",
    "gemini-3-pro-image-preview",
    "gemini-2.5-flash-image",
    "gemini-2.0-flash-exp-image-generation",
)
MUSIC_MODEL = "models/lyria-realtime-exp"
MUSIC_DURATION_SECONDS = 30


def _call_generate_content(
    api_key: str,
    payload: dict[str, Any],
    *,
    model: str,
    timeout: int,
) -> dict[str, Any]:
    endpoint = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={api_key}"
    )
    provider_request = request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(provider_request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Gemini request failed: {detail}") from exc
    except Exception as exc:  # pragma: no cover - provider/network failure
        raise RuntimeError(f"Gemini request failed: {exc}") from exc


def _extract_response_text(data: dict[str, Any]) -> str:
    candidates = data.get("candidates") or []
    if not candidates:
        return ""
    content = candidates[0].get("content") or {}
    for part in content.get("parts") or []:
        text = (part.get("text") or "").strip()
        if text:
            return text
    return ""


def generate_gemini_image(api_key: str, prompt: str) -> tuple[bytes, str]:
    if not api_key:
        raise RuntimeError("GOOGLE_API_KEY/GEMINI_API_KEY is not configured")
    text_prompt = (prompt or "").strip() or "Create a beautiful illustration."
    last_error = ""
    for model_name in IMAGE_MODEL_CANDIDATES:
        payload = {
            "contents": [{"parts": [{"text": text_prompt}]}],
            "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
        }
        try:
            data = _call_generate_content(
                api_key,
                payload,
                model=model_name,
                timeout=90,
            )
            candidates = data.get("candidates") or []
            if not candidates:
                raise RuntimeError("no candidates")
            content = candidates[0].get("content") or {}
            for part in content.get("parts") or []:
                inline_data = part.get("inlineData") or {}
                image_base64 = (inline_data.get("data") or "").strip()
                mime_type = (inline_data.get("mimeType") or "image/png").strip()
                if image_base64:
                    return base64.b64decode(image_base64), mime_type
            raise RuntimeError("no inline image in response")
        except Exception as exc:
            last_error = f"{model_name}: {exc}"
    raise RuntimeError(last_error or "all image models failed")


def _plan_music_request(api_key: str, seed_text: str) -> dict[str, Any]:
    default = {
        "prompt": (seed_text or "instrumental electronic music").strip(),
        "bpm": 110,
        "temperature": 1.0,
    }
    if not (seed_text or "").strip():
        return default
    payload = {
        "system_instruction": {
            "parts": [
                {
                    "text": (
                        "You convert a user's natural-language music request into a concise "
                        "prompt for Lyria music generation. Return strict JSON only with "
                        "keys: prompt (string), bpm (integer 60-180), temperature (number "
                        "0.4-1.4). Preserve requested genre/mood/instruments exactly when "
                        "possible. Build a STYLE-LOCK prompt with concrete instrumentation + "
                        "rhythm so output doesn't drift. If user asks electronic music, "
                        "include synth bass, drum machine, arpeggiator, sidechain-like pumping "
                        "feel. If user asks jazz, include jazz harmony/swing/brush drums or "
                        "upright bass where appropriate. If user asks baroque/classical, "
                        "include strings/harpsichord/counterpoint language."
                    )
                }
            ]
        },
        "contents": [{"parts": [{"text": seed_text}]}],
        "generationConfig": {"responseMimeType": "application/json"},
    }
    try:
        response = _call_generate_content(
            api_key,
            payload,
            model=MUSIC_PLANNER_MODEL,
            timeout=20,
        )
        planned = json.loads(_extract_response_text(response) or "{}")
        prompt = str(planned.get("prompt") or "").strip() or default["prompt"]
        bpm = max(60, min(180, int(planned.get("bpm") or default["bpm"])))
        temperature = max(
            0.4,
            min(1.4, float(planned.get("temperature") or default["temperature"])),
        )
        return {"prompt": prompt, "bpm": bpm, "temperature": temperature}
    except Exception:
        return default


def _encode_wave(pcm_bytes: bytes, sample_rate: int, channels: int) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(channels)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm_bytes)
    return output.getvalue()


def generate_lyria_music(
    api_key: str,
    seed_text: str,
    duration_seconds: int = MUSIC_DURATION_SECONDS,
) -> bytes:
    if not api_key:
        raise RuntimeError("GOOGLE_API_KEY/GEMINI_API_KEY is not configured")

    async def _run() -> tuple[bytes, int, int]:
        client = genai.Client(
            api_key=api_key,
            http_options={"api_version": "v1alpha"},
        )
        pcm_chunks: list[bytes] = []
        duration = max(4, min(int(duration_seconds), 30))
        plan = _plan_music_request(api_key, seed_text)
        sample_rate = 48000
        channels = 2
        target_bytes = None
        async with client.aio.live.music.connect(model=MUSIC_MODEL) as session:
            await session.set_weighted_prompts(
                prompts=[
                    genai_types.WeightedPrompt(
                        text=plan["prompt"] or "instrumental electronic music",
                        weight=1.25,
                    ),
                    genai_types.WeightedPrompt(
                        text="STYLE LOCK: follow requested genre/mood/instrumentation "
                        "strictly; avoid unrelated style drift.",
                        weight=1.0,
                    ),
                    genai_types.WeightedPrompt(
                        text="instrumental only, no spoken words, no vocal syllables",
                        weight=0.45,
                    ),
                ]
            )
            await session.set_music_generation_config(
                config=genai_types.LiveMusicGenerationConfig(
                    bpm=int(plan["bpm"]),
                    temperature=float(plan["temperature"]),
                )
            )
            await session.play()
            stream = session.receive()
            while True:
                message = await asyncio.wait_for(anext(stream), timeout=8.0)
                server_content = getattr(message, "server_content", None)
                audio_chunks = (
                    getattr(server_content, "audio_chunks", None)
                    if server_content
                    else None
                )
                if not audio_chunks:
                    continue
                for chunk in audio_chunks:
                    data = getattr(chunk, "data", b"")
                    mime_type = (getattr(chunk, "mime_type", "") or "").lower()
                    rate_match = re.search(r"rate=(\d+)", mime_type)
                    if rate_match:
                        sample_rate = int(rate_match.group(1))
                    channels_match = re.search(r"channels=(\d+)", mime_type)
                    if channels_match:
                        channels = int(channels_match.group(1))
                    if target_bytes is None:
                        target_bytes = sample_rate * channels * 2 * duration
                    if data:
                        pcm_chunks.append(data)
                if target_bytes and sum(map(len, pcm_chunks)) >= target_bytes:
                    break
        return b"".join(pcm_chunks), sample_rate, channels

    pcm_bytes, sample_rate, channels = asyncio.run(_run())
    if not pcm_bytes:
        raise RuntimeError("Lyria returned no audio chunks")
    return _encode_wave(pcm_bytes, sample_rate, channels)
