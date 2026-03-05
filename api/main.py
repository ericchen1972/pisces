import json
import os
import base64
import re
import struct
import hashlib
import asyncio
import uuid
import math
import random
from datetime import datetime, timedelta, timezone
from urllib import error, request
from urllib.parse import urlencode

from flask import Flask, jsonify, request as flask_request, session
from google.auth.transport import requests as google_requests
from google.cloud import firestore
from google.cloud import speech_v1 as speech
from google import genai
from google.genai import types as genai_types
from google.oauth2 import id_token
from google.oauth2 import service_account
from ably import AblyRest

app = Flask(__name__)
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.json")
FIRESTORE_SA_PATH = os.path.join(os.path.dirname(__file__), "keys", "firestore-sa.json")
FIRESTORE_PROJECT_ID = os.getenv("FIRESTORE_PROJECT_ID", "pisces-hackathon")
FIRESTORE_DATABASE_ID = os.getenv("FIRESTORE_DATABASE_ID", "pisces")
GOOGLE_CLIENT_ID = os.getenv(
    "GOOGLE_CLIENT_ID",
    "315346868518-os2tf8uc5282bggj40jbpkaltae1phi9.apps.googleusercontent.com",
)
CHAT_MODEL = "gemini-2.5-flash"
TTS_MODEL = "gemini-2.5-pro-preview-tts"
LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025"
IMAGE_MODEL_CANDIDATES = [
    "gemini-3.1-flash-image-preview",
    "gemini-3-pro-image-preview",
    "gemini-2.5-flash-image",
    "gemini-2.0-flash-exp-image-generation",
]
MUSIC_MODEL = "models/lyria-realtime-exp"
MUSIC_DURATION_SECONDS = 30
AI_DEFAULT_GLOBAL_PROMPT = (
    "You are a polite, warm, and thoughtful AI communication partner."
)
DEFAULT_AI_SETTINGS = {
    "gender": "female",
    "voice": "Achernar",
    "global_prompt": AI_DEFAULT_GLOBAL_PROMPT,
}
FEMALE_VOICES = {
    "Achernar",
    "Aoede",
    "Autonoe",
    "Callirrhoe",
    "Despina",
    "Erinome",
    "Gacrux",
    "Kore",
    "Laomedeia",
    "Leda",
    "Pulcherrima",
    "Sulafat",
    "Vindemiatrix",
    "Zephyr",
}
MALE_VOICES = {
    "Achird",
    "Algenib",
    "Algieba",
    "Alnilam",
    "Charon",
    "Enceladus",
    "Fenrir",
    "Iapetus",
    "Orus",
    "Puck",
    "Rasalgethi",
    "Sadachbia",
    "Sadaltager",
    "Schedar",
    "Umbriel",
    "Zubenelgenubi",
}


def get_config_value(*keys):
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                config = json.load(f)
            for key_name in keys:
                value = (config.get(key_name) or "").strip()
                if value:
                    return value
        except Exception:
            pass
    for key_name in keys:
        value = (os.getenv(key_name) or "").strip()
        if value:
            return value
    return ""


SESSION_SECRET = get_config_value("SESSION_SECRET", "FLASK_SECRET_KEY", "SECRET_KEY") or "pisces-dev-secret-key"
app.secret_key = SESSION_SECRET
app.config["SESSION_COOKIE_NAME"] = "pisces_session"
app.config["SESSION_COOKIE_HTTPONLY"] = True
SESSION_COOKIE_SECURE = get_config_value("SESSION_COOKIE_SECURE").lower() in ("1", "true", "yes", "on")
app.config["SESSION_COOKIE_SECURE"] = SESSION_COOKIE_SECURE
app.config["SESSION_COOKIE_SAMESITE"] = "None" if SESSION_COOKIE_SECURE else "Lax"


def call_gemini_generate_content(payload, model=CHAT_MODEL, timeout=30):
    gemini_api_key = get_gemini_api_key()
    if not gemini_api_key:
        raise RuntimeError("GOOGLE_API_KEY/GEMINI_API_KEY is not configured")

    endpoint = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent"
        f"?key={gemini_api_key}"
    )
    req = request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Gemini request failed: {detail}") from exc
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(f"Gemini request failed: {exc}") from exc


def extract_text_from_response(data):
    candidates = data.get("candidates") or []
    if not candidates:
        return ""
    content = candidates[0].get("content") or {}
    parts = content.get("parts") or []
    for part in parts:
        text = (part.get("text") or "").strip()
        if text:
            return text
    return ""


def extract_json_obj(text):
    text = (text or "").strip()
    if not text:
        return {}
    try:
        return json.loads(text)
    except Exception:
        pass

    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not match:
        return {}
    try:
        return json.loads(match.group(0))
    except Exception:
        return {}


def count_zh_chars(text):
    return len(re.sub(r"\s+", "", text or ""))


def count_en_words(text):
    words = re.findall(r"[A-Za-z0-9][A-Za-z0-9'-]*", text or "")
    return len(words)


def has_explicit_voice_request(text):
    value = (text or "").strip().lower()
    if not value:
        return False
    zh_patterns = [
        r"唸給我聽",
        r"念給我聽",
        r"讀給我聽",
        r"朗讀",
        r"語音",
        r"講出來",
        r"說出來",
    ]
    en_patterns = [
        r"\bread\b",
        r"\bread aloud\b",
        r"\bsay aloud\b",
        r"\bspeak\b",
        r"\bnarrate\b",
        r"\bpronounce\b",
    ]
    for pattern in zh_patterns + en_patterns:
        if re.search(pattern, value):
            return True
    return False


def has_forward_intent_in_ai_room(text):
    value = (text or "").strip().lower()
    if not value:
        return False
    zh_patterns = [
        r"幫我.*(說|問|告訴|傳|傳送|轉傳|發送|送)",
        r"跟.+說",
        r"告訴.+",
        r"幫我傳",
        r"代我",
        r"(傳|傳送|轉傳|發送|送).+給",
        r"給.+(傳|傳送|轉傳|發送|送)",
        r"把.+給.+",
    ]
    en_patterns = [
        r"\btell\b.+\b",
        r"\bask\b.+\b",
        r"\bsend\b.+\bto\b",
        r"\bforward\b.+\bto\b",
        r"\bdeliver\b.+\bto\b",
        r"\bmessage\b.+\b",
        r"\bfor me\b",
    ]
    for pattern in zh_patterns + en_patterns:
        if re.search(pattern, value):
            return True
    return False


def has_send_to_friend_intent(text):
    value = (text or "").strip().lower()
    if not value:
        return False
    zh_patterns = [
        r"幫我.*(說|問|告訴|轉達|傳|傳送|傳話|發送|送|問候)",
        r"(跟|向).+(說|問|告訴|問候)",
        r"告訴.+",
        r"問候.+",
        r"代我",
        r"(傳|傳送|轉傳|發送|送).+給",
        r"給.+(傳|傳送|轉傳|發送|送)",
        r"把.+給.+",
    ]
    en_patterns = [
        r"\bhelp me\b.*\b(tell|ask|message|send|greet)\b",
        r"\b(tell|ask|message|send|greet)\b.+\b(for me|to)\b",
        r"\b(forward|deliver)\b.+\bto\b",
    ]
    for pattern in zh_patterns + en_patterns:
        if re.search(pattern, value):
            return True
    return False


def has_draw_image_intent(text):
    value = (text or "").strip().lower()
    if not value:
        return False
    zh_patterns = [r"畫", r"繪", r"圖片", r"插畫", r"生成圖", r"做一張圖"]
    en_patterns = [r"\bdraw\b", r"\bimage\b", r"\billustration\b", r"\bpicture\b", r"\bgenerate an image\b"]
    for pattern in zh_patterns + en_patterns:
        if re.search(pattern, value):
            return True
    return False


def has_create_music_intent(text):
    value = (text or "").strip().lower()
    if not value:
        return False
    zh_patterns = [
        r"音樂",
        r"配樂",
        r"歌曲",
        r"作曲",
        r"旋律",
        r"背景音樂",
        r"爵士樂",
        r"古典樂",
        r"搖滾樂",
        r"電音",
        r"創作.*樂",
        r"做一段.*樂",
        r"生成.*樂",
        r"編一段.*樂",
    ]
    en_patterns = [r"\bmusic\b", r"\bsong\b", r"\bcompose\b", r"\btrack\b", r"\binstrumental\b"]
    for pattern in zh_patterns + en_patterns:
        if re.search(pattern, value):
            return True
    return False


def has_lyrics_request(text):
    value = (text or "").strip().lower()
    if not value:
        return False
    zh_patterns = [r"歌詞", r"詞", r"寫歌", r"作詞", r"唱", r"人聲"]
    en_patterns = [r"\blyrics\b", r"\bvocals?\b", r"\bsing\b", r"\bwrite.*song\b", r"\bwrite.*lyrics\b"]
    for pattern in zh_patterns + en_patterns:
        if re.search(pattern, value):
            return True
    return False


def has_explicit_send_as_user_intent(text):
    value = (text or "").strip().lower()
    if not value:
        return False
    zh_patterns = [
        r"用我的名義",
        r"以我的名義",
        r"代表我",
        r"替我本人",
    ]
    en_patterns = [
        r"\bin my name\b",
        r"\bas me\b",
        r"\bfrom me\b",
        r"\buse my name\b",
        r"\bon my behalf\b",
    ]
    for pattern in zh_patterns + en_patterns:
        if re.search(pattern, value):
            return True
    return False


def normalize_friend_outbound_text(user_message, friend_name):
    text = (user_message or "").strip()
    if not text:
        return ""

    patterns = [
        rf"^\s*幫我(?:用語音)?(?:跟|向)?\s*{re.escape(friend_name)}\s*(?:說|問|告訴|問候)?\s*(?:一下)?[，,\s]*",
        rf"^\s*(?:跟|向)\s*{re.escape(friend_name)}\s*(?:說|問|告訴|問候)\s*[，,\s]*",
        rf"^\s*請(?:你)?(?:幫我)?(?:跟|向)?\s*{re.escape(friend_name)}\s*(?:說|問|告訴|問候)?\s*(?:一下)?[，,\s]*",
    ]
    cleaned = text
    for pattern in patterns:
        cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.strip("，, 。.!?？")
    return cleaned or text


def list_user_friends(user_id):
    client = get_firestore_client()
    docs = list(
        client.collection("friendships")
        .where("status", "==", "accepted")
        .stream()
    )
    friends = []
    for doc in docs:
        data = doc.to_dict() or {}
        user_a_id = (data.get("user_a_id") or "").strip()
        user_b_id = (data.get("user_b_id") or "").strip()
        if user_id not in (user_a_id, user_b_id):
            continue
        is_a = user_id == user_a_id
        friend_id = user_b_id if is_a else user_a_id
        alias = (data.get("alias_for_a") or "").strip() if is_a else (data.get("alias_for_b") or "").strip()
        display_name = (data.get("user_b_display_name") or "").strip() if is_a else (data.get("user_a_display_name") or "").strip()
        email = (data.get("user_b_email") or "").strip().lower() if is_a else (data.get("user_a_email") or "").strip().lower()
        friends.append(
            {
                "id": friend_id,
                "alias": alias,
                "display_name": display_name,
                "email": email,
            }
        )
    return friends


def find_friend_from_message(user_id, text):
    value = (text or "").strip().lower()
    if not value:
        return None
    for friend in list_user_friends(user_id):
        candidates = [friend.get("alias") or "", friend.get("display_name") or ""]
        email = friend.get("email") or ""
        if email:
            candidates.append(email.split("@", 1)[0])
            candidates.append(email)
        for candidate in candidates:
            token = candidate.strip().lower()
            if token and token in value:
                return friend
    return None


def find_friend_by_exact_name(user_id, name):
    key = (name or "").strip().lower()
    if not key:
        return None
    for friend in list_user_friends(user_id):
        candidates = [friend.get("alias") or "", friend.get("display_name") or ""]
        email = (friend.get("email") or "").strip().lower()
        if email:
            candidates.append(email)
            candidates.append(email.split("@", 1)[0])
        for candidate in candidates:
            token = (candidate or "").strip().lower()
            if token and token == key:
                return friend
    return None


def decide_about_friend(user_message):
    instruction = (
        "You are a planner for tool `about_friend` in AI room. "
        "Return strict JSON only with keys: call_about_friend (boolean), name (string). "
        "Set call_about_friend=true only if the user is clearly talking about a specific person/contact and more context may help. "
        "If true, set name to the exact person name mentioned by user. "
        "If false, set name to empty string."
    )
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": instruction},
                    {"text": f"User message:\n{user_message}"},
                ]
            }
        ]
    }
    try:
        data = call_gemini_generate_content(payload, model=CHAT_MODEL)
        raw = extract_text_from_response(data)
        obj = extract_json_obj(raw)
        return {
            "call_about_friend": bool(obj.get("call_about_friend")),
            "name": str(obj.get("name") or "").strip(),
        }
    except Exception:
        return {
            "call_about_friend": False,
            "name": "",
        }


def about_friend(user_id, name, history_range):
    friend = find_friend_by_exact_name(user_id, name)
    if not friend:
        return {
            "requested_name": (name or "").strip(),
            "friend": None,
            "history": [],
        }
    history = get_chat_messages(user_id, friend["id"], history_range=history_range)
    return {
        "requested_name": (name or "").strip(),
        "friend": friend,
        "history": history,
    }


def build_about_friend_context(user_name, about_result):
    friend = (about_result or {}).get("friend")
    if not friend:
        return ""
    friend_name = (friend.get("alias") or friend.get("display_name") or friend.get("email") or "friend").strip()
    history = (about_result or {}).get("history") or []
    lines = [
        f'Additional context from chat history between "{user_name}" and "{friend_name}".',
        "Each line starts with the speaker name.",
    ]
    for msg in history:
        role = (msg.get("role") or "").strip()
        text = (msg.get("text") or "").strip()
        if not text:
            continue
        if role == "user":
            speaker = user_name
        elif role in ("peer", "ai_proxy"):
            speaker = friend_name
        else:
            continue
        lines.append(f"{speaker}: {text}")
    return "\n".join(lines)


