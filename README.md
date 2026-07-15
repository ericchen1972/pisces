# Convia

**AI-first communication app**

Convia combines person-to-person messaging with an AI contact and private AI assistance inside friend conversations. Users can relay messages, generate image or music attachments, transcribe recorded audio, hear AI-generated speech, and call the AI through a Realtime voice session.

## Architecture

- Frontend: React and Vite, deployed on Vercel
- Backend: Python and Flask, deployed on Google Cloud Run
- Database: Firestore
- Realtime message delivery: Ably channels (`user_<user_id>`)
- Media storage: Vercel Blob

The existing deployment URLs and internal service identifiers intentionally remain unchanged for compatibility:

- Web: `https://pisces-plum.vercel.app/`
- API: `https://pisces-315346868518.asia-east1.run.app`
- AI contact identifier: `pisces-core`

## AI providers and models

OpenAI handles all text, routing, speech transcription, speech synthesis, and AI voice calls. The defaults can be overridden independently:

| Capability | Environment variable | Default |
| --- | --- | --- |
| Visible text replies | `OPENAI_TEXT_MODEL` | `gpt-5.6-terra` |
| Routing and structured decisions | `OPENAI_ROUTER_MODEL` | `gpt-5.6-luna` |
| AI Realtime calls | `OPENAI_REALTIME_MODEL` | `gpt-realtime-2.1` |
| Recorded-audio transcription | `OPENAI_TRANSCRIBE_MODEL` | `gpt-4o-mini-transcribe` |
| Text-to-speech | `OPENAI_TTS_MODEL` | `gpt-4o-mini-tts` |

Set the OpenAI credential as `OPENAI_KEY`. `OPENAI_API_KEY` is supported as a fallback for standard OpenAI tooling and existing deployments.

Google Gemini is retained only for image generation and for planning Lyria music requests. Lyria is retained only for music generation. Gemini chat, Gemini TTS, Gemini Live, and Google Cloud Speech-to-Text are not part of Convia's text or voice paths.

Image generation tries these Gemini models in order:

- `gemini-3.1-flash-image-preview`
- `gemini-3-pro-image-preview`
- `gemini-2.5-flash-image`
- `gemini-2.0-flash-exp-image-generation`

Music generation uses `models/lyria-realtime-exp`.

## Environment variables

Backend credentials and service configuration:

- `OPENAI_KEY` (or `OPENAI_API_KEY` fallback)
- `OPENAI_SAFETY_SALT` in Cloud Run, unless a production `SESSION_SECRET` supplies the stable salt source
- `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) for image and music only
- `SESSION_SECRET`
- `ABLY_KEY`
- `BLOB_READ_WRITE_TOKEN` (with the existing `spices_READ_WRITE_TOKEN` and `VITE_BLOB_READ_WRITE_TOKEN` fallbacks)
- `FIRESTORE_PROJECT_ID` and `FIRESTORE_DATABASE_ID` when overriding the existing internal project/database names
- `GOOGLE_CLIENT_ID` for Google sign-in
- `ENABLE_TESTER_LOGIN`: local development defaults to enabled; Cloud Run defaults to disabled. Set explicitly to `true` only for a controlled test deployment.

## OpenAI cost controls

Every OpenAI-backed route requires an authenticated server session and applies a Firestore transaction quota keyed by the verified account ID and capability. Current limits are:

| Capability | Per minute | Per hour |
| --- | ---: | ---: |
| Text chat and private assist | 20 | 200 |
| Recorded AI voice chat | 6 | 40 |
| Transcription | 12 | 100 |
| Text-to-speech | 20 | 120 |
| Realtime session issuance | 3 | 20 |

Rejected requests return HTTP `429`, a `Retry-After` header, and a stable JSON error. Quota storage failures fail closed with HTTP `503`. A provider owner consumes quota once immediately before its provider attempt, even when the provider later fails. Completed idempotent replays and concurrent request losers do not consume quota; a quota rejection releases the request lease so the same request can be retried later.

Text chat and assist input is limited to 20,000 characters, direct TTS input is capped at 4,096 characters (with tighter product read-aloud limits where applicable), and decoded audio is capped at 10 MiB. Authentication, schema/input checks, request-ID conflicts and completed replays, contact existence, and friendship validation happen before quota consumption and provider calls.

## Local development

Run the frontend and backend together:

```bash
./dev.sh
```

Default local URLs:

- Web: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:8080`

## Tests

Run the complete backend suite from the API directory:

```bash
cd api
pytest -q
```

Run the complete frontend suite and production build from the web directory:

```bash
cd web
npm test
npm run build
```
