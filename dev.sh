#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
API_DIR="$ROOT_DIR/api"
WEB_DIR="$ROOT_DIR/web"

API_HOST="127.0.0.1"
API_PORT="8080"
WEB_HOST="127.0.0.1"
WEB_PORT="5173"

export GOOGLE_APPLICATION_CREDENTIALS="$API_DIR/keys/firestore-sa.json"

cleanup() {
  if [[ -n "${API_PID:-}" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
  fi
  if [[ -n "${WEB_PID:-}" ]] && kill -0 "$WEB_PID" 2>/dev/null; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

(
  cd "$API_DIR"
  source .venv/bin/activate
  FLASK_APP=main flask run --debug --host "$API_HOST" --port "$API_PORT"
) &
API_PID=$!

(
  cd "$WEB_DIR"
  npm run dev -- --host "$WEB_HOST" --port "$WEB_PORT"
) &
WEB_PID=$!

echo "API: http://$API_HOST:$API_PORT"
echo "WEB: http://$WEB_HOST:$WEB_PORT"

echo "Press Ctrl+C to stop both."
wait