def build_chat_tool_decision(user_message, global_prompt, history_messages, extra_context_text=""):
    instruction = (
        "You are Pisces AI. Follow the persona/global prompt below first, then decide whether "
        "the user asked for spoken output. "
        "Return strict JSON only with keys: "
        "reply (string), "
        "should_read_aloud (boolean), "
        "language (one of: zh-TW, en-US), "
        "tone_prompt (string), "
        "reason (string). "
        "Rules: "
        "1) If user intent suggests read aloud/voice playback, set should_read_aloud=true. "
        "2) If should_read_aloud=true and language=zh-TW, reply must be <=100 Chinese characters. "
        "3) If should_read_aloud=true and language=en-US, reply must be <=50 English words. "
        "4) If these limits would make content incorrect/incomplete, set should_read_aloud=false and explain why in reply. "
        "5) If should_read_aloud=true, also provide tone_prompt based on user intent, e.g. "
        "\"warm and caring\", \"calm professional\", \"energetic and cheerful\". "
        "6) Keep reply natural and helpful."
    )
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": instruction},
                    {"text": f"Persona/Global prompt:\n{global_prompt}"},
                    {"text": f"Conversation history (oldest -> newest):\n{build_history_prompt(history_messages)}"},
                    *([{"text": f"Extra context:\n{extra_context_text}"}] if (extra_context_text or "").strip() else []),
                    {"text": f"User message:\n{user_message}"},
                ]
            }
        ]
    }
    data = call_gemini_generate_content(payload, model=CHAT_MODEL)
    raw = extract_text_from_response(data)
    obj = extract_json_obj(raw)

    reply = str(obj.get("reply") or "").strip()
    should_read_aloud = bool(obj.get("should_read_aloud"))
    language = str(obj.get("language") or "").strip() or "zh-TW"
    tone_prompt = str(obj.get("tone_prompt") or "").strip()
    reason = str(obj.get("reason") or "").strip()

    if language not in ("zh-TW", "en-US"):
        language = "zh-TW"

    if should_read_aloud and not has_explicit_voice_request(user_message):
        should_read_aloud = False
        tone_prompt = ""
        reason = "voice_not_explicitly_requested"

    if not reply:
        # Fallback to regular text generation if JSON output is malformed.
        reply = generate_plain_text_reply(user_message, global_prompt, history_messages)
        should_read_aloud = False
        tone_prompt = ""
        reason = "tool_output_invalid"

    if should_read_aloud:
        if language == "zh-TW" and count_zh_chars(reply) > 100:
            should_read_aloud = False
            reply = (
                "這段內容若壓在 100 字內會失真或不完整，因此先以文字回覆，"
                "避免語意被截斷。"
            )
            reason = "zh_limit_exceeded"
        if language == "en-US" and count_en_words(reply) > 50:
            should_read_aloud = False
            reply = (
                "I can't read this aloud accurately within the 50-word limit, "
                "so I am replying in text to keep the meaning complete."
            )
            reason = "en_limit_exceeded"
        if not tone_prompt:
            tone_prompt = "warm and caring" if language == "en-US" else "溫柔且貼心"
    else:
        tone_prompt = ""

    return {
        "reply": reply,
        "should_read_aloud": should_read_aloud,
        "language": language,
        "tone_prompt": tone_prompt,
        "reason": reason,
    }


def generate_plain_text_reply(user_message, global_prompt, history_messages):
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": f"Persona/Global prompt:\n{global_prompt}"},
                    {"text": f"Conversation history (oldest -> newest):\n{build_history_prompt(history_messages)}"},
                    {"text": user_message},
                ]
            }
        ]
    }
    data = call_gemini_generate_content(payload, model=CHAT_MODEL)
    reply_text = extract_text_from_response(data)
    if not reply_text:
        raise RuntimeError("Gemini returned empty response")
    return reply_text


def synthesize_tts_audio(text, language, voice_name, tone_prompt=""):
    # Keep TTS input as plain message text to avoid speaking prompt metadata.
    prompt = (text or "").strip()
    if not prompt:
        raise RuntimeError("TTS text is empty")
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt},
                ]
            }
        ],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {
                        "voiceName": voice_name,
                    }
                }
            },
        },
    }
    data = call_gemini_generate_content(payload, model=TTS_MODEL, timeout=60)
    candidates = data.get("candidates") or []
    if not candidates:
        raise RuntimeError("Gemini TTS returned no candidates")
    content = candidates[0].get("content") or {}
    parts = content.get("parts") or []
    for part in parts:
        inline_data = part.get("inlineData") or {}
        audio_b64 = (inline_data.get("data") or "").strip()
        mime_type = (inline_data.get("mimeType") or "audio/wav").strip()
        if audio_b64:
            mime_lower = mime_type.lower()
            if "audio/l16" in mime_lower or "audio/pcm" in mime_lower or "audio/raw" in mime_lower:
                sample_rate = 24000
                rate_match = re.search(r"rate=(\d+)", mime_lower)
                if rate_match:
                    sample_rate = int(rate_match.group(1))
                try:
                    pcm_bytes = base64.b64decode(audio_b64)
                    wav_bytes = pcm16_to_wav_bytes(pcm_bytes, sample_rate=sample_rate, channels=1)
                    return base64.b64encode(wav_bytes).decode("ascii"), "audio/wav"
                except Exception:
                    pass
            return audio_b64, mime_type
    raise RuntimeError("Gemini TTS returned no audio data")


def create_live_ephemeral_token():
    gemini_api_key = get_gemini_api_key()
    if not gemini_api_key:
        raise RuntimeError("GOOGLE_API_KEY/GEMINI_API_KEY is not configured")

    client = genai.Client(api_key=gemini_api_key, http_options={"api_version": "v1alpha"})
    now = datetime.now(timezone.utc)
    new_token = client.auth_tokens.create(
        config={
            "uses": 1,
            "expire_time": (now + timedelta(minutes=30)).isoformat(),
            "new_session_expire_time": (now + timedelta(minutes=2)).isoformat(),
            "http_options": {"api_version": "v1alpha"},
            "live_connect_constraints": {
                "model": LIVE_MODEL,
                "config": {
                    "response_modalities": ["AUDIO"],
                    "speech_config": {
                        "voice_config": {
                            "prebuilt_voice_config": {
                                "voice_name": "Leda",
                            }
                        }
                    },
                },
            },
        }
    )
    return {
        "token": new_token.name,
        "expire_time": getattr(new_token, "expire_time", None),
        "new_session_expire_time": getattr(new_token, "new_session_expire_time", None),
    }


def pcm16_to_wav_bytes(pcm_bytes, sample_rate=24000, channels=1):
    bits_per_sample = 16
    byte_rate = sample_rate * channels * (bits_per_sample // 8)
    block_align = channels * (bits_per_sample // 8)
    data_size = len(pcm_bytes)
    riff_chunk_size = 36 + data_size

    header = b"".join(
        [
            b"RIFF",
            struct.pack("<I", riff_chunk_size),
            b"WAVE",
            b"fmt ",
            struct.pack("<I", 16),
            struct.pack("<H", 1),
            struct.pack("<H", channels),
            struct.pack("<I", sample_rate),
            struct.pack("<I", byte_rate),
            struct.pack("<H", block_align),
            struct.pack("<H", bits_per_sample),
            b"data",
            struct.pack("<I", data_size),
        ]
    )
    return header + pcm_bytes


def get_gemini_api_key():
    return get_config_value("GOOGLE_API_KEY", "GEMINI_API_KEY")


def get_blob_rw_token():
    return get_config_value("BLOB_READ_WRITE_TOKEN", "spices_READ_WRITE_TOKEN", "VITE_BLOB_READ_WRITE_TOKEN")


def get_ably_key():
    return get_config_value("ABLY_KEY", "ABLY_SUB")


def create_ably_token_request(user_id):
    ably_key = get_ably_key()
    if not ably_key:
        raise RuntimeError("ABLY_KEY is not configured")

    channel_name = f"user_{user_id}"
    capability = {
        channel_name: ["subscribe", "presence"],
    }

    async def _run():
        client = AblyRest(ably_key)
        token_request = await client.auth.create_token_request(
            token_params={
                "client_id": channel_name,
                "ttl": 60 * 60 * 1000,
                "capability": json.dumps(capability),
            }
        )
        return token_request.to_dict()

    return asyncio.run(_run())


def publish_user_channel_message(recipient_user_id, payload):
    ably_key = get_ably_key()
    if not ably_key:
        raise RuntimeError("ABLY_KEY is not configured")

    async def _run():
        client = AblyRest(ably_key)
        channel = client.channels.get(f"user_{recipient_user_id}")
        await channel.publish("message.new", payload)

    return asyncio.run(_run())


def upload_avatar_to_vercel_blob(user_id, image_bytes, mime_type="image/webp"):
    token = get_blob_rw_token()
    if not token:
        raise RuntimeError("BLOB_READ_WRITE_TOKEN is not configured")
    if not image_bytes:
        raise RuntimeError("avatar image payload is empty")

    pathname = f"avatars/{user_id}/avatar_{int(datetime.now(timezone.utc).timestamp() * 1000)}.webp"
    endpoint = f"https://vercel.com/api/blob/?{urlencode({'pathname': pathname})}"
    req = request.Request(
        endpoint,
        data=image_bytes,
        headers={
            "Authorization": f"Bearer {token}",
            "x-vercel-blob-access": "public",
            "x-content-type": mime_type or "image/webp",
            "x-add-random-suffix": "0",
            "x-api-version": "12",
            "Content-Type": mime_type or "image/webp",
        },
        method="PUT",
    )
    try:
        with request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"blob upload failed: {detail}") from exc
    except Exception as exc:
        raise RuntimeError(f"blob upload failed: {exc}") from exc

    blob_url = (payload.get("url") or "").strip()
    if not blob_url.startswith("https://"):
        raise RuntimeError("blob upload succeeded but no valid url returned")
    return blob_url


def _audio_ext_from_mime(mime_type):
    mime = (mime_type or "").lower()
    if "mpeg" in mime or "mp3" in mime:
        return "mp3"
    if "ogg" in mime:
        return "ogg"
    if "webm" in mime:
        return "webm"
    if "wav" in mime or "l16" in mime or "pcm" in mime:
        return "wav"
    return "wav"


def upload_audio_to_vercel_blob(user_id, audio_bytes, mime_type="audio/wav"):
    token = get_blob_rw_token()
    if not token:
        raise RuntimeError("BLOB_READ_WRITE_TOKEN is not configured")
    if not audio_bytes:
        raise RuntimeError("audio payload is empty")

    ext = _audio_ext_from_mime(mime_type)
    content_type = mime_type or "audio/wav"
    pathname = f"audios/{user_id}/voice_{int(datetime.now(timezone.utc).timestamp() * 1000)}.{ext}"
    endpoint = f"https://vercel.com/api/blob/?{urlencode({'pathname': pathname})}"
    req = request.Request(
        endpoint,
        data=audio_bytes,
        headers={
            "Authorization": f"Bearer {token}",
            "x-vercel-blob-access": "public",
            "x-content-type": content_type,
            "x-add-random-suffix": "0",
            "x-api-version": "12",
            "Content-Type": content_type,
        },
        method="PUT",
    )
    try:
        with request.urlopen(req, timeout=45) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"blob upload failed: {detail}") from exc
    except Exception as exc:
        raise RuntimeError(f"blob upload failed: {exc}") from exc

    blob_url = (payload.get("url") or "").strip()
    if not blob_url.startswith("https://"):
        raise RuntimeError("blob upload succeeded but no valid url returned")
    return blob_url


def upload_image_to_vercel_blob(user_id, image_bytes, mime_type="image/png"):
    token = get_blob_rw_token()
    if not token:
        raise RuntimeError("BLOB_READ_WRITE_TOKEN is not configured")
    if not image_bytes:
        raise RuntimeError("image payload is empty")

    ext = "png" if "png" in (mime_type or "").lower() else "jpg"
    content_type = mime_type or "image/png"
    pathname = f"images/{user_id}/image_{int(datetime.now(timezone.utc).timestamp() * 1000)}.{ext}"
    endpoint = f"https://vercel.com/api/blob/?{urlencode({'pathname': pathname})}"
    req = request.Request(
        endpoint,
        data=image_bytes,
        headers={
            "Authorization": f"Bearer {token}",
            "x-vercel-blob-access": "public",
            "x-content-type": content_type,
            "x-add-random-suffix": "0",
            "x-api-version": "12",
            "Content-Type": content_type,
        },
        method="PUT",
    )
    try:
        with request.urlopen(req, timeout=45) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"blob upload failed: {detail}") from exc
    except Exception as exc:
        raise RuntimeError(f"blob upload failed: {exc}") from exc

    blob_url = (payload.get("url") or "").strip()
    if not blob_url.startswith("https://"):
        raise RuntimeError("blob upload succeeded but no valid url returned")
    return blob_url


def generate_image_with_gemini(prompt):
    text_prompt = (prompt or "").strip() or "Create a beautiful illustration."
    last_err = ""
    for model_name in IMAGE_MODEL_CANDIDATES:
        payload = {
            "contents": [{"parts": [{"text": text_prompt}]}],
            "generationConfig": {
                "responseModalities": ["TEXT", "IMAGE"],
            },
        }
        try:
            data = call_gemini_generate_content(payload, model=model_name, timeout=90)
            candidates = data.get("candidates") or []
            if not candidates:
                raise RuntimeError("no candidates")
            content = candidates[0].get("content") or {}
            parts = content.get("parts") or []
            for part in parts:
                inline_data = part.get("inlineData") or {}
                image_b64 = (inline_data.get("data") or "").strip()
                mime_type = (inline_data.get("mimeType") or "image/png").strip()
                if image_b64:
                    return base64.b64decode(image_b64), mime_type
            raise RuntimeError("no inline image in response")
        except Exception as exc:
            last_err = f"{model_name}: {exc}"
            continue
    raise RuntimeError(last_err or "all image models failed")


def build_tool_status_reply(want_image, want_music, image_url, music_url, image_error="", music_error=""):
    parts = []
    if want_image:
        if image_url:
            parts.append("Image created successfully.")
        else:
            reason = (image_error or "image tool unavailable").split("\n", 1)[0][:180]
            parts.append(f"Image generation failed: {reason}")
    if want_music:
        if music_url:
            parts.append("Music created successfully.")
        else:
            reason = (music_error or "music tool unavailable").split("\n", 1)[0][:180]
            parts.append(f"Music generation failed: {reason}")
    return " ".join(parts).strip()


