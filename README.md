# Pisces

**AI-First Communication App**

Pisces is a communication app where your AI is a first-class contact.
It supports normal user-to-user chat and AI-assisted communication in the same interface.

## What Pisces Is For

Pisces helps users:
- Chat with their own AI as a communication partner
- Ask AI for advice inside a friend conversation without leaving the chat flow
- Let AI relay messages to friends (as AI, or in the user's name)
- Generate media content (image / music) and attach it to chat
- Use voice interactions (speech-to-text, text-to-speech, and Gemini Live call mode)

## Current Architecture

- Frontend: React (Vite), deployed on Vercel
- Backend: Python Flask, deployed on Google Cloud Run
- Database: Firestore
- Realtime delivery: Ably channels (`user_<user_id>`)
- Media storage: Vercel Blob

### Service Endpoints
- Web: `https://pisces-plum.vercel.app/`
- API: `https://pisces-315346868518.asia-east1.run.app`

## AI Models and AI Services in Use

### Gemini (Google AI)
- Chat / planning / tool decisions: `gemini-2.5-flash`
- TTS: `gemini-2.5-pro-preview-tts`
- Live voice call: `gemini-2.5-flash-native-audio-preview-12-2025`
- Image generation (fallback candidates):
  - `gemini-3.1-flash-image-preview`
  - `gemini-3-pro-image-preview`
  - `gemini-2.5-flash-image`
  - `gemini-2.0-flash-exp-image-generation`
- Music generation: `models/lyria-realtime-exp`

### Google Cloud APIs
- Speech-to-Text: Google Cloud Speech API (for recorded voice transcription)

## Key Product Behaviors (Implemented)

- AI-first contact list: first contact is always Pisces AI
- AI Assist mode in friend chat:
  - Creates private AI-assist exchange blocks
  - Can relay final output to the friend when requested
- Message relay identity:
  - `as_user=true`: message is sent as user
  - `as_user=false`: message is sent as AI proxy
- Per-user AI settings:
  - AI name/avatar
  - Voice and global prompt
  - History range (controls how much context AI can read)
- Per-friend settings:
  - Alias
  - Special prompt
  - Relationship label (private to current user)

## Data Model (High Level)

- `users`
  - profile info, AI settings, identify code, history range
- `users/<user_id>/chats/<contact_id>/messages`
  - chat timeline (text/audio/image/music URL, sender role, visibility)
- `friendships`
  - accepted relationship, alias/special_prompt/relationship per side
- `err_log`
  - tool and runtime diagnostic logs

## Environment Variables

Required (backend):
- `GEMINI_API_KEY` (or `GOOGLE_API_KEY`)
- `SESSION_SECRET`
- `ABLY_KEY`
- `BLOB_READ_WRITE_TOKEN` (or `spices_READ_WRITE_TOKEN` / `VITE_BLOB_READ_WRITE_TOKEN` fallback)

Optional / deployment-specific:
- `FIRESTORE_PROJECT_ID`
- `FIRESTORE_DATABASE_ID`
- `GOOGLE_CLIENT_ID`

## Local Development

Run both frontend and backend:

```bash
./dev.sh
```

Default local URLs:
- Web: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:8080`

## Notes

- AI tool orchestration is semantic (not keyword-only).
- Live-call context and chat-assist context are intentionally separated.
- In AI room, additional friend context can be injected via `about_friend` logic when user mentions a specific contact.
