# Convia

**AI belongs in human conversation, not bolted onto a coding workspace.**

ChatGPT Desktop's attempt to merge everyday conversation and Codex into one product is a failure of product shape. Coding work and daily human communication do not share the same rhythm, context, or purpose. Codex deserves a focused workspace. ChatGPT is better suited to becoming a messenger: a place where AI participates in real relationships and finally becomes the everyday life entry point OpenAI has repeatedly said it wants to build.

Convia is a working version of that argument. It combines person-to-person messaging with an AI participant that can join a shared conversation, understand contact context, and relay messages without pretending to be either person.

This project is submitted to **OpenAI Build Week — Apps for Your Life**.

## Try the working project

- Main app: [https://pisces-plum.vercel.app/](https://pisces-plum.vercel.app/)
- Judy demo window: [https://convia-judy.vercel.app](https://convia-judy.vercel.app)
- Haland demo window: [https://convia-haland.vercel.app](https://convia-haland.vercel.app)
- Repository: [https://github.com/ericchen1972/pisces](https://github.com/ericchen1972/pisces)

The two demo hostnames serve the same application but keep separate host-scoped Flask session cookies. This lets judges use Judy and Haland at the same time in one browser without weakening the normal authentication rules.

### Judge walkthrough

1. Open the main app.
2. Click **Sign in as Judy**. Judy opens in a new window.
3. Return to the main app and click **Sign in as Haland**. Haland opens on a different hostname.
4. Keep both windows open. Judy and Haland are already mutual friends.
5. Send a message from Judy to Haland and reply from Haland.
6. In their shared conversation, invoke Convia and verify that both people can see the AI response.
7. Open the fixed Convia contact to try private AI chat, media generation, recorded voice, or a Realtime voice call.

Browser locales normalized to Traditional Chinese (`zh-TW` and supported Hant forms) receive Traditional Chinese labels. Every other locale, including Simplified Chinese, receives English.

## What changed during Build Week

Convia existed before the submission period as an experimental Pisces messaging application. Work added after the submission period began on July 13, 2026 is documented by dated commits and Codex task history.

The largest meaningful extension is the complete **ChatGPT-like interface redesign**:

- the previous purple, phone-shaped interface became a coherent dark desktop and mobile messaging product;
- the conversation surface gained a centered composer, white user bubbles, and unbubbled Convia responses;
- responsive contact groups and settings were integrated into the product instead of remaining separate experiments;
- login, mobile navigation, conversation defaults, unread state, and account-scoped UI behavior were rebuilt and regression-tested.

The eligible extension also includes:

- migration of visible text and structured decisions to OpenAI Responses;
- migration of transcription and speech synthesis to OpenAI Audio APIs;
- migration of AI calls to OpenAI Realtime over WebRTC;
- shared Convia mentions inside real-person conversations;
- context-aware third-person message forwarding;
- request idempotency, friendship-generation validation, delivery reconciliation, quotas, and bounded inputs;
- two isolated judge accounts and a reproducible public demo flow.

Gemini remains only for image generation and for planning Lyria music requests. It is not a fallback for Convia text, routing, speech, or calls.

## What Convia does

- Real-time person-to-person messaging with Firestore persistence and Ably delivery.
- A fixed Convia contact for private AI conversation.
- Shared Convia participation in a conversation between two real people.
- Context-aware forwarding that keeps Convia in its own third-person role unless the user explicitly asks otherwise.
- OpenAI Responses streaming and structured routing.
- OpenAI transcription, text-to-speech, and Realtime voice calls.
- Gemini image generation and Lyria music generation as independent media tools.
- Account-synchronized contact groups, settings, unread state, and responsive desktop/mobile behavior.

## Architecture

- Frontend: React 18 and Vite 5 on Vercel
- Backend: Python and Flask on Google Cloud Run
- Database: Firestore
- Realtime delivery: Ably channels named `user_<user_id>`
- Media storage: Vercel Blob
- OpenAI: Responses, Audio, and Realtime APIs

Production keeps existing internal identifiers for compatibility:

- API: `https://pisces-315346868518.asia-east1.run.app`
- AI contact ID: `pisces-core`
- Repository and service name: `pisces`

## AI models

| Capability | Environment variable | Default |
| --- | --- | --- |
| Visible text replies | `OPENAI_TEXT_MODEL` | `gpt-5.6-terra` |
| Routing and structured decisions | `OPENAI_ROUTER_MODEL` | `gpt-5.6-luna` |
| AI Realtime calls | `OPENAI_REALTIME_MODEL` | `gpt-realtime-2.1` |
| Recorded-audio transcription | `OPENAI_TRANSCRIBE_MODEL` | `gpt-4o-mini-transcribe` |
| Text-to-speech | `OPENAI_TTS_MODEL` | `gpt-4o-mini-tts` |

## Local setup

### Requirements

- Node.js 20
- Python 3.12 or newer
- A Firestore project or configured Google service-account credentials
- OpenAI, Ably, and Vercel Blob credentials for their corresponding features
- A Gemini key only if image or music generation is required

### Backend

```bash
cd api
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp config.example.json config.json
```

Replace the example values in the untracked `api/config.json`, then start Flask:

```bash
FLASK_APP=main flask run --debug --host 127.0.0.1 --port 8080
```

### Frontend

```bash
cd web
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

Or run both services from the repository root after the backend environment is prepared:

```bash
./dev.sh
```

### Environment variables

Backend credentials and configuration:

- `OPENAI_KEY`, with `OPENAI_API_KEY` supported as a fallback
- `OPENAI_SAFETY_SALT`
- `GEMINI_API_KEY`, with `GOOGLE_API_KEY` supported as a fallback for media only
- `SESSION_SECRET`
- `ABLY_KEY`
- `BLOB_READ_WRITE_TOKEN`
- `FIRESTORE_PROJECT_ID` and `FIRESTORE_DATABASE_ID`
- `GOOGLE_CLIENT_ID`
- `ENABLE_TESTER_LOGIN`: defaults to enabled locally and disabled on Cloud Run

Frontend build configuration:

- `VITE_DEMO_JUDY_URL=https://convia-judy.vercel.app`
- `VITE_DEMO_HALAND_URL=https://convia-haland.vercel.app`

The production tester exception accepts exactly `judy@gods.tw` and `haland@gods.tw`. It does not enable arbitrary tester email login, bypass friendship checks, or bypass OpenAI quotas.

## Demo data

Run the idempotent seed command with Firestore credentials configured:

```bash
cd api
.venv/bin/python scripts/seed_build_week_demo.py
```

It creates or normalizes Judy and Haland, creates their default contact groups when absent, establishes one accepted mutual friendship, and places each friend in the other's default group. Re-running it does not duplicate accounts, groups, friendships, or chat metadata and does not delete judge conversations.

## Tests

Backend:

```bash
cd api
.venv/bin/pytest -q
```

Frontend and production build:

```bash
cd web
npm test -- --run
npm run build
```

GitHub Actions runs the same backend, frontend, and build checks on pushes and pull requests.

## Cost and security boundaries

Every OpenAI-backed route requires an authenticated server session. Firestore transactions enforce per-account capability quotas. Authentication, schema limits, request conflicts, completed replays, contact existence, and friendship validation occur before provider calls.

Current limits:

| Capability | Per minute | Per hour |
| --- | ---: | ---: |
| Text chat and shared Convia | 20 | 200 |
| Recorded AI voice chat | 6 | 40 |
| Transcription | 12 | 100 |
| Text-to-speech | 20 | 120 |
| Realtime session issuance | 3 | 20 |

The public demo accounts are an authentication allowlist, not an authorization bypass. All normal data ownership, friendship, delivery, input-size, media, and quota checks still apply.

## How Codex and GPT-5.6 were used

The primary Codex task for the eligible core implementation is:

```text
019f6400-da42-7353-abc6-a45ecca1e4f1
```

Use `/feedback` in that task if the Devpost field requires the generated feedback identifier rather than the task UUID.

Codex and GPT-5.6 accelerated:

- repository-wide migration planning and dependency tracing;
- the ChatGPT-like React redesign across desktop and mobile;
- OpenAI Responses, Audio, and Realtime integration;
- shared-conversation and forwarding data-flow implementation;
- test-first regression fixes for authentication, messaging, mobile event order, replay, quotas, and delivery;
- Cloud Run and Vercel deployment verification;
- preparation of judge access and reproducible submission materials.

The human decisions were the product thesis, the rejection of the current ChatGPT Desktop/Codex product shape, the Messenger direction, the rule that Convia keeps its own identity, the two-person shared-AI experience, the visible design criteria, and the final scope.

## Known limitations

- Google sign-in requires a configured client ID and authorized origins.
- Realtime delivery depends on Ably; persisted messages reconcile after refresh if realtime delivery is interrupted.
- Image and music generation use separate experimental Google providers and may have provider availability limits.
- The two demo aliases must continue pointing to the same verified Vercel production deployment for the documented judge flow.

## License

[MIT](LICENSE)