def synthesize_music_wav_bytes_fallback(seed_text, duration_seconds=MUSIC_DURATION_SECONDS):
    sample_rate = 24000
    duration_seconds = max(4, min(int(duration_seconds), 30))
    total_samples = sample_rate * duration_seconds
    pcm = bytearray()

    seed_int = int(hashlib.sha1((seed_text or "pisces music").encode("utf-8")).hexdigest()[:8], 16)
    rng = random.Random(seed_int)
    scale_hz = [220.00, 246.94, 261.63, 293.66, 329.63, 369.99, 392.00, 440.00]
    beat_samples = sample_rate // 2
    t = 0
    while t < total_samples:
        freq = rng.choice(scale_hz) * (2 if rng.random() > 0.75 else 1)
        note_len = beat_samples * (1 if rng.random() > 0.35 else 2)
        note_end = min(total_samples, t + note_len)
        for i in range(t, note_end):
            dt = i / sample_rate
            env = min(1.0, (i - t) / (sample_rate * 0.03))
            tail = max(0.0, (note_end - i) / (sample_rate * 0.05))
            amp = min(env, tail if tail > 0 else env) * 0.26
            sample = amp * (math.sin(2 * math.pi * freq * dt) + 0.35 * math.sin(2 * math.pi * (freq * 2.0) * dt))
            s16 = int(max(-1.0, min(1.0, sample)) * 32767)
            pcm.extend(struct.pack("<h", s16))
        t = note_end

    return pcm16_to_wav_bytes(bytes(pcm), sample_rate=sample_rate, channels=1)


def plan_music_request(seed_text):
    default = {
        "prompt": (seed_text or "instrumental electronic music").strip(),
        "bpm": 110,
        "temperature": 1.0,
    }
    if not (seed_text or "").strip():
        return default
    payload = {
        "system_instruction": {
            "parts": [{
                "text": (
                    "You convert a user's natural-language music request into a concise prompt for Lyria music generation. "
                    "Return strict JSON only with keys: prompt (string), bpm (integer 60-180), temperature (number 0.4-1.4). "
                    "Preserve requested genre/mood/instruments exactly when possible. "
                    "Build a STYLE-LOCK prompt with concrete instrumentation + rhythm so output doesn't drift. "
                    "If user asks electronic music, include synth bass, drum machine, arpeggiator, sidechain-like pumping feel. "
                    "If user asks jazz, include jazz harmony/swing/brush drums or upright bass where appropriate. "
                    "If user asks baroque/classical, include strings/harpsichord/counterpoint language."
                )
            }]
        },
        "contents": [{"parts": [{"text": seed_text}]}],
        "generationConfig": {"responseMimeType": "application/json"},
    }
    try:
        resp = call_gemini_generate_content(payload, model=CHAT_MODEL, timeout=20)
        obj = json.loads(extract_text_from_response(resp) or "{}")
        prompt = str(obj.get("prompt") or "").strip() or default["prompt"]
        bpm = int(obj.get("bpm") or default["bpm"])
        temperature = float(obj.get("temperature") or default["temperature"])
        bpm = max(60, min(180, bpm))
        temperature = max(0.4, min(1.4, temperature))
        return {"prompt": prompt, "bpm": bpm, "temperature": temperature}
    except Exception:
        return default


def generate_music_with_lyria(seed_text, duration_seconds=MUSIC_DURATION_SECONDS):
    gemini_api_key = get_gemini_api_key()
    if not gemini_api_key:
        raise RuntimeError("GOOGLE_API_KEY/GEMINI_API_KEY is not configured")

    async def _run():
        client = genai.Client(api_key=gemini_api_key, http_options={"api_version": "v1alpha"})
        pcm_chunks = []
        duration_seconds_clamped = max(4, min(int(duration_seconds), 30))
        plan = plan_music_request(seed_text)
        sample_rate = 48000
        channels = 2
        target_bytes = None
        async with client.aio.live.music.connect(model=MUSIC_MODEL) as session:
            await session.set_weighted_prompts(
                prompts=[
                    genai_types.WeightedPrompt(text=(plan["prompt"] or "instrumental electronic music"), weight=1.25),
                    genai_types.WeightedPrompt(
                        text="STYLE LOCK: follow requested genre/mood/instrumentation strictly; avoid unrelated style drift.",
                        weight=1.0,
                    ),
                    genai_types.WeightedPrompt(text="instrumental only, no spoken words, no vocal syllables", weight=0.45),
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
                audio_chunks = getattr(server_content, "audio_chunks", None) if server_content else None
                if not audio_chunks:
                    continue
                for chunk in audio_chunks:
                    data = getattr(chunk, "data", b"")
                    mime_type = (getattr(chunk, "mime_type", "") or "").lower()
                    match = re.search(r"rate=(\d+)", mime_type)
                    if match:
                        sample_rate = int(match.group(1))
                    match = re.search(r"channels=(\d+)", mime_type)
                    if match:
                        channels = int(match.group(1))
                    if target_bytes is None:
                        # Lyria currently returns PCM16 (L16), bytes_per_sample = 2.
                        target_bytes = sample_rate * channels * 2 * duration_seconds_clamped
                    if data:
                        pcm_chunks.append(data)
                if target_bytes and sum(len(c) for c in pcm_chunks) >= target_bytes:
                    break
        return b"".join(pcm_chunks), sample_rate, channels

    pcm_bytes, sample_rate, channels = asyncio.run(_run())
    if not pcm_bytes:
        raise RuntimeError("Lyria returned no audio chunks")
    return pcm16_to_wav_bytes(pcm_bytes, sample_rate=sample_rate, channels=channels)


def get_firestore_client():
    if os.path.exists(FIRESTORE_SA_PATH):
        creds = service_account.Credentials.from_service_account_file(FIRESTORE_SA_PATH)
        return firestore.Client(
            project=FIRESTORE_PROJECT_ID,
            credentials=creds,
            database=FIRESTORE_DATABASE_ID,
        )
    return firestore.Client(project=FIRESTORE_PROJECT_ID, database=FIRESTORE_DATABASE_ID)


def verify_google_credential(credential):
    return id_token.verify_oauth2_token(
        credential,
        google_requests.Request(),
        GOOGLE_CLIENT_ID,
    )


def is_valid_avatar_url(url):
    if not isinstance(url, str):
        return False
    value = url.strip()
    if not value or len(value) > 2048:
        return False
    return value.startswith("https://")


def normalize_google_avatar_url(url, size=256):
    value = (url or "").strip()
    if not value:
        return ""
    if not value.startswith("https://"):
        return ""
    # Common Google avatar format ends with `=s96-c`, normalize to `=s256-c`.
    if re.search(r"=s\d+-c$", value):
        return re.sub(r"=s\d+-c$", f"=s{size}-c", value)
    separator = "&" if "?" in value else "?"
    return f"{value}{separator}sz={size}"


def build_tester_user_id(email):
    key = (email or "").strip().lower().encode("utf-8")
    digest = hashlib.sha1(key).hexdigest()
    return f"tester_{digest[:24]}"


def sanitize_ai_settings(gender, voice, global_prompt):
    normalized_gender = (gender or "female").strip().lower()
    if normalized_gender not in ("female", "male"):
        normalized_gender = "female"

    voices = FEMALE_VOICES if normalized_gender == "female" else MALE_VOICES
    normalized_voice = (voice or "").strip()
    if normalized_voice not in voices:
        normalized_voice = "Achernar" if normalized_gender == "female" else "Achird"

    normalized_prompt = (global_prompt or "").strip() or AI_DEFAULT_GLOBAL_PROMPT
    return {
        "gender": normalized_gender,
        "voice": normalized_voice,
        "global_prompt": normalized_prompt,
    }


def get_user_ai_settings(user_id):
    settings = dict(DEFAULT_AI_SETTINGS)
    if not user_id:
        return settings

    try:
        client = get_firestore_client()
        doc = client.collection("users").document(user_id).get()
        if not doc.exists:
            return settings
        data = doc.to_dict() or {}
        normalized = sanitize_ai_settings(
            data.get("ai_gender"),
            data.get("ai_voice"),
            data.get("ai_global_prompt"),
        )
        settings.update(normalized)
    except Exception:
        # For chat continuity, default settings are used when Firestore fetch fails.
        return dict(DEFAULT_AI_SETTINGS)
    return settings


def get_user_history_range(user_id):
    if not user_id:
        return None
    try:
        client = get_firestore_client()
        doc = client.collection("users").document(user_id).get()
        if not doc.exists:
            return None
        data = doc.to_dict() or {}
        raw = data.get("history_range")
        if raw is None:
            return None
        value = int(raw)
        if value <= 0:
            return None
        return value
    except Exception:
        return None


def sanitize_history_range(raw_value, default_value=30):
    try:
        value = int(raw_value)
    except Exception:
        value = int(default_value)
    if value < 10:
        value = 10
    if value > 60:
        value = 60
    return value


def get_chat_messages(user_id, contact_id, history_range=None):
    if not user_id or not contact_id:
        return []
    client = get_firestore_client()
    coll = (
        client.collection("users")
        .document(user_id)
        .collection("chats")
        .document(contact_id)
        .collection("messages")
    )
    query = coll.order_by("created_at", direction=firestore.Query.DESCENDING)
    if history_range and history_range > 0:
        query = query.limit(history_range)
    docs = list(query.stream())
    docs.reverse()
    messages = []
    allowed_roles = {"user", "ai", "peer", "ai_proxy", "assist_user", "assist_ai"}
    for doc in docs:
        data = doc.to_dict() or {}
        text = (data.get("text") or "").strip()
        audio_url = (data.get("audio_url") or "").strip()
        image_url = (data.get("image_url") or "").strip()
        music_url = (data.get("music_url") or "").strip()
        role = (data.get("role") or "").strip()
        if (not text and not audio_url and not image_url and not music_url) or role not in allowed_roles:
            continue
        created_at = data.get("created_at")
        created_at_iso = ""
        if created_at is not None and hasattr(created_at, "isoformat"):
            created_at_iso = created_at.isoformat()
        messages.append(
            {
                "id": doc.id,
                "role": role,
                "text": text,
                "created_at": created_at_iso,
                "assist_group_id": (data.get("assist_group_id") or "").strip(),
                "visibility": (data.get("visibility") or "").strip() or "shared",
                "sender_mode": (data.get("sender_mode") or "").strip() or ("ai_proxy" if role == "ai_proxy" else "user"),
                "avatar_url": (data.get("avatar_url") or "").strip(),
                "audio_url": audio_url,
                "audio_duration_seconds": float(data.get("audio_duration_seconds") or 0),
                "image_url": image_url,
                "music_url": music_url,
            }
        )
    return messages


def save_chat_message(user_id, contact_id, role, text, extras=None):
    clean_text = (text or "").strip()
    allowed_roles = {"user", "ai", "peer", "ai_proxy", "assist_user", "assist_ai"}
    extras = extras if isinstance(extras, dict) else {}
    audio_url = (extras.get("audio_url") or "").strip()
    image_url = (extras.get("image_url") or "").strip()
    music_url = (extras.get("music_url") or "").strip()
    if not user_id or not contact_id or role not in allowed_roles or (not clean_text and not audio_url and not image_url and not music_url):
        return
    client = get_firestore_client()
    coll = (
        client.collection("users")
        .document(user_id)
        .collection("chats")
        .document(contact_id)
        .collection("messages")
    )
    payload = {
        "role": role,
        "text": clean_text,
        "created_at": firestore.SERVER_TIMESTAMP,
    }
    if extras:
        payload.update(extras)
    coll.add(payload)


def upsert_chat_meta(user_id, contact_id, unread_increment=0, force_unread_zero=False, preview_text=""):
    if not user_id or not contact_id:
        return
    client = get_firestore_client()
    ref = client.collection("users").document(user_id).collection("chat_meta").document(contact_id)
    payload = {
        "updated_at": firestore.SERVER_TIMESTAMP,
        "last_message_at": firestore.SERVER_TIMESTAMP,
    }
    if preview_text:
        payload["last_message_preview"] = (preview_text or "").strip()[:280]
    if force_unread_zero:
        payload["unread_count"] = 0
    elif unread_increment:
        payload["unread_count"] = firestore.Increment(int(unread_increment))
    ref.set(payload, merge=True)


def log_tool_error(user_id, contact_id, tool_name, stage, error_message, request_id="", input_snapshot=None):
    try:
        client = get_firestore_client()
        payload = {
            "user_id": user_id,
            "contact_id": contact_id,
            "tool": tool_name,
            "stage": stage,
            "status": "failed",
            "error_message": (error_message or "").strip()[:2000],
            "request_id": (request_id or "").strip(),
            "created_at": firestore.SERVER_TIMESTAMP,
        }
        if input_snapshot is not None:
            payload["input_snapshot"] = input_snapshot
        client.collection("err_log").add(payload)
    except Exception:
        # Never let log failures break user flow.
        return


def log_info_event(user_id, contact_id, tool_name, stage, message, request_id="", input_snapshot=None):
    try:
        client = get_firestore_client()
        payload = {
            "user_id": user_id,
            "contact_id": contact_id,
            "tool": tool_name,
            "stage": stage,
            "status": "info",
            "error_message": (message or "").strip()[:2000],
            "request_id": (request_id or "").strip(),
            "created_at": firestore.SERVER_TIMESTAMP,
        }
        if input_snapshot is not None:
            payload["input_snapshot"] = input_snapshot
        client.collection("err_log").add(payload)
    except Exception:
        return


def build_history_prompt(history_messages):
    if not history_messages:
        return "No previous conversation."
    lines = []
    for msg in history_messages:
        role = "User" if msg.get("role") == "user" else "Pisces AI"
        text = (msg.get("text") or "").strip()
        if not text:
            continue
        lines.append(f"{role}: {text}")
    return "\n".join(lines) if lines else "No previous conversation."


def build_live_system_prompt(user_id, contact_id):
    client = get_firestore_client()
    user_doc = client.collection("users").document(user_id).get()
    user_data = user_doc.to_dict() if user_doc.exists else {}
    user_name = (user_data.get("display_name") or user_data.get("email") or "User").strip()
    ai_name = (user_data.get("ai_name") or "Pisces").strip()
    ai_settings = get_user_ai_settings(user_id)
    global_prompt = (ai_settings.get("global_prompt") or AI_DEFAULT_GLOBAL_PROMPT).strip()
    ai_room = (contact_id or "pisces-core") == "pisces-core"

    if ai_room:
        return (
            f'Your name is "{ai_name}".\n'
            f'You are the AI assistant of "{user_name}".\n'
            f"Your speaking style is: {global_prompt}"
        )

    friend_ctx = get_friend_context(user_id, contact_id)
    receiver_name = (friend_ctx or {}).get("friend_name") or "Contact"
    return (
        f'Your name is "{ai_name}".\n'
        f'You are the AI assistant of "{user_name}".\n'
        f"Your speaking style is: {global_prompt}\n\n"
        f'You are currently helping "{user_name}" communicate with "{receiver_name}".\n'
        f'In this live call, you are speaking directly to "{user_name}" only.\n'
        f'Do not greet or address "{receiver_name}" directly unless "{user_name}" explicitly asks you to compose a message for "{receiver_name}".'
    )


def build_live_contents_context(user_id, contact_id):
    client = get_firestore_client()
    user_doc = client.collection("users").document(user_id).get()
    user_data = user_doc.to_dict() if user_doc.exists else {}
    user_name = (user_data.get("display_name") or user_data.get("email") or "User").strip()
    ai_name = (user_data.get("ai_name") or "Pisces").strip()
    history_range = get_user_history_range(user_id)
    ai_room = (contact_id or "pisces-core") == "pisces-core"

    if ai_room:
        history_messages = get_chat_messages(user_id, "pisces-core", history_range=history_range)
        lines = [
            f'The following conversation history is between "{user_name}" and "{ai_name}".',
            "Each line starts with the speaker name.",
        ]
        for msg in history_messages:
            role = (msg.get("role") or "").strip()
            text = (msg.get("text") or "").strip()
            if not text:
                continue
            if role == "user":
                speaker = user_name
            elif role == "ai":
                speaker = ai_name
            else:
                continue
            lines.append(f'{speaker}: {text}')
        return "\n".join(lines)

    friend_ctx = get_friend_context(user_id, contact_id)
    receiver_name = (friend_ctx or {}).get("friend_name") or "Contact"
    relationship = (friend_ctx or {}).get("relationship") or ""
    history_messages = get_chat_messages(user_id, contact_id, history_range=history_range)
    lines = [
        f'The following conversation history is between "{user_name}" and "{receiver_name}".',
        "Each line starts with the speaker name.",
    ]
    if relationship:
        lines.append(f'"{receiver_name}" is "{relationship}" to "{user_name}".')
    lines.append(
        f'Please understand tone, relationship, and context. Help "{user_name}" communicate with "{receiver_name}". '
        f'Do not treat this history as direct conversation between you and "{user_name}".'
    )
    lines.append(
        f'Important: during this live call, talk to "{user_name}" only. '
        f'Do not directly address "{receiver_name}" unless explicitly asked to draft or relay a message.'
    )
    for msg in history_messages:
        role = (msg.get("role") or "").strip()
        text = (msg.get("text") or "").strip()
        if not text:
            continue
        if role == "user":
            speaker = user_name
        elif role == "peer":
            speaker = receiver_name
        elif role == "ai_proxy":
            speaker = ai_name
        elif role == "ai":
            speaker = ai_name
        else:
            continue
        lines.append(f'{speaker}: {text}')
    return "\n".join(lines)


def get_allowed_origin():
    origin = (flask_request.headers.get("Origin") or "").strip()
    allowed = {
        "https://pisces-plum.vercel.app",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    }
    if origin in allowed:
        return origin
    return "https://pisces-plum.vercel.app"


def set_user_session(user):
    session.clear()
    session["user_id"] = user.get("id") or ""
    session["provider"] = user.get("provider") or ""
    session["email"] = user.get("email") or ""


def get_session_auth(required=True):
    user_id = (session.get("user_id") or "").strip()
    provider = (session.get("provider") or "").strip().lower()
    email = (session.get("email") or "").strip().lower()
    if required and not user_id:
        return None, ({"ok": False, "error": "unauthorized"}, 401)
    return {"user_id": user_id, "provider": provider, "email": email}, None


def generate_gemini_reply(user_message, ai_settings, history_messages, extra_context_text=""):
    global_prompt = ai_settings.get("global_prompt") or AI_DEFAULT_GLOBAL_PROMPT
    voice_name = ai_settings.get("voice") or DEFAULT_AI_SETTINGS["voice"]
    decision = build_chat_tool_decision(user_message, global_prompt, history_messages, extra_context_text=extra_context_text)
    reply_text = decision["reply"]
    audio_b64 = ""
    audio_mime_type = ""

    if decision["should_read_aloud"]:
        try:
            audio_b64, audio_mime_type = synthesize_tts_audio(
                reply_text,
                decision["language"],
                voice_name,
                decision.get("tone_prompt") or "",
            )
        except Exception as exc:
            # TTS failure should not block text response.
            decision["reason"] = f"tts_failed: {exc}"

    return {
        "reply": reply_text,
        "audio_base64": audio_b64,
        "audio_mime_type": audio_mime_type,
        "tts": {
            "should_read_aloud": decision["should_read_aloud"] and bool(audio_b64),
            "language": decision["language"],
            "tone_prompt": decision.get("tone_prompt") or "",
            "reason": decision["reason"],
        },
    }


def get_friend_context(user_id, contact_id):
    client = get_firestore_client()
    user_a_id, user_b_id = sorted([user_id, contact_id])
    pair_key = f"{user_a_id}_{user_b_id}"
    doc = client.collection("friendships").document(pair_key).get()
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    if (data.get("status") or "").strip() != "accepted":
        return None
    is_a = user_id == user_a_id
    special_prompt = (data.get("special_prompt_for_a") or "").strip() if is_a else (data.get("special_prompt_for_b") or "").strip()
    relationship = (data.get("relationship_for_a") or "").strip() if is_a else (data.get("relationship_for_b") or "").strip()
    # Use requester's own alias field for this friend:
    # requester=user_a -> alias_for_a, requester=user_b -> alias_for_b
    friend_alias = (data.get("alias_for_a") or "").strip() if is_a else (data.get("alias_for_b") or "").strip()
    friend_display = (data.get("user_b_display_name") or "").strip() if is_a else (data.get("user_a_display_name") or "").strip()
    return {
        "pair_key": pair_key,
        "special_prompt": special_prompt,
        "relationship": relationship,
        "friend_name": friend_alias or friend_display or "friend",
    }


def decide_assist_action(user_message, history_messages, friend_name):
    instruction = (
        "You are Pisces AI function_arrange planner inside a friend chat window. "
        "Return strict JSON only with keys: "
        "send_to_friend (boolean), voice (boolean), reply_to_user (string). "
        "Rules: "
        "1) If user asks you to help tell/ask/send something to the current friend, set send_to_friend=true. "
        "2) Otherwise set send_to_friend=false and provide direct advice in reply_to_user. "
        "3) voice=true only when user asks read aloud/say/speak. "
        "4) In this friend-chat window, pronouns like he/she/him/her/they or 他/她/他們 refer to the current friend by default. "
        "5) Do not include markdown code fences."
    )
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": instruction},
                    {"text": f"Current friend: {friend_name}"},
                    {"text": f"Conversation history:\n{build_history_prompt(history_messages)}"},
                    {"text": f"User message:\n{user_message}"},
                ]
            }
        ]
    }
    data = call_gemini_generate_content(payload, model=CHAT_MODEL)
    raw = extract_text_from_response(data)
    obj = extract_json_obj(raw)
    send_to_friend = bool(obj.get("send_to_friend"))
    voice = bool(obj.get("voice"))
    reply_to_user = str(obj.get("reply_to_user") or "").strip()
    if not reply_to_user:
        reply_to_user = "Done."
    return {
        "send_to_friend": send_to_friend,
        "voice": voice,
        "reply_to_user": reply_to_user,
    }


