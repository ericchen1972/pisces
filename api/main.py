import json
import os
from urllib import error, request

from flask import Flask, jsonify, request as flask_request
from google.auth.transport import requests as google_requests
from google.cloud import firestore
from google.oauth2 import id_token

app = Flask(__name__)
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.json")
FIRESTORE_PROJECT_ID = os.getenv("FIRESTORE_PROJECT_ID", "pisces-hackathon")
FIRESTORE_DATABASE_ID = os.getenv("FIRESTORE_DATABASE_ID", "pisces")
GOOGLE_CLIENT_ID = os.getenv(
    "GOOGLE_CLIENT_ID",
    "315346868518-os2tf8uc5282bggj40jbpkaltae1phi9.apps.googleusercontent.com",
)


def get_gemini_api_key():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                config = json.load(f)
            key = (config.get("GEMINI_API_KEY") or "").strip()
            if key:
                return key
        except Exception:
            pass
    return (os.getenv("GEMINI_API_KEY") or "").strip()


def get_firestore_client():
    return firestore.Client(project=FIRESTORE_PROJECT_ID, database=FIRESTORE_DATABASE_ID)


def verify_google_credential(credential):
    return id_token.verify_oauth2_token(
        credential,
        google_requests.Request(),
        GOOGLE_CLIENT_ID,
    )


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

    gemini_api_key = get_gemini_api_key()
    if not gemini_api_key:
        return jsonify({"error": "GEMINI_API_KEY is not configured"}), 500

    model = "gemini-2.5-flash"
    endpoint = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent"
        f"?key={gemini_api_key}"
    )
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": user_message},
                ]
            }
        ]
    }

    req = request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        return jsonify({"error": "Gemini request failed", "detail": detail}), 502
    except Exception as exc:  # pragma: no cover
        return jsonify({"error": "Gemini request failed", "detail": str(exc)}), 502

    candidates = data.get("candidates") or []
    reply_text = ""
    if candidates:
        content = candidates[0].get("content") or {}
        parts = content.get("parts") or []
        if parts:
            reply_text = parts[0].get("text", "")

    if not reply_text:
        return jsonify({"error": "Gemini returned empty response"}), 502

    return jsonify({"reply": reply_text})


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
