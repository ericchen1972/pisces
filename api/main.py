import json
import os
import base64
import re
import struct
from datetime import datetime, timedelta, timezone
from urllib import error, request

from flask import Flask, jsonify, request as flask_request
from google.auth.transport import requests as google_requests
from google.cloud import firestore
from google.cloud import speech_v1 as speech
from google import genai
from google.oauth2 import id_token
from google.oauth2 import service_account

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


def build_chat_tool_decision(user_message):
    instruction = (
        "You are Pisces AI. Decide whether the user asked for spoken output. "
        "Return strict JSON only with keys: "
        "reply (string), "
        "should_read_aloud (boolean), "
        "language (one of: zh-TW, en-US), "
        "reason (string). "
        "Rules: "
        "1) If user intent suggests read aloud/voice playback, set should_read_aloud=true. "
        "2) If should_read_aloud=true and language=zh-TW, reply must be <=100 Chinese characters. "
        "3) If should_read_aloud=true and language=en-US, reply must be <=50 English words. "
        "4) If these limits would make content incorrect/incomplete, set should_read_aloud=false and explain why in reply. "
        "5) Keep reply natural and helpful."
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
    data = call_gemini_generate_content(payload, model=CHAT_MODEL)
    raw = extract_text_from_response(data)
    obj = extract_json_obj(raw)

    reply = str(obj.get("reply") or "").strip()
    should_read_aloud = bool(obj.get("should_read_aloud"))
    language = str(obj.get("language") or "").strip() or "zh-TW"
    reason = str(obj.get("reason") or "").strip()

    if language not in ("zh-TW", "en-US"):
        language = "zh-TW"

    if not reply:
        # Fallback to regular text generation if JSON output is malformed.
        reply = generate_plain_text_reply(user_message)
        should_read_aloud = False
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

    return {
        "reply": reply,
        "should_read_aloud": should_read_aloud,
        "language": language,
        "reason": reason,
    }


def generate_plain_text_reply(user_message):
    payload = {
        "contents": [
            {
                "parts": [
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


def synthesize_tts_audio(text, language):
    if language == "en-US":
        voice_name = "Sulafat"
        style_prompt = "gentle tone"
        locale_hint = "English (United States)"
    else:
        voice_name = "Leda"
        style_prompt = "溫柔的語氣"
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
    keys_to_try = ("GOOGLE_API_KEY", "GEMINI_API_KEY")
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                config = json.load(f)
            for key_name in keys_to_try:
                key = (config.get(key_name) or "").strip()
                if key:
                    return key
        except Exception:
            pass
    for key_name in keys_to_try:
        key = (os.getenv(key_name) or "").strip()
        if key:
            return key
    return ""


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


def generate_gemini_reply(user_message):
    decision = build_chat_tool_decision(user_message)
    reply_text = decision["reply"]
    audio_b64 = ""
    audio_mime_type = ""

    if decision["should_read_aloud"]:
        try:
            audio_b64, audio_mime_type = synthesize_tts_audio(
                reply_text,
                decision["language"],
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
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


@app.route("/api/chat", methods=["POST", "OPTIONS"])
def chat():
    if flask_request.method == "OPTIONS":
        return ("", 204)

    body = flask_request.get_json(silent=True) or {}
    user_message = (body.get("message") or "").strip()
    if not user_message:
        return jsonify({"error": "message is required"}), 400

    try:
        chat_result = generate_gemini_reply(user_message)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502

    return jsonify(chat_result)


@app.route("/api/voice-chat", methods=["POST", "OPTIONS"])
def voice_chat():
    if flask_request.method == "OPTIONS":
        return ("", 204)

    body = flask_request.get_json(silent=True) or {}
    audio_b64 = (body.get("audio_base64") or "").strip()
    mime_type = (body.get("mime_type") or "audio/webm").strip()
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

    try:
        chat_result = generate_gemini_reply(transcript)
    except Exception as exc:
        return jsonify({"error": str(exc), "transcript": transcript}), 502

    return jsonify({"transcript": transcript, **chat_result})


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

    if not user_id or not email:
        return jsonify({"ok": False, "error": "google token missing sub/email"}), 401

    try:
        client = get_firestore_client()
        user_ref = client.collection("users").document(user_id)
        existing = user_ref.get()
        payload = {
            "display_name": display_name,
            "email": email,
            "email_verified": email_verified,
            "provider": "google",
            "updated_at": firestore.SERVER_TIMESTAMP,
        }
        if not existing.exists:
            payload["created_at"] = firestore.SERVER_TIMESTAMP

        user_ref.set(payload, merge=True)
    except Exception as exc:
        return jsonify({"ok": False, "error": f"failed to save user: {exc}"}), 500

    return jsonify(
        {
            "ok": True,
            "user": {
                "id": user_id,
                "display_name": display_name,
                "email": email,
                "email_verified": email_verified,
            },
        }
    )


@app.route("/api/live/token", methods=["POST", "OPTIONS"])
def live_token():
    if flask_request.method == "OPTIONS":
        return ("", 204)
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