def decide_media_tools(user_message, history_messages):
    instruction = (
        "You are a tool planner. Return strict JSON only with keys: "
        "draw_image (boolean), create_music (boolean). "
        "Infer intent semantically across languages (Chinese/English/Japanese/etc.). "
        "Set draw_image=true only when the user asks to create/generate/draw an image/visual. "
        "Set create_music=true only when the user asks to compose/generate music/song/track/instrumental."
    )
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": instruction},
                    {"text": f"Conversation history:\n{build_history_prompt(history_messages)}"},
                    {"text": f"User message:\n{user_message}"},
                ]
            }
        ]
    }
    try:
        data = call_gemini_generate_content(payload, model=CHAT_MODEL)
        raw = extract_text_from_response(data)
        obj = extract_json_obj(raw)
        return {
            "draw_image": bool(obj.get("draw_image")),
            "create_music": bool(obj.get("create_music")),
        }
    except Exception:
        return {
            "draw_image": False,
            "create_music": False,
        }


def compose_message_for_friend(
    user_message,
    history_messages,
    user_name,
    friend_name,
    ai_name,
    style_prompt,
    relationship="",
):
    relationship_line = (
        f'"{friend_name}" is "{relationship}" to "{user_name}". You should adapt tone with this relationship.'
        if relationship
        else ""
    )
    instruction = (
        "Return strict JSON only with keys: as_user (boolean), message_to_friend (string). "
        f'Your name is "{ai_name}". '
        f'You are the AI assistant of "{user_name}". '
        f'Your speaking style is: {style_prompt}. '
        f'Now "{user_name}" wants you to send a message to "{friend_name}". '
        f"{relationship_line} "
        f'If "{user_name}" did NOT explicitly ask to send in their own name, use third-person delivery to "{friend_name}". '
        f'If "{user_name}" explicitly asks to send in their own name, use first-person. '
        "Do not include markdown code fences."
    )
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": instruction},
                    {"text": f"Conversation history:\n{build_history_prompt(history_messages)}"},
                    {"text": f"User message:\n{user_message}"},
                ]
            }
        ]
    }
    data = call_gemini_generate_content(payload, model=CHAT_MODEL)
    raw = extract_text_from_response(data)
    obj = extract_json_obj(raw)
    message = str(obj.get("message_to_friend") or "").strip()
    as_user = bool(obj.get("as_user"))
    if not message:
        message = normalize_friend_outbound_text(user_message, friend_name)
    return {
        "as_user": as_user,
        "message_to_friend": message,
    }


def sanitize_forward_message_text(user_message, outbound_text, friend_name):
    text = (outbound_text or "").strip()
    clean_from_user = normalize_friend_outbound_text(user_message, friend_name).strip()
    if not text:
        return clean_from_user

    # Guardrail: if model returns command-like phrasing, prefer cleaned user intent text.
    command_like_patterns = [
        r"^\s*幫我",
        r"^\s*請",
        r"^\s*(跟|向).+(說|問|告訴)",
        r"^\s*告訴",
        r"^\s*tell\s+",
        r"^\s*ask\s+",
        r"^\s*help me\s+",
    ]
    is_command_like = any(re.search(p, text, flags=re.IGNORECASE) for p in command_like_patterns)
    if is_command_like and clean_from_user:
        return clean_from_user
    return text


def transcribe_audio_bytes(audio_bytes, mime_type):
    speech_client = speech.SpeechClient()
    mime = (mime_type or "").lower()

    config_kwargs = {
        "language_code": "zh-TW",
        "alternative_language_codes": ["en-US"],
        "enable_automatic_punctuation": True,
        "audio_channel_count": 1,
    }
    if "ogg" in mime:
        config_kwargs["encoding"] = speech.RecognitionConfig.AudioEncoding.OGG_OPUS
        # Opus requires explicit supported sample rates for stable recognition.
        config_kwargs["sample_rate_hertz"] = 48000
    elif "wav" in mime or "wave" in mime:
        config_kwargs["encoding"] = speech.RecognitionConfig.AudioEncoding.LINEAR16
    elif "webm" in mime:
        config_kwargs["encoding"] = speech.RecognitionConfig.AudioEncoding.WEBM_OPUS
        config_kwargs["sample_rate_hertz"] = 48000
    else:
        # Browser recorder is usually Opus in WebM/Ogg for this app.
        config_kwargs["encoding"] = speech.RecognitionConfig.AudioEncoding.WEBM_OPUS
        config_kwargs["sample_rate_hertz"] = 48000

    config = speech.RecognitionConfig(**config_kwargs)
    audio = speech.RecognitionAudio(content=audio_bytes)
    response = speech_client.recognize(config=config, audio=audio)

    transcripts = []
    for result in response.results:
        if result.alternatives:
            text = (result.alternatives[0].transcript or "").strip()
            if text:
                transcripts.append(text)
    return " ".join(transcripts).strip()


@app.route("/api/speech/transcribe", methods=["POST", "OPTIONS"])
def speech_transcribe():
    if flask_request.method == "OPTIONS":
        return ("", 204)

    auth, auth_error = get_session_auth(required=True)
    if auth_error:
        err, status = auth_error
        return jsonify(err), status

    body = flask_request.get_json(silent=True) or {}
    audio_b64 = (body.get("audio_base64") or "").strip()
    mime_type = (body.get("mime_type") or "audio/webm").strip()
    if not audio_b64:
        return jsonify({"ok": False, "error": "audio_base64 is required"}), 400

    try:
        audio_bytes = base64.b64decode(audio_b64)
    except Exception:
        return jsonify({"ok": False, "error": "invalid base64 audio payload"}), 400

    try:
        transcript = transcribe_audio_bytes(audio_bytes, mime_type)
    except Exception as exc:
        return jsonify({"ok": False, "error": f"speech-to-text failed: {exc}"}), 502

    if not transcript:
        return jsonify({"ok": False, "error": "speech-to-text returned empty transcript"}), 422

    return jsonify({"ok": True, "transcript": transcript})


@app.route("/")
def hello():
    return "Hello Pisces!"


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = get_allowed_origin()
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Credentials"] = "true"
    response.headers["Vary"] = "Origin"
    return response


