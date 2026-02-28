import json
import os
from urllib import error, request

from flask import Flask, jsonify, request as flask_request

app = Flask(__name__)


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

    gemini_api_key = os.getenv("GEMINI_API_KEY")
    if not gemini_api_key:
        return jsonify({"error": "GEMINI_API_KEY is not configured"}), 500

    endpoint = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        "gemini-2.0-flash:generateContent"
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
