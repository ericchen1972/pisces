# Convia — OpenAI Build Week Submission

## Category

Apps for Your Life

## Tagline

AI belongs in human conversation, not bolted onto a coding workspace.

## Inspiration

ChatGPT Desktop's attempt to merge everyday conversation and Codex into one product is a failure of product shape. Coding work and daily human communication do not share the same rhythm, context, or purpose. Codex deserves a focused workspace.

ChatGPT is better suited to becoming a messenger. That is where an AI can participate in the relationships and conversations that already structure a person's life. It is also a more credible path toward the everyday life entry point OpenAI has repeatedly said it wants to build.

Convia is my working argument for that direction.

## What it does

Convia combines real person-to-person messaging with an AI participant. Judy and Haland can talk normally, invoke Convia inside their shared conversation, and both see the same AI reply. In the private Convia room, a user can ask Convia to contact a friend. Convia uses recent conversation and contact context to identify the recipient, then relays the message in its own third-person voice instead of impersonating the user.

The product also includes private AI chat, streaming responses, voice recording, transcription, text-to-speech, a Realtime AI call, contact groups, unread state, image generation, and music generation.

The central idea is not that chat needs more AI tools. It is that AI should become a recognizable participant in communication between real people.

## The Build Week extension

Convia existed before the July 13, 2026 submission-period start as an experimental Pisces messenger. The submission evaluates the meaningful extension built after that date.

The largest change is a complete ChatGPT-like interface redesign. The old purple, phone-shaped experiment became a coherent dark desktop and mobile product with a centered composer, white user messages, unbubbled Convia replies, responsive contact navigation, integrated settings, account-synchronized contact groups, and tested mobile behavior.

The eligible extension also migrated text and structured decisions to OpenAI Responses, recorded speech to OpenAI Audio, AI calls to OpenAI Realtime, and added shared Convia replies inside human conversations. The delivery path now includes request idempotency, bounded history, account quotas, friendship-generation validation, realtime reconciliation, and safer third-person forwarding.

For judging, I added two exact public demo identities. Judy and Haland open on different Vercel hostnames, so their existing Flask cookie sessions remain isolated even when both windows are used in one browser. They are seeded as mutual friends through an idempotent Firestore operation. Arbitrary production tester login remains disabled.

## How we built it

The frontend uses React 18 and Vite on Vercel. The backend uses Flask on Google Cloud Run. Firestore stores users, friendships, settings, contact groups, messages, delivery receipts, quotas, and request ownership. Ably delivers realtime events, and Vercel Blob stores media.

OpenAI Responses handles visible text and structured routing. OpenAI Audio handles transcription and text-to-speech. OpenAI Realtime provides WebRTC voice calls. Gemini remains isolated to image generation and planning Lyria music requests; it is not a fallback for Convia's text or voice paths.

The browser calls the backend through same-origin Vercel rewrites, keeping Flask sessions first-party. The two judge hostnames point to the same frontend build but receive distinct host-scoped cookies.

## How Codex and GPT-5.6 were used

Codex task: `019f6400-da42-7353-abc6-a45ecca1e4f1`

Codex and GPT-5.6 were used throughout the eligible implementation, not only to generate a final screen. They traced the existing provider boundaries, helped plan the redesign and OpenAI migration, changed backend and frontend code, wrote regression tests before fixes, reviewed idempotency and authorization paths, ran the full test suites, deployed Cloud Run and Vercel, and verified production behavior.

Codex accelerated repetitive repository-wide work and made it practical to test interactions that cross React, Flask, Firestore, Ably, and OpenAI. The dated commit history and the task above distinguish the eligible Build Week work from the earlier Pisces prototype.

The product decisions remained mine: ChatGPT Desktop and Codex should not be one product shape; ChatGPT should become a Messenger; Convia must keep its own identity; AI replies in human conversations should be shared; and the largest visual change should feel unmistakably ChatGPT-like.

## Challenges

The hardest problem was not producing an AI response. It was preserving trustworthy communication semantics around that response.

A shared AI reply must be visible to both people, charged once, replay safely, remain bound to the active friendship generation, and survive realtime delivery failure. A forwarded message must use the recipient's understanding of a person's name while still tagging the public sender correctly. Voice, media, and streaming paths must not silently switch providers or lose committed messages after a publish error.

Judge access introduced another subtle problem: two ordinary windows on one hostname share the same cookie session. Opening Haland would log the Judy window into Haland. The final design uses two hostnames and the original cookie authentication instead of adding a second bearer-token system.

## Accomplishments

- Turned an experimental phone mockup into a runnable desktop and mobile product.
- Put Convia inside a real conversation between two people.
- Preserved Convia's third-person role during contextual forwarding.
- Migrated core text and voice capabilities to OpenAI APIs.
- Added transactional quotas, idempotent replay, bounded inputs, and reconciliation tests.
- Built two simultaneous judge accounts without opening arbitrary tester access.
- Maintained hundreds of backend and frontend regression tests plus a reproducible production build.

## What we learned

An AI communication product needs a role, not only a model. The moment AI participates between people, identity, visibility, authorization, delivery, and failure behavior matter as much as answer quality.

The project also reinforced the original thesis: Codex works best as a focused engineering environment. ChatGPT has a different opportunity. It can become the place where people, relationships, and AI meet.

## What's next

The next product step is to make shared AI participation easier to discover without turning every conversation into an AI thread. That includes clearer consent controls, richer group conversations, portable relationship context, and more explicit controls over what Convia can remember or relay.

The larger direction remains Messenger-first: build the everyday communication surface first, then let specialized agents participate through clear identities and permissions.

## How judges can test it

1. Open [https://pisces-plum.vercel.app](https://pisces-plum.vercel.app).
2. Select **Sign in as Judy**.
3. Return to the original login page and select **Sign in as Haland**.
4. Keep the two resulting hostnames open side by side.
5. Send a message in each direction.
6. Invoke Convia in the Judy/Haland conversation and verify the reply is shared.
7. Use the fixed Convia contact to try private AI text or voice features.

The buttons use Traditional Chinese only for Traditional Chinese browser locales. Every other browser locale receives English.

## Links

- Application: [https://pisces-plum.vercel.app](https://pisces-plum.vercel.app)
- Judy: [https://convia-judy.vercel.app](https://convia-judy.vercel.app)
- Haland: [https://convia-haland.vercel.app](https://convia-haland.vercel.app)
- Source: [https://github.com/ericchen1972/pisces](https://github.com/ericchen1972/pisces)