@app.route("/api/chat", methods=["POST", "OPTIONS"])
def chat():
    if flask_request.method == "OPTIONS":
        return ("", 204)

    body = flask_request.get_json(silent=True) or {}
    user_message = (body.get("message") or "").strip()
    auth, _ = get_session_auth(required=False)
    user_id = (auth or {}).get("user_id") or (body.get("user_id") or "").strip()
    contact_id = (body.get("contact_id") or "pisces-core").strip() or "pisces-core"
    if not user_message:
        return jsonify({"error": "message is required"}), 400

    if contact_id == "pisces-core" and has_forward_intent_in_ai_room(user_message):
        if not user_id:
            return jsonify({"error": "Please sign in first."}), 401
        friend = find_friend_from_message(user_id, user_message)
        if not friend:
            reply = "Sorry, I couldn't find the contact name you mentioned. Please include an exact friend name."
            try:
                save_chat_message(user_id, contact_id, "user", user_message)
                save_chat_message(user_id, contact_id, "ai", reply)
            except Exception:
                pass
            return jsonify({"reply": reply, "audio_base64": "", "audio_mime_type": "", "tts": {"should_read_aloud": False}})

        target_id = friend["id"]
        friend_ctx = get_friend_context(user_id, target_id)
        if not friend_ctx:
            reply = "Sorry, I couldn't find that contact in your friend list."
            try:
                save_chat_message(user_id, contact_id, "user", user_message)
                save_chat_message(user_id, contact_id, "ai", reply)
            except Exception:
                pass
            return jsonify({"reply": reply, "audio_base64": "", "audio_mime_type": "", "tts": {"should_read_aloud": False}})

        user_doc = get_firestore_client().collection("users").document(user_id).get()
        user_data = user_doc.to_dict() if user_doc.exists else {}
        ai_settings = get_user_ai_settings(user_id)
        history_range = get_user_history_range(user_id)
        friend_history = get_chat_messages(user_id, target_id, history_range=history_range)
        decision = decide_assist_action(user_message, friend_history, friend_ctx["friend_name"])
        media_tools = decide_media_tools(user_message, friend_history)
        if has_explicit_voice_request(user_message):
            decision["voice"] = True
        style_prompt = friend_ctx["special_prompt"] or ai_settings.get("global_prompt") or AI_DEFAULT_GLOBAL_PROMPT
        composed = compose_message_for_friend(
            user_message=user_message,
            history_messages=friend_history,
            user_name=(user_data.get("display_name") or user_data.get("email") or "User"),
            friend_name=friend_ctx["friend_name"],
            ai_name=(user_data.get("ai_name") or "Pisces"),
            style_prompt=style_prompt,
            relationship=friend_ctx.get("relationship") or "",
        )
        composed_as_user = bool(composed.get("as_user"))
        # Compose stage decides first/third person, but explicit phrase still overrides.
        if has_explicit_send_as_user_intent(user_message):
            composed_as_user = True
        outbound_text = sanitize_forward_message_text(
            user_message=user_message,
            outbound_text=(composed.get("message_to_friend") or "").strip() or (decision.get("reply_to_user") or "").strip(),
            friend_name=friend_ctx["friend_name"],
        )
        if media_tools.get("create_music") and not has_lyrics_request(user_message):
            if composed_as_user:
                outbound_text = "I made a song for you. Hope you like it."
            else:
                sender_name = (user_data.get("display_name") or user_data.get("email") or "your friend").strip()
                outbound_text = f'{sender_name} made a song for you. Hope you like it.'
        outbound_image_url = ""
        outbound_music_url = ""
        if media_tools.get("draw_image"):
            try:
                image_bytes, image_mime = generate_image_with_gemini(user_message)
                outbound_image_url = upload_image_to_vercel_blob(user_id, image_bytes, image_mime or "image/png")
            except Exception as exc:
                log_tool_error(user_id, target_id, "draw_image", "chat_ai_room_forward_send", str(exc), input_snapshot={"message": user_message})
        if media_tools.get("create_music"):
            try:
                music_seed = user_message
                if has_lyrics_request(user_message) and outbound_text:
                    music_seed = (
                        f"{user_message}\n\n"
                        f"Lyrics/theme reference (instrumental mood guide only):\n{outbound_text}"
                    )
                music_bytes = generate_music_with_lyria(music_seed)
                outbound_music_url = upload_audio_to_vercel_blob(user_id, music_bytes, "audio/wav")
            except Exception as exc:
                log_tool_error(user_id, target_id, "create_music", "chat_ai_room_forward_send", str(exc), input_snapshot={"message": user_message})
        sender_mode = "user" if composed_as_user else "ai_proxy"
        sender_avatar_url = (
            (user_data.get("avatar_url") or "").strip()
            if sender_mode == "user"
            else (user_data.get("ai_avatar_url") or "").strip() or "/images/fish.png"
        )
        outbound_audio_url = ""
        if decision.get("voice"):
            zh_len = count_zh_chars(outbound_text)
            en_words = count_en_words(outbound_text)
            if zh_len <= 100 and en_words <= 50:
                try:
                    locale = "en-US" if en_words > 0 and zh_len == 0 else "zh-TW"
                    audio_b64_tmp, audio_mime_tmp = synthesize_tts_audio(
                        outbound_text,
                        locale,
                        ai_settings.get("voice") or DEFAULT_AI_SETTINGS["voice"],
                        "warm and caring" if locale == "en-US" else "溫柔且貼心",
                    )
                    outbound_audio_url = upload_audio_to_vercel_blob(
                        user_id,
                        base64.b64decode(audio_b64_tmp),
                        audio_mime_tmp or "audio/wav",
                    )
                except Exception as exc:
                    log_tool_error(
                        user_id,
                        target_id,
                        "text_to_speech",
                        "chat_ai_room_forward_send",
                        str(exc),
                        input_snapshot={"text": outbound_text},
                    )
        try:
            save_chat_message(
                user_id,
                target_id,
                "user" if sender_mode == "user" else "ai_proxy",
                outbound_text,
                extras={
                    "visibility": "shared",
                    "sender_mode": sender_mode,
                    "avatar_url": sender_avatar_url,
                    **({"audio_url": outbound_audio_url} if outbound_audio_url else {}),
                    **({"image_url": outbound_image_url} if outbound_image_url else {}),
                    **({"music_url": outbound_music_url} if outbound_music_url else {}),
                },
            )
            save_chat_message(
                target_id,
                user_id,
                "peer",
                outbound_text,
                extras={
                    "visibility": "shared",
                    "sender_mode": sender_mode,
                    "avatar_url": sender_avatar_url,
                    **({"audio_url": outbound_audio_url} if outbound_audio_url else {}),
                    **({"image_url": outbound_image_url} if outbound_image_url else {}),
                    **({"music_url": outbound_music_url} if outbound_music_url else {}),
                },
            )
            upsert_chat_meta(user_id, target_id, unread_increment=0, preview_text=outbound_text)
            upsert_chat_meta(target_id, user_id, unread_increment=1, preview_text=outbound_text)
            payload = {
                "message_id": str(uuid.uuid4()),
                "sender_user_id": user_id,
                "recipient_user_id": target_id,
                "text": outbound_text,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "sender_display_name": (user_data.get("display_name") or ""),
                "sender_avatar_url": sender_avatar_url,
                "sender_mode": sender_mode,
                "audio_url": outbound_audio_url,
                "image_url": outbound_image_url,
                "music_url": outbound_music_url,
            }
            publish_user_channel_message(target_id, payload)
        except Exception as exc:
            log_tool_error(user_id, target_id, "send_msg", "chat_ai_room_forward", str(exc), input_snapshot={"text": outbound_text})
            reply = "Sorry, I couldn't deliver the message right now."
            try:
                save_chat_message(user_id, contact_id, "user", user_message)
                save_chat_message(user_id, contact_id, "ai", reply)
            except Exception:
                pass
            return jsonify({"reply": reply, "audio_base64": "", "audio_mime_type": "", "tts": {"should_read_aloud": False}})

        reply = f"Done. I sent your message to {friend_ctx['friend_name']}."
        audio_b64 = ""
        audio_mime = ""
        if has_explicit_voice_request(user_message):
            try:
                zh_len = count_zh_chars(reply)
                en_words = count_en_words(reply)
                if zh_len <= 100 and en_words <= 50:
                    locale = "en-US" if en_words > 0 and zh_len == 0 else "zh-TW"
                    audio_b64, audio_mime = synthesize_tts_audio(reply, locale, ai_settings.get("voice") or DEFAULT_AI_SETTINGS["voice"])
            except Exception as exc:
                log_tool_error(user_id, target_id, "text_to_speech", "chat_ai_room_forward", str(exc), input_snapshot={"text": reply})
        try:
            save_chat_message(user_id, contact_id, "user", user_message)
            save_chat_message(user_id, contact_id, "ai", reply)
        except Exception:
            pass
        return jsonify({"reply": reply, "audio_base64": audio_b64, "audio_mime_type": audio_mime, "tts": {"should_read_aloud": bool(audio_b64)}})

    ai_settings = get_user_ai_settings(user_id)
    history_range = get_user_history_range(user_id)
    history_messages = get_chat_messages(user_id, contact_id, history_range=history_range)
    extra_context_text = ""
    if user_id and contact_id == "pisces-core":
        user_doc = get_firestore_client().collection("users").document(user_id).get()
        user_data = user_doc.to_dict() if user_doc.exists else {}
        user_name = (user_data.get("display_name") or user_data.get("email") or "User").strip()
        about_plan = decide_about_friend(user_message)
        if about_plan.get("call_about_friend") and (about_plan.get("name") or "").strip():
            about_result = about_friend(user_id, about_plan.get("name"), history_range)
            extra_context_text = build_about_friend_context(user_name, about_result)
    try:
        chat_result = generate_gemini_reply(
            user_message,
            ai_settings,
            history_messages,
            extra_context_text=extra_context_text,
        )
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502

    if user_id:
        media_tools = decide_media_tools(user_message, history_messages)
        want_image = bool(media_tools.get("draw_image"))
        want_music = bool(media_tools.get("create_music"))
        image_url = ""
        music_url = ""
        image_error = ""
        music_error = ""
        if want_image:
            try:
                image_bytes, image_mime = generate_image_with_gemini(user_message)
                image_url = upload_image_to_vercel_blob(user_id, image_bytes, image_mime or "image/png")
            except Exception as exc:
                image_error = str(exc)
                log_tool_error(user_id, contact_id, "draw_image", "chat", str(exc), input_snapshot={"message": user_message})
        if want_music:
            try:
                music_bytes = generate_music_with_lyria(user_message)
                music_url = upload_audio_to_vercel_blob(user_id, music_bytes, "audio/wav")
            except Exception as exc:
                music_error = str(exc)
                log_tool_error(user_id, contact_id, "create_music", "chat", str(exc), input_snapshot={"message": user_message})
        if want_image or want_music:
            status_reply = build_tool_status_reply(want_image, want_music, image_url, music_url, image_error, music_error)
            if status_reply:
                chat_result["reply"] = status_reply
                chat_result["audio_base64"] = ""
                chat_result["audio_mime_type"] = ""
                chat_result["tts"] = {"should_read_aloud": False}
        try:
            save_chat_message(user_id, contact_id, "user", user_message)
            save_chat_message(
                user_id,
                contact_id,
                "ai",
                chat_result.get("reply") or "",
                extras={
                    **({"image_url": image_url} if image_url else {}),
                    **({"music_url": music_url} if music_url else {}),
                },
            )
        except Exception:
            pass
        chat_result["image_url"] = image_url
        chat_result["music_url"] = music_url

    return jsonify(chat_result)


@app.route("/api/voice-chat", methods=["POST", "OPTIONS"])
def voice_chat():
    if flask_request.method == "OPTIONS":
        return ("", 204)

    body = flask_request.get_json(silent=True) or {}
    audio_b64 = (body.get("audio_base64") or "").strip()
    mime_type = (body.get("mime_type") or "audio/webm").strip()
    auth, _ = get_session_auth(required=False)
    user_id = (auth or {}).get("user_id") or (body.get("user_id") or "").strip()
    contact_id = (body.get("contact_id") or "pisces-core").strip() or "pisces-core"
    if not audio_b64:
        return jsonify({"error": "audio_base64 is required"}), 400

    try:
        audio_bytes = base64.b64decode(audio_b64)
    except Exception:
        return jsonify({"error": "invalid base64 audio payload"}), 400

    try:
        transcript = transcribe_audio_bytes(audio_bytes, mime_type)
    except Exception as exc:
        return jsonify({"error": f"speech-to-text failed: {exc}"}), 502

    if not transcript:
        return jsonify({"error": "speech-to-text returned empty transcript"}), 422

    ai_settings = get_user_ai_settings(user_id)
    history_range = get_user_history_range(user_id)
    history_messages = get_chat_messages(user_id, contact_id, history_range=history_range)
    extra_context_text = ""
    if user_id and contact_id == "pisces-core":
        user_doc = get_firestore_client().collection("users").document(user_id).get()
        user_data = user_doc.to_dict() if user_doc.exists else {}
        user_name = (user_data.get("display_name") or user_data.get("email") or "User").strip()
        about_plan = decide_about_friend(transcript)
        if about_plan.get("call_about_friend") and (about_plan.get("name") or "").strip():
            about_result = about_friend(user_id, about_plan.get("name"), history_range)
            extra_context_text = build_about_friend_context(user_name, about_result)
    try:
        chat_result = generate_gemini_reply(
            transcript,
            ai_settings,
            history_messages,
            extra_context_text=extra_context_text,
        )
    except Exception as exc:
        return jsonify({"error": str(exc), "transcript": transcript}), 502

    if user_id:
        media_tools = decide_media_tools(transcript, history_messages)
        want_image = bool(media_tools.get("draw_image"))
        want_music = bool(media_tools.get("create_music"))
        image_url = ""
        music_url = ""
        image_error = ""
        music_error = ""
        if want_image:
            try:
                image_bytes, image_mime = generate_image_with_gemini(transcript)
                image_url = upload_image_to_vercel_blob(user_id, image_bytes, image_mime or "image/png")
            except Exception as exc:
                image_error = str(exc)
                log_tool_error(user_id, contact_id, "draw_image", "voice_chat", str(exc), input_snapshot={"transcript": transcript})
        if want_music:
            try:
                music_bytes = generate_music_with_lyria(transcript)
                music_url = upload_audio_to_vercel_blob(user_id, music_bytes, "audio/wav")
            except Exception as exc:
                music_error = str(exc)
                log_tool_error(user_id, contact_id, "create_music", "voice_chat", str(exc), input_snapshot={"transcript": transcript})
        if want_image or want_music:
            status_reply = build_tool_status_reply(want_image, want_music, image_url, music_url, image_error, music_error)
            if status_reply:
                chat_result["reply"] = status_reply
                chat_result["audio_base64"] = ""
                chat_result["audio_mime_type"] = ""
                chat_result["tts"] = {"should_read_aloud": False}
        try:
            save_chat_message(user_id, contact_id, "user", transcript)
            save_chat_message(
                user_id,
                contact_id,
                "ai",
                chat_result.get("reply") or "",
                extras={
                    **({"image_url": image_url} if image_url else {}),
                    **({"music_url": music_url} if music_url else {}),
                },
            )
        except Exception:
            pass
        chat_result["image_url"] = image_url
        chat_result["music_url"] = music_url

    return jsonify({"transcript": transcript, **chat_result})


@app.route("/api/chat/history", methods=["POST", "OPTIONS"])
def chat_history():
    if flask_request.method == "OPTIONS":
        return ("", 204)

    body = flask_request.get_json(silent=True) or {}
    auth, auth_error = get_session_auth(required=True)
    if auth_error:
        err, status = auth_error
        return jsonify(err), status
    user_id = auth["user_id"]
    contact_id = (body.get("contact_id") or "pisces-core").strip() or "pisces-core"

    try:
        messages = get_chat_messages(user_id, contact_id, history_range=None)
    except Exception as exc:
        return jsonify({"ok": False, "error": f"failed to load history: {exc}"}), 500

    return jsonify({"ok": True, "messages": messages})


