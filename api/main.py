import json
import os
import base64
import re
import struct
import hashlib
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from urllib import error, request
from urllib.parse import urlencode

from flask import Flask, jsonify, request as flask_request, session
from google.auth.transport import requests as google_requests
from google.cloud import firestore
from google.cloud import speech_v1 as speech
from google import genai
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


def build_chat_tool_decision(user_message, global_prompt, history_messages):
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
    if language == "en-US":
        style_prompt = tone_prompt or "gentle tone"
        locale_hint = "English (United States)"
    else:
        style_prompt = tone_prompt or "溫柔的語氣"
        locale_hint = "Chinese, Mandarin (Taiwan)"

    prompt = (
        f"Read the following text in {locale_hint}. "
        f"Use this speaking style: {style_prompt}. "
        f"Text: {text}"
    )
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
    for doc in docs:
        data = doc.to_dict() or {}
        text = (data.get("text") or "").strip()
        role = (data.get("role") or "").strip()
        if not text or role not in ("user", "ai", "peer"):
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
            }
        )
    return messages


def save_chat_message(user_id, contact_id, role, text):
    clean_text = (text or "").strip()
    if not user_id or not contact_id or role not in ("user", "ai", "peer") or not clean_text:
        return
    client = get_firestore_client()
    coll = (
        client.collection("users")
        .document(user_id)
        .collection("chats")
        .document(contact_id)
        .collection("messages")
    )
    coll.add(
        {
            "role": role,
            "text": clean_text,
            "created_at": firestore.SERVER_TIMESTAMP,
        }
    )


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


def generate_gemini_reply(user_message, ai_settings, history_messages):
    global_prompt = ai_settings.get("global_prompt") or AI_DEFAULT_GLOBAL_PROMPT
    voice_name = ai_settings.get("voice") or DEFAULT_AI_SETTINGS["voice"]
    decision = build_chat_tool_decision(user_message, global_prompt, history_messages)
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


def transcribe_audio_bytes(audio_bytes, mime_type):
    speech_client = speech.SpeechClient()
    mime = (mime_type or "").lower()

    if "ogg" in mime:
        encoding = speech.RecognitionConfig.AudioEncoding.OGG_OPUS
    elif "wav" in mime or "wave" in mime:
        encoding = speech.RecognitionConfig.AudioEncoding.LINEAR16
    else:
        encoding = speech.RecognitionConfig.AudioEncoding.WEBM_OPUS

    config = speech.RecognitionConfig(
        encoding=encoding,
        language_code="zh-TW",
        alternative_language_codes=["en-US"],
        enable_automatic_punctuation=True,
        audio_channel_count=1,
    )
    audio = speech.RecognitionAudio(content=audio_bytes)
    response = speech_client.recognize(config=config, audio=audio)

    transcripts = []
    for result in response.results:
        if result.alternatives:
            text = (result.alternatives[0].transcript or "").strip()
            if text:
                transcripts.append(text)
    return " ".join(transcripts).strip()


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

    ai_settings = get_user_ai_settings(user_id)
    history_range = get_user_history_range(user_id)
    history_messages = get_chat_messages(user_id, contact_id, history_range=history_range)
    try:
        chat_result = generate_gemini_reply(user_message, ai_settings, history_messages)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502

    if user_id:
        try:
            save_chat_message(user_id, contact_id, "user", user_message)
            save_chat_message(user_id, contact_id, "ai", chat_result.get("reply") or "")
        except Exception:
            pass

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
    try:
        chat_result = generate_gemini_reply(transcript, ai_settings, history_messages)
    except Exception as exc:
        return jsonify({"error": str(exc), "transcript": transcript}), 502

    if user_id:
        try:
            save_chat_message(user_id, contact_id, "user", transcript)
            save_chat_message(user_id, contact_id, "ai", chat_result.get("reply") or "")
        except Exception:
            pass

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
        user_ref.set(payload, merge=True)
    except Exception as exc:
        return jsonify({"ok": False, "error": f"failed to update settings: {exc}"}), 500

    return jsonify(
        {
            "ok": True,
            "user": {
                "id": target_user_id,
                "identify_code": identify_code,
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

    if not recipient_user_id:
        return jsonify({"ok": False, "error": "recipient_user_id is required"}), 400
    if not text:
        return jsonify({"ok": False, "error": "text is required"}), 400
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
        save_chat_message(sender_user_id, recipient_user_id, "user", text)
        save_chat_message(recipient_user_id, sender_user_id, "peer", text)
        upsert_chat_meta(sender_user_id, recipient_user_id, unread_increment=0, preview_text=text)
        upsert_chat_meta(recipient_user_id, sender_user_id, unread_increment=1, preview_text=text)

        payload = {
            "message_id": message_id,
            "sender_user_id": sender_user_id,
            "recipient_user_id": recipient_user_id,
            "text": text,
            "created_at": created_at_iso,
            "sender_display_name": (sender_data.get("display_name") or ""),
            "sender_avatar_url": (sender_data.get("avatar_url") or ""),
        }
        publish_user_channel_message(recipient_user_id, payload)
        return jsonify({"ok": True, "message": payload})
    except Exception as exc:
        return jsonify({"ok": False, "error": f"failed to send message: {exc}"}), 500


@app.route("/api/live/token", methods=["POST", "OPTIONS"])
def live_token():
    if flask_request.method == "OPTIONS":
        return ("", 204)
    auth, auth_error = get_session_auth(required=True)
    if auth_error:
        err, status = auth_error
        return jsonify(err), status
    try:
        token_data = create_live_ephemeral_token()
    except Exception as exc:
        return jsonify({"ok": False, "error": f"failed to create live token: {exc}"}), 500

    return jsonify(
        {
            "ok": True,
            "model": LIVE_MODEL,
            "voice_name": "Leda",
            **token_data,
        }
    )