@app.route("/api/firestore-test", methods=["GET", "OPTIONS"])
def firestore_test():
    if flask_request.method == "OPTIONS":
        return ("", 204)

    try:
        client = get_firestore_client()
        docs = list(client.collection("users").limit(5).stream())
        users = [{"id": d.id, "data": d.to_dict()} for d in docs]
        return jsonify(
            {
                "ok": True,
                "project": FIRESTORE_PROJECT_ID,
                "database": FIRESTORE_DATABASE_ID,
                "users_count": len(users),
                "users": users,
            }
        )
    except Exception as exc:
        return (
            jsonify(
                {
                    "ok": False,
                    "project": FIRESTORE_PROJECT_ID,
                    "database": FIRESTORE_DATABASE_ID,
                    "error": str(exc),
                }
            ),
            500,
        )


@app.route("/api/auth/google", methods=["POST", "OPTIONS"])
def auth_google():
    if flask_request.method == "OPTIONS":
        return ("", 204)

    body = flask_request.get_json(silent=True) or {}
    credential = (body.get("credential") or "").strip()
    if not credential:
        return jsonify({"ok": False, "error": "credential is required"}), 400

    try:
        token_info = verify_google_credential(credential)
    except Exception as exc:
        return jsonify({"ok": False, "error": f"invalid google credential: {exc}"}), 401

    user_id = token_info.get("sub")
    email = token_info.get("email")
    display_name = token_info.get("name") or email or "User"
    email_verified = bool(token_info.get("email_verified"))
    google_avatar_url = normalize_google_avatar_url(token_info.get("picture") or "", size=256)

    if not user_id or not email:
        return jsonify({"ok": False, "error": "google token missing sub/email"}), 401

    try:
        client = get_firestore_client()
        user_ref = client.collection("users").document(user_id)
        existing = user_ref.get()
        existing_data = existing.to_dict() if existing.exists else {}
        payload = {
            "display_name": display_name,
            "email": email,
            "email_verified": email_verified,
            "provider": "google",
            "updated_at": firestore.SERVER_TIMESTAMP,
        }
        if google_avatar_url:
            payload["avatar_url"] = google_avatar_url
        if not existing.exists:
            payload["created_at"] = firestore.SERVER_TIMESTAMP

        user_ref.set(payload, merge=True)
        ai_settings = sanitize_ai_settings(
            existing_data.get("ai_gender"),
            existing_data.get("ai_voice"),
            existing_data.get("ai_global_prompt"),
        )
        ai_avatar_url = (existing_data or {}).get("ai_avatar_url", "")
        history_range = sanitize_history_range((existing_data or {}).get("history_range", 30))
    except Exception as exc:
        return jsonify({"ok": False, "error": f"failed to save user: {exc}"}), 500

    user = {
        "id": user_id,
        "display_name": display_name,
        "email": email,
        "email_verified": email_verified,
        "provider": "google",
        "ai_avatar_url": ai_avatar_url,
        "avatar_url": google_avatar_url or (existing_data or {}).get("avatar_url", ""),
        "identify_code": (existing_data or {}).get("identify_code", ""),
        "ai_settings": ai_settings,
        "history_range": history_range,
    }
    set_user_session(user)
    return jsonify({"ok": True, "user": user})


@app.route("/api/auth/tester", methods=["POST", "OPTIONS"])
def auth_tester():
    if flask_request.method == "OPTIONS":
        return ("", 204)

    body = flask_request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    avatar_url = (body.get("avatar_url") or "").strip()

    if not email:
        return jsonify({"ok": False, "error": "email is required"}), 400
    if "@" not in email:
        return jsonify({"ok": False, "error": "email format is invalid"}), 400
    if avatar_url and not is_valid_avatar_url(avatar_url):
        return jsonify({"ok": False, "error": "avatar_url must be a valid https URL"}), 400

    user_id = build_tester_user_id(email)
    display_name = email.split("@", 1)[0] or "tester"

    try:
        client = get_firestore_client()
        user_ref = client.collection("users").document(user_id)
        existing = user_ref.get()
        existing_data = existing.to_dict() if existing.exists else {}
        existing_ai_avatar = (existing_data.get("ai_avatar_url") or "").strip() or "/images/fish.png"
        payload = {
            "display_name": existing_data.get("display_name") or display_name,
            "email": email,
            "email_verified": True,
            "provider": "tester",
            "updated_at": firestore.SERVER_TIMESTAMP,
            "ai_avatar_url": existing_ai_avatar,
        }
        if avatar_url:
            payload["avatar_url"] = avatar_url
        if not existing.exists:
            payload["created_at"] = firestore.SERVER_TIMESTAMP
        user_ref.set(payload, merge=True)

        ai_settings = sanitize_ai_settings(
            existing_data.get("ai_gender"),
            existing_data.get("ai_voice"),
            existing_data.get("ai_global_prompt"),
        )
        ai_avatar_url = existing_ai_avatar
        user_avatar_url = avatar_url or (existing_data.get("avatar_url") or "")
        history_range = sanitize_history_range((existing_data or {}).get("history_range", 30))
    except Exception as exc:
        return jsonify({"ok": False, "error": f"failed to save tester user: {exc}"}), 500

    user = {
        "id": user_id,
        "display_name": payload["display_name"],
        "email": email,
        "email_verified": True,
        "provider": "tester",
        "ai_avatar_url": ai_avatar_url,
        "avatar_url": user_avatar_url,
        "identify_code": (existing_data or {}).get("identify_code", ""),
        "ai_settings": ai_settings,
        "history_range": history_range,
    }
    set_user_session(user)
    return jsonify({"ok": True, "user": user})


@app.route("/api/session/me", methods=["GET", "OPTIONS"])
def session_me():
    if flask_request.method == "OPTIONS":
        return ("", 204)
    auth, auth_error = get_session_auth(required=False)
    if auth_error:
        return auth_error
    user_id = auth["user_id"]
    if not user_id:
        return jsonify({"ok": True, "authenticated": False, "user": None})
    try:
        client = get_firestore_client()
        doc = client.collection("users").document(user_id).get()
        if not doc.exists:
            session.clear()
            return jsonify({"ok": True, "authenticated": False, "user": None})
        data = doc.to_dict() or {}
        user = {
            "id": user_id,
            "email": data.get("email", ""),
            "display_name": data.get("display_name", ""),
            "provider": data.get("provider", auth.get("provider", "")),
            "avatar_url": data.get("avatar_url", ""),
            "ai_avatar_url": data.get("ai_avatar_url", ""),
            "ai_settings": sanitize_ai_settings(
                data.get("ai_gender"),
                data.get("ai_voice"),
                data.get("ai_global_prompt"),
            ),
            "identify_code": data.get("identify_code", ""),
            "history_range": sanitize_history_range(data.get("history_range", 30)),
        }
        set_user_session(user)
        return jsonify({"ok": True, "authenticated": True, "user": user})
    except Exception as exc:
        return jsonify({"ok": False, "error": f"failed to load session user: {exc}"}), 500


@app.route("/api/auth/logout", methods=["POST", "OPTIONS"])
def auth_logout():
    if flask_request.method == "OPTIONS":
        return ("", 204)
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/user/ai-settings", methods=["POST", "OPTIONS"])
def update_ai_settings():
    if flask_request.method == "OPTIONS":
        return ("", 204)

    body = flask_request.get_json(silent=True) or {}
    auth, auth_error = get_session_auth(required=True)
    if auth_error:
        err, status = auth_error
        return jsonify(err), status
    user_id = auth["user_id"]
    avatar_url = (body.get("avatar_url") or "").strip()
    avatar_image_base64 = (body.get("avatar_image_base64") or "").strip()
    avatar_mime_type = (body.get("avatar_mime_type") or "image/webp").strip()
    gender = (body.get("gender") or "").strip()
    voice = (body.get("voice") or "").strip()
    global_prompt = (body.get("global_prompt") or "").strip()

    if avatar_url and not is_valid_avatar_url(avatar_url):
        return jsonify({"ok": False, "error": "avatar_url must be a valid https URL"}), 400

    target_user_id = user_id

    normalized = sanitize_ai_settings(gender, voice, global_prompt)
    try:
        client = get_firestore_client()
        user_ref = client.collection("users").document(target_user_id)
        existing = user_ref.get()
        existing_data = existing.to_dict() if existing.exists else {}
        uploaded_avatar_url = ""
        if avatar_image_base64:
            try:
                avatar_bytes = base64.b64decode(avatar_image_base64)
            except Exception:
                return jsonify({"ok": False, "error": "avatar_image_base64 is invalid"}), 400
            uploaded_avatar_url = upload_avatar_to_vercel_blob(
                target_user_id,
                avatar_bytes,
                mime_type=avatar_mime_type or "image/webp",
            )
        payload = {
            "ai_gender": normalized["gender"],
            "ai_voice": normalized["voice"],
            "ai_global_prompt": normalized["global_prompt"],
            "updated_at": firestore.SERVER_TIMESTAMP,
        }
        if uploaded_avatar_url:
            payload["ai_avatar_url"] = uploaded_avatar_url
        elif avatar_url:
            payload["ai_avatar_url"] = avatar_url
        user_ref.set(payload, merge=True)
    except Exception as exc:
        return jsonify({"ok": False, "error": f"failed to update ai settings: {exc}"}), 500

    next_ai_avatar = uploaded_avatar_url or avatar_url or (existing_data.get("ai_avatar_url") or "")
    return jsonify(
        {
            "ok": True,
            "user": {
                "id": target_user_id,
                "ai_avatar_url": next_ai_avatar,
                "ai_settings": normalized,
            },
        }
    )


@app.route("/api/user/settings", methods=["POST", "OPTIONS"])
def update_user_settings():
    if flask_request.method == "OPTIONS":
        return ("", 204)

    body = flask_request.get_json(silent=True) or {}
    auth, auth_error = get_session_auth(required=True)
    if auth_error:
        err, status = auth_error
        return jsonify(err), status
    user_id = auth["user_id"]
    identify_code = (body.get("identify_code") or "").strip()
    history_range_raw = body.get("history_range")
    history_range = sanitize_history_range(history_range_raw, 30)

    target_user_id = user_id

    try:
        client = get_firestore_client()
        user_ref = client.collection("users").document(target_user_id)
        payload = {
            "updated_at": firestore.SERVER_TIMESTAMP,
        }
        if identify_code:
            payload["identify_code"] = identify_code
        else:
            payload["identify_code"] = firestore.DELETE_FIELD
        payload["history_range"] = history_range
        user_ref.set(payload, merge=True)
    except Exception as exc:
        return jsonify({"ok": False, "error": f"failed to update settings: {exc}"}), 500

    return jsonify(
        {
            "ok": True,
            "user": {
                "id": target_user_id,
                "identify_code": identify_code,
                "history_range": history_range,
            },
        }
    )


@app.route("/api/friend/validate", methods=["POST", "OPTIONS"])
def validate_friend_request():
    if flask_request.method == "OPTIONS":
        return ("", 204)

    body = flask_request.get_json(silent=True) or {}
    result, status = _validate_friend_payload(body)
    return jsonify(result), status


def _validate_requester(client):
    auth, auth_error = get_session_auth(required=True)
    if auth_error:
        return None, None, auth_error
    requester_user_id = auth["user_id"]
    requester_doc = client.collection("users").document(requester_user_id).get()
    requester_data = requester_doc.to_dict() if requester_doc.exists else {}
    requester_email = (requester_data.get("email") or "").strip().lower()
    if not requester_email:
        return None, None, ({"ok": False, "error": "invalid requester"}, 403)
    return requester_user_id, requester_email, None


def _validate_friend_payload(body):
    friend_email = (body.get("friend_email") or "").strip().lower()
    identify_code = (body.get("identify_code") or "").strip()
    if not friend_email:
        return {"ok": False, "error": "friend_email is required"}, 400
    if "@" not in friend_email:
        return {"ok": False, "error": "friend_email format is invalid"}, 400

    try:
        client = get_firestore_client()
        requester_user_id, requester_email, auth_error = _validate_requester(client)
        if auth_error:
            return auth_error

        docs = list(client.collection("users").where("email", "==", friend_email).limit(1).stream())
        if not docs:
            return {"ok": False, "error": "This Google account does not exist."}, 404

        friend_doc = docs[0]
        friend_data = friend_doc.to_dict() or {}

        if requester_email and requester_email == friend_email:
            return {"ok": False, "error": "You cannot add yourself as a friend."}, 400

        target_code = (friend_data.get("identify_code") or "").strip()
        if target_code:
            if not identify_code:
                return {
                    "ok": False,
                    "error": "This user requires a verification code.",
                    "requires_identify_code": True,
                }, 403
            if identify_code != target_code:
                return {
                    "ok": False,
                    "error": "Verification code is incorrect.",
                    "requires_identify_code": True,
                }, 403

        return {
            "ok": True,
            "requester_user_id": requester_user_id,
            "friend": {
                "id": friend_doc.id,
                "email": friend_email,
                "display_name": (friend_data.get("display_name") or friend_email.split("@", 1)[0]),
                "avatar_url": (friend_data.get("avatar_url") or ""),
            },
            "requires_identify_code": bool(target_code),
        }, 200
    except Exception as exc:
        return {"ok": False, "error": f"validation failed: {exc}"}, 500


@app.route("/api/friend/add", methods=["POST", "OPTIONS"])
def add_friend():
    if flask_request.method == "OPTIONS":
        return ("", 204)

    body = flask_request.get_json(silent=True) or {}
    result, status = _validate_friend_payload(body)
    if status != 200 or not result.get("ok"):
        return jsonify(result), status

    requester_user_id = result["requester_user_id"]
    friend = result["friend"]
    friend_user_id = friend["id"]
    friend_alias = (body.get("friend_alias") or "").strip()
    if len(friend_alias) < 2:
        return jsonify({"ok": False, "error": "friend_alias must be at least 2 characters"}), 400

    user_a_id, user_b_id = sorted([requester_user_id, friend_user_id])
    pair_key = f"{user_a_id}_{user_b_id}"

    try:
        client = get_firestore_client()
        requester_doc = client.collection("users").document(requester_user_id).get()
        requester_data = requester_doc.to_dict() if requester_doc.exists else {}
        friend_doc = client.collection("users").document(friend_user_id).get()
        friend_data = friend_doc.to_dict() if friend_doc.exists else {}

        existing_friendships = list(
            client.collection("friendships")
            .where("status", "==", "accepted")
            .stream()
        )
        alias_lower = friend_alias.strip().lower()
        for existing_doc in existing_friendships:
            existing_data = existing_doc.to_dict() or {}
            ea = (existing_data.get("user_a_id") or "").strip()
            eb = (existing_data.get("user_b_id") or "").strip()
            if requester_user_id not in (ea, eb):
                continue
            requester_is_a = requester_user_id == ea
            existing_alias = (
                (existing_data.get("alias_for_a") or "").strip()
                if requester_is_a
                else (existing_data.get("alias_for_b") or "").strip()
            )
            if existing_alias and existing_alias.lower() == alias_lower:
                return jsonify({"ok": False, "error": "This alias is already used by another contact."}), 409

        payload = {
            "pair_key": pair_key,
            "user_a_id": user_a_id,
            "user_b_id": user_b_id,
            "user_a_email": (requester_data.get("email") or "").lower() if requester_user_id == user_a_id else (friend_data.get("email") or "").lower(),
            "user_b_email": (friend_data.get("email") or "").lower() if friend_user_id == user_b_id else (requester_data.get("email") or "").lower(),
            "user_a_display_name": (requester_data.get("display_name") or "") if requester_user_id == user_a_id else (friend_data.get("display_name") or ""),
            "user_b_display_name": (friend_data.get("display_name") or "") if friend_user_id == user_b_id else (requester_data.get("display_name") or ""),
            "user_a_avatar_url": (requester_data.get("avatar_url") or "") if requester_user_id == user_a_id else (friend_data.get("avatar_url") or ""),
            "user_b_avatar_url": (friend_data.get("avatar_url") or "") if friend_user_id == user_b_id else (requester_data.get("avatar_url") or ""),
            "alias_for_a": friend_alias if requester_user_id == user_a_id else "",
            "alias_for_b": friend_alias if requester_user_id == user_b_id else "",
            "special_prompt_for_a": "",
            "special_prompt_for_b": "",
            "relationship_for_a": "",
            "relationship_for_b": "",
            "status": "accepted",
            "requested_by": requester_user_id,
            "accepted_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP,
            "created_at": firestore.SERVER_TIMESTAMP,
        }
        client.collection("friendships").document(pair_key).set(payload, merge=True)
    except Exception as exc:
        return jsonify({"ok": False, "error": f"failed to add friend: {exc}"}), 500

    friend["display_name"] = friend_alias
    return jsonify({"ok": True, "friend": friend, "pair_key": pair_key})


@app.route("/api/friends/list", methods=["POST", "OPTIONS"])
def list_friends():
    if flask_request.method == "OPTIONS":
        return ("", 204)

    auth, auth_error = get_session_auth(required=True)
    if auth_error:
        err, status = auth_error
        return jsonify(err), status
    requester_user_id = auth["user_id"]

    try:
        client = get_firestore_client()
        unread_docs = list(
            client.collection("users")
            .document(requester_user_id)
            .collection("chat_meta")
            .stream()
        )
        unread_map = {}
        for unread_doc in unread_docs:
            unread_data = unread_doc.to_dict() or {}
            try:
                unread_map[unread_doc.id] = max(0, int(unread_data.get("unread_count") or 0))
            except Exception:
                unread_map[unread_doc.id] = 0

        docs = list(
            client.collection("friendships")
            .where("status", "==", "accepted")
            .stream()
        )

        friends = []
        for doc in docs:
            data = doc.to_dict() or {}
            user_a_id = (data.get("user_a_id") or "").strip()
            user_b_id = (data.get("user_b_id") or "").strip()
            if requester_user_id not in (user_a_id, user_b_id):
                continue

            is_a = requester_user_id == user_a_id
            friend_id = user_b_id if is_a else user_a_id
            friend_display_name = (data.get("user_b_display_name") or "").strip() if is_a else (data.get("user_a_display_name") or "").strip()
            friend_avatar_url = (data.get("user_b_avatar_url") or "").strip() if is_a else (data.get("user_a_avatar_url") or "").strip()
            alias = (data.get("alias_for_a") or "").strip() if is_a else (data.get("alias_for_b") or "").strip()
            special_prompt = (data.get("special_prompt_for_a") or "").strip() if is_a else (data.get("special_prompt_for_b") or "").strip()
            relationship = (data.get("relationship_for_a") or "").strip() if is_a else (data.get("relationship_for_b") or "").strip()
            display_name = alias or friend_display_name or "Friend"

            friends.append(
                {
                    "id": friend_id,
                    "name": display_name,
                    "display_name": friend_display_name,
                    "avatar_url": friend_avatar_url,
                    "special_prompt": special_prompt,
                    "relationship": relationship,
                    "unread_count": unread_map.get(friend_id, 0),
                    "pair_key": data.get("pair_key") or doc.id,
                }
            )

        return jsonify({"ok": True, "friends": friends})
    except Exception as exc:
        return jsonify({"ok": False, "error": f"failed to list friends: {exc}"}), 500


@app.route("/api/chat/mark-read", methods=["POST", "OPTIONS"])
def mark_chat_read():
    if flask_request.method == "OPTIONS":
        return ("", 204)

    auth, auth_error = get_session_auth(required=True)
    if auth_error:
        err, status = auth_error
        return jsonify(err), status
    user_id = auth["user_id"]
    body = flask_request.get_json(silent=True) or {}
    contact_id = (body.get("contact_id") or "").strip()
    if not contact_id:
        return jsonify({"ok": False, "error": "contact_id is required"}), 400
    try:
        client = get_firestore_client()
        ref = client.collection("users").document(user_id).collection("chat_meta").document(contact_id)
        ref.set(
            {
                "unread_count": 0,
                "last_read_at": firestore.SERVER_TIMESTAMP,
                "updated_at": firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )
        return jsonify({"ok": True, "contact_id": contact_id, "unread_count": 0})
    except Exception as exc:
        return jsonify({"ok": False, "error": f"failed to mark read: {exc}"}), 500


@app.route("/api/friend/settings", methods=["POST", "OPTIONS"])
def save_friend_settings():
    if flask_request.method == "OPTIONS":
        return ("", 204)

    body = flask_request.get_json(silent=True) or {}
    auth, auth_error = get_session_auth(required=True)
    if auth_error:
        err, status = auth_error
        return jsonify(err), status
    requester_user_id = auth["user_id"]
    friend_user_id = (body.get("friend_user_id") or "").strip()
    alias = (body.get("alias") or "").strip()
    special_prompt = (body.get("special_prompt") or "").strip()
    relationship = (body.get("relationship") or "").strip()

    if not friend_user_id:
        return jsonify({"ok": False, "error": "friend_user_id is required"}), 400
    if requester_user_id == friend_user_id:
        return jsonify({"ok": False, "error": "cannot update self settings"}), 400

    try:
        client = get_firestore_client()

        user_a_id, user_b_id = sorted([requester_user_id, friend_user_id])
        pair_key = f"{user_a_id}_{user_b_id}"
        doc_ref = client.collection("friendships").document(pair_key)
        doc = doc_ref.get()
        if not doc.exists:
            return jsonify({"ok": False, "error": "friendship not found"}), 404

        field_alias = "alias_for_a" if requester_user_id == user_a_id else "alias_for_b"
        field_prompt = "special_prompt_for_a" if requester_user_id == user_a_id else "special_prompt_for_b"
        field_relationship = "relationship_for_a" if requester_user_id == user_a_id else "relationship_for_b"
        docs = list(
            client.collection("friendships")
            .where("status", "==", "accepted")
            .stream()
        )
        alias_lower = alias.strip().lower()
        for entry in docs:
            if entry.id == pair_key:
                continue
            entry_data = entry.to_dict() or {}
            ea = (entry_data.get("user_a_id") or "").strip()
            eb = (entry_data.get("user_b_id") or "").strip()
            if requester_user_id not in (ea, eb):
                continue
            requester_is_a = requester_user_id == ea
            existing_alias = (
                (entry_data.get("alias_for_a") or "").strip()
                if requester_is_a
                else (entry_data.get("alias_for_b") or "").strip()
            )
            if existing_alias and existing_alias.lower() == alias_lower:
                return jsonify({"ok": False, "error": "This alias is already used by another contact."}), 409
        update_payload = {
            "updated_at": firestore.SERVER_TIMESTAMP,
            field_alias: alias,
        }
        if special_prompt:
            update_payload[field_prompt] = special_prompt
        else:
            update_payload[field_prompt] = firestore.DELETE_FIELD
        if relationship:
            update_payload[field_relationship] = relationship
        else:
            update_payload[field_relationship] = firestore.DELETE_FIELD
        doc_ref.set(update_payload, merge=True)

        return jsonify(
            {
                "ok": True,
                "friend": {
                    "id": friend_user_id,
                    "alias": alias,
                    "special_prompt": special_prompt,
                    "relationship": relationship,
                    "pair_key": pair_key,
                },
            }
        )
    except Exception as exc:
        return jsonify({"ok": False, "error": f"failed to save friend settings: {exc}"}), 500


@app.route("/api/ably/token", methods=["POST", "OPTIONS"])
def ably_token():
    if flask_request.method == "OPTIONS":
        return ("", 204)

    auth, auth_error = get_session_auth(required=True)
    if auth_error:
        err, status = auth_error
        return jsonify(err), status
    requester_user_id = auth["user_id"]

    try:
        token_request = create_ably_token_request(requester_user_id)
        return jsonify({"ok": True, "token_request": token_request})
    except Exception as exc:
        return jsonify({"ok": False, "error": f"failed to create ably token: {exc}"}), 500


@app.route("/api/messages/send", methods=["POST", "OPTIONS"])
def send_message():
    if flask_request.method == "OPTIONS":
        return ("", 204)

    body = flask_request.get_json(silent=True) or {}
    auth, auth_error = get_session_auth(required=True)
    if auth_error:
        err, status = auth_error
        return jsonify(err), status
    sender_user_id = auth["user_id"]
    recipient_user_id = (body.get("recipient_user_id") or "").strip()
    text = (body.get("text") or "").strip()
    image_url = (body.get("image_url") or "").strip()
    music_url = (body.get("music_url") or "").strip()

    if not recipient_user_id:
        return jsonify({"ok": False, "error": "recipient_user_id is required"}), 400
    if not text and not image_url and not music_url:
        return jsonify({"ok": False, "error": "text or attachment is required"}), 400
    if sender_user_id == recipient_user_id:
        return jsonify({"ok": False, "error": "cannot send message to yourself"}), 400

    try:
        client = get_firestore_client()

        recipient_doc = client.collection("users").document(recipient_user_id).get()
        if not recipient_doc.exists:
            return jsonify({"ok": False, "error": "recipient does not exist"}), 404
        sender_doc = client.collection("users").document(sender_user_id).get()
        sender_data = sender_doc.to_dict() if sender_doc.exists else {}

        message_id = str(uuid.uuid4())
        created_at_iso = datetime.now(timezone.utc).isoformat()
        save_chat_message(
            sender_user_id,
            recipient_user_id,
            "user",
            text,
            extras={
                "visibility": "shared",
                "sender_mode": "user",
                **({"image_url": image_url} if image_url else {}),
                **({"music_url": music_url} if music_url else {}),
            },
        )
        save_chat_message(
            recipient_user_id,
            sender_user_id,
            "peer",
            text,
            extras={
                "visibility": "shared",
                "sender_mode": "user",
                "avatar_url": (sender_data.get("avatar_url") or "").strip(),
                **({"image_url": image_url} if image_url else {}),
                **({"music_url": music_url} if music_url else {}),
            },
        )
        preview_text = text or ("Image + Music" if image_url and music_url else "Image" if image_url else "Music")
        upsert_chat_meta(sender_user_id, recipient_user_id, unread_increment=0, preview_text=preview_text)
        upsert_chat_meta(recipient_user_id, sender_user_id, unread_increment=1, preview_text=preview_text)

        payload = {
            "message_id": message_id,
            "sender_user_id": sender_user_id,
            "recipient_user_id": recipient_user_id,
            "text": text,
            "created_at": created_at_iso,
            "sender_display_name": (sender_data.get("display_name") or ""),
            "sender_avatar_url": (sender_data.get("avatar_url") or ""),
            "sender_mode": "user",
            "image_url": image_url,
            "music_url": music_url,
        }
        publish_user_channel_message(recipient_user_id, payload)
        return jsonify({"ok": True, "message": payload})
    except Exception as exc:
        return jsonify({"ok": False, "error": f"failed to send message: {exc}"}), 500


@app.route("/api/messages/send-voice", methods=["POST", "OPTIONS"])
def send_voice_message():
    if flask_request.method == "OPTIONS":
        return ("", 204)

    body = flask_request.get_json(silent=True) or {}
    auth, auth_error = get_session_auth(required=True)
    if auth_error:
        err, status = auth_error
        return jsonify(err), status
    sender_user_id = auth["user_id"]
    recipient_user_id = (body.get("recipient_user_id") or "").strip()
    audio_b64 = (body.get("audio_base64") or "").strip()
    mime_type = (body.get("mime_type") or "audio/webm").strip()
    duration_seconds_raw = body.get("duration_seconds")

    if not recipient_user_id:
        return jsonify({"ok": False, "error": "recipient_user_id is required"}), 400
    if sender_user_id == recipient_user_id:
        return jsonify({"ok": False, "error": "cannot send message to yourself"}), 400
    if not audio_b64:
        return jsonify({"ok": False, "error": "audio_base64 is required"}), 400

    try:
        duration_seconds = float(duration_seconds_raw or 0)
    except Exception:
        duration_seconds = 0.0
    if duration_seconds < 0:
        duration_seconds = 0.0
    if duration_seconds > 600:
        duration_seconds = 600.0

    try:
        audio_bytes = base64.b64decode(audio_b64)
    except Exception:
        return jsonify({"ok": False, "error": "invalid base64 audio payload"}), 400

    try:
        transcript = transcribe_audio_bytes(audio_bytes, mime_type)
    except Exception as exc:
        return jsonify({"ok": False, "error": f"speech-to-text failed: {exc}"}), 502
    if not transcript:
        return jsonify({"ok": False, "error": "speech-to-text returned empty transcript"}), 422

    try:
        audio_url = upload_audio_to_vercel_blob(sender_user_id, audio_bytes, mime_type or "audio/webm")
    except Exception as exc:
        return jsonify({"ok": False, "error": f"voice upload failed: {exc}"}), 502

    try:
        client = get_firestore_client()
        recipient_doc = client.collection("users").document(recipient_user_id).get()
        if not recipient_doc.exists:
            return jsonify({"ok": False, "error": "recipient does not exist"}), 404
        sender_doc = client.collection("users").document(sender_user_id).get()
        sender_data = sender_doc.to_dict() if sender_doc.exists else {}

        message_id = str(uuid.uuid4())
        created_at_iso = datetime.now(timezone.utc).isoformat()

        save_chat_message(
            sender_user_id,
            recipient_user_id,
            "user",
            "",
            extras={
                "visibility": "shared",
                "sender_mode": "user",
                "audio_url": audio_url,
                "audio_duration_seconds": duration_seconds,
                "transcript_text": transcript,
            },
        )
        save_chat_message(
            recipient_user_id,
            sender_user_id,
            "peer",
            "",
            extras={
                "visibility": "shared",
                "sender_mode": "user",
                "avatar_url": (sender_data.get("avatar_url") or "").strip(),
                "audio_url": audio_url,
                "audio_duration_seconds": duration_seconds,
                "transcript_text": transcript,
            },
        )
        upsert_chat_meta(
            sender_user_id,
            recipient_user_id,
            unread_increment=0,
            preview_text=transcript or "Voice message",
        )
        upsert_chat_meta(
            recipient_user_id,
            sender_user_id,
            unread_increment=1,
            preview_text=transcript or "Voice message",
        )

        payload = {
            "message_id": message_id,
            "sender_user_id": sender_user_id,
            "recipient_user_id": recipient_user_id,
            "text": "",
            "audio_url": audio_url,
            "audio_duration_seconds": duration_seconds,
            "created_at": created_at_iso,
            "sender_display_name": (sender_data.get("display_name") or ""),
            "sender_avatar_url": (sender_data.get("avatar_url") or ""),
            "sender_mode": "user",
        }
        publish_user_channel_message(recipient_user_id, payload)
        return jsonify({"ok": True, "message": payload})
    except Exception as exc:
        return jsonify({"ok": False, "error": f"failed to send voice message: {exc}"}), 500


@app.route("/api/assist/message", methods=["POST", "OPTIONS"])
def assist_message():
    if flask_request.method == "OPTIONS":
        return ("", 204)

    auth, auth_error = get_session_auth(required=True)
    if auth_error:
        err, status = auth_error
        return jsonify(err), status
    user_id = auth["user_id"]
    body = flask_request.get_json(silent=True) or {}
    contact_id = (body.get("contact_id") or "").strip()
    user_message = (body.get("message") or "").strip()

    if not contact_id:
        return jsonify({"ok": False, "error": "contact_id is required"}), 400
    if not user_message:
        return jsonify({"ok": False, "error": "message is required"}), 400
    if contact_id == "pisces-core":
        return jsonify({"ok": False, "error": "assist mode is only for friend chats"}), 400

    request_id = str(uuid.uuid4())
    try:
        friend_ctx = get_friend_context(user_id, contact_id)
        if not friend_ctx:
            return jsonify({"ok": False, "error": "friend not found in this chat"}), 404

        user_doc = get_firestore_client().collection("users").document(user_id).get()
        user_data = user_doc.to_dict() if user_doc.exists else {}
        ai_settings = get_user_ai_settings(user_id)
        history_range = get_user_history_range(user_id)
        history_messages = get_chat_messages(user_id, contact_id, history_range=history_range)

        decision = decide_assist_action(user_message, history_messages, friend_ctx["friend_name"])
        media_tools = decide_media_tools(user_message, history_messages)
        if has_explicit_voice_request(user_message):
            decision["voice"] = True
        explicit_send_intent = has_send_to_friend_intent(user_message)
        if explicit_send_intent or media_tools.get("draw_image") or media_tools.get("create_music"):
            decision["send_to_friend"] = True
        group_id = f"assist-{int(datetime.now(timezone.utc).timestamp() * 1000)}-{uuid.uuid4().hex[:8]}"
        composed = {"as_user": False, "message_to_friend": ""}
        if decision.get("send_to_friend"):
            style_prompt = friend_ctx["special_prompt"] or ai_settings.get("global_prompt") or AI_DEFAULT_GLOBAL_PROMPT
            composed = compose_message_for_friend(
                user_message=user_message,
                history_messages=history_messages,
                user_name=(user_data.get("display_name") or user_data.get("email") or "User"),
                friend_name=friend_ctx["friend_name"],
                ai_name=(user_data.get("ai_name") or "Pisces"),
                style_prompt=style_prompt,
                relationship=friend_ctx.get("relationship") or "",
            )
            if has_explicit_send_as_user_intent(user_message):
                composed["as_user"] = True

        ai_text = (decision.get("reply_to_user") or "").strip() or "Done."
        if decision.get("send_to_friend"):
            if not composed.get("message_to_friend"):
                ai_text = "Sorry, I could not compose a message to send right now."
                decision["send_to_friend"] = False
            else:
                ai_text = f"Sent to {friend_ctx['friend_name']}: {composed.get('message_to_friend')}"

        save_chat_message(
            user_id,
            contact_id,
            "assist_user",
            user_message,
            extras={"visibility": "private_to_user", "assist_group_id": group_id},
        )
        outbound_message = None
        assist_ai_audio_url = ""
        if decision.get("send_to_friend"):
            sender_mode = "user" if composed.get("as_user") else "ai_proxy"
            outbound_text = sanitize_forward_message_text(
                user_message=user_message,
                outbound_text=(composed.get("message_to_friend") or "").strip(),
                friend_name=friend_ctx["friend_name"],
            )
            outbound_image_url = ""
            outbound_music_url = ""
            if media_tools.get("draw_image"):
                try:
                    image_bytes, image_mime = generate_image_with_gemini(user_message)
                    outbound_image_url = upload_image_to_vercel_blob(user_id, image_bytes, image_mime or "image/png")
                except Exception as exc:
                    log_tool_error(
                        user_id,
                        contact_id,
                        "draw_image",
                        "assist_message_send_to_friend",
                        str(exc),
                        request_id=request_id,
                        input_snapshot={"message": user_message},
                    )
            if media_tools.get("create_music"):
                try:
                    music_bytes = generate_music_with_lyria(user_message)
                    outbound_music_url = upload_audio_to_vercel_blob(user_id, music_bytes, "audio/wav")
                except Exception as exc:
                    log_tool_error(
                        user_id,
                        contact_id,
                        "create_music",
                        "assist_message_send_to_friend",
                        str(exc),
                        request_id=request_id,
                        input_snapshot={"message": user_message},
                    )
            sender_avatar_url = (
                (user_data.get("avatar_url") or "").strip()
                if sender_mode == "user"
                else (user_data.get("ai_avatar_url") or "").strip() or "/images/fish.png"
            )
            outbound_audio_url = ""
            if decision.get("voice"):
                zh_len = count_zh_chars(outbound_text)
                en_words = count_en_words(outbound_text)
                if zh_len <= 100 and en_words <= 50:
                    try:
                        locale = "en-US" if en_words > 0 and zh_len == 0 else "zh-TW"
                        audio_b64_tmp, audio_mime_tmp = synthesize_tts_audio(
                            outbound_text,
                            locale,
                            ai_settings.get("voice") or DEFAULT_AI_SETTINGS["voice"],
                            "warm and caring" if locale == "en-US" else "溫柔且貼心",
                        )
                        outbound_audio_url = upload_audio_to_vercel_blob(
                            user_id,
                            base64.b64decode(audio_b64_tmp),
                            audio_mime_tmp or "audio/wav",
                        )
                    except Exception as exc:
                        log_tool_error(
                            user_id,
                            contact_id,
                            "text_to_speech",
                            "assist_message_send_to_friend",
                            str(exc),
                            request_id=request_id,
                            input_snapshot={"text": outbound_text},
                        )

            # For assist mode, sender-side timeline should only show the assist group.
            # Keep shared message only on recipient side.
            save_chat_message(
                contact_id,
                user_id,
                "peer",
                "" if outbound_audio_url else outbound_text,
                extras={
                    "visibility": "shared",
                    "sender_mode": sender_mode,
                    "avatar_url": sender_avatar_url,
                    **({"audio_url": outbound_audio_url} if outbound_audio_url else {}),
                    **({"image_url": outbound_image_url} if outbound_image_url else {}),
                    **({"music_url": outbound_music_url} if outbound_music_url else {}),
                },
            )
            upsert_chat_meta(user_id, contact_id, unread_increment=0, preview_text=outbound_text)
            upsert_chat_meta(contact_id, user_id, unread_increment=1, preview_text=outbound_text)

            payload = {
                "message_id": str(uuid.uuid4()),
                "sender_user_id": user_id,
                "recipient_user_id": contact_id,
                "text": "" if outbound_audio_url else outbound_text,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "sender_display_name": (user_data.get("display_name") or ""),
                "sender_avatar_url": sender_avatar_url,
                "sender_mode": sender_mode,
                "audio_url": outbound_audio_url,
                "image_url": outbound_image_url,
                "music_url": outbound_music_url,
            }
            publish_user_channel_message(contact_id, payload)
            outbound_message = {
                "text": "" if outbound_audio_url else outbound_text,
                "as_user": sender_mode == "user",
                "sender_mode": sender_mode,
                "avatar_url": sender_avatar_url,
                "message_id": payload["message_id"],
                "audio_url": outbound_audio_url,
                "image_url": outbound_image_url,
                "music_url": outbound_music_url,
            }
            if outbound_audio_url:
                assist_ai_audio_url = outbound_audio_url
                ai_text = ""

        audio_b64 = ""
        audio_mime_type = ""
        if decision.get("voice") and has_explicit_voice_request(user_message) and not (decision.get("send_to_friend") and outbound_message and outbound_message.get("audio_url")):
            zh_len = count_zh_chars(ai_text)
            en_words = count_en_words(ai_text)
            if zh_len <= 100 and en_words <= 50:
                try:
                    voice_name = ai_settings.get("voice") or DEFAULT_AI_SETTINGS["voice"]
                    locale = "en-US" if en_words > 0 and zh_len == 0 else "zh-TW"
                    audio_b64, audio_mime_type = synthesize_tts_audio(
                        ai_text,
                        locale,
                        voice_name,
                        "warm and caring" if locale == "en-US" else "溫柔且貼心",
                    )
                except Exception as exc:
                    log_tool_error(
                        user_id,
                        contact_id,
                        "text_to_speech",
                        "assist_message",
                        str(exc),
                        request_id=request_id,
                        input_snapshot={"text": ai_text},
                    )

        save_chat_message(
            user_id,
            contact_id,
            "assist_ai",
            ai_text,
            extras={
                "visibility": "private_to_user",
                "assist_group_id": group_id,
                **({"audio_url": assist_ai_audio_url} if assist_ai_audio_url else {}),
            },
        )

        return jsonify(
            {
                "ok": True,
                "assist_group": {
                    "id": group_id,
                    "user_text": user_message,
                    "ai_text": ai_text,
                    "collapsed": False,
                    "audio_url": (outbound_message or {}).get("audio_url") or "",
                    "audio_base64": audio_b64,
                    "audio_mime_type": audio_mime_type,
                },
                "outbound_message": outbound_message,
            }
        )
    except Exception as exc:
        log_tool_error(
            user_id,
            contact_id,
            "assist_pipeline",
            "assist_message",
            str(exc),
            request_id=request_id,
            input_snapshot={"message": user_message},
        )
        return jsonify({"ok": False, "error": "Sorry, assist mode is currently unavailable."}), 500


@app.route("/api/live/token", methods=["POST", "OPTIONS"])
def live_token():
    if flask_request.method == "OPTIONS":
        return ("", 204)
    body = flask_request.get_json(silent=True) or {}
    auth, auth_error = get_session_auth(required=True)
    if auth_error:
        err, status = auth_error
        return jsonify(err), status
    user_id = auth["user_id"]
    contact_id = (body.get("contact_id") or "pisces-core").strip() or "pisces-core"
    request_id = str(uuid.uuid4())
    try:
        token_data = create_live_ephemeral_token()
        live_system_prompt = build_live_system_prompt(user_id, contact_id)
        live_context = build_live_contents_context(user_id, contact_id)
        log_info_event(
            user_id,
            contact_id,
            "live_system_prompt",
            "live_token",
            "Generated Gemini Live system prompt",
            request_id=request_id,
            input_snapshot={
                "ai_room": contact_id == "pisces-core",
                "contact_id": contact_id,
                "system_prompt": live_system_prompt,
                "live_context": live_context,
            },
        )
    except Exception as exc:
        return jsonify({"ok": False, "error": f"failed to create live token: {exc}"}), 500

    return jsonify(
        {
            "ok": True,
            "model": LIVE_MODEL,
            "voice_name": "Leda",
            "system_prompt": live_system_prompt,
            "live_context": live_context,
            "ai_room": contact_id == "pisces-core",
            **token_data,
        }
    )


@app.route("/api/live/about-friend-context", methods=["POST", "OPTIONS"])
def live_about_friend_context():
    if flask_request.method == "OPTIONS":
        return ("", 204)
    auth, auth_error = get_session_auth(required=True)
    if auth_error:
        err, status = auth_error
        return jsonify(err), status

    body = flask_request.get_json(silent=True) or {}
    transcript = (body.get("transcript") or "").strip()
    contact_id = (body.get("contact_id") or "pisces-core").strip() or "pisces-core"
    if not transcript:
        return jsonify({"ok": True, "matched": False, "context": ""})

    # Only expose about_friend in AI room.
    if contact_id != "pisces-core":
        return jsonify({"ok": True, "matched": False, "context": ""})

    user_id = auth["user_id"]
    history_range = get_user_history_range(user_id)
    user_doc = get_firestore_client().collection("users").document(user_id).get()
    user_data = user_doc.to_dict() if user_doc.exists else {}
    user_name = (user_data.get("display_name") or user_data.get("email") or "User").strip()

    plan = decide_about_friend(transcript)
    if not plan.get("call_about_friend") or not (plan.get("name") or "").strip():
        return jsonify({"ok": True, "matched": False, "context": ""})

    result = about_friend(user_id, plan.get("name"), history_range)
    context = build_about_friend_context(user_name, result)
    friend = result.get("friend") or {}
    friend_name = (friend.get("alias") or friend.get("display_name") or friend.get("email") or "").strip()

    return jsonify(
        {
            "ok": True,
            "matched": bool(context),
            "context": context,
            "name": (plan.get("name") or "").strip(),
            "friend_name": friend_name,
        }
    )
