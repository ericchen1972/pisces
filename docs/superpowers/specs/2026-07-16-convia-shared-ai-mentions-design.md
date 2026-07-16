# Convia Shared AI Mentions and Chat Polish Design

## Goal

Replace the private AI-assist mode in human conversations with a server-authoritative, shared Convia invocation. A typed message whose first word is `Convia`, matched case-insensitively, asks Convia to answer using the shared conversation and the caller's global prompt. Both participants see the invocation and the AI response.

The change also simplifies the composer and Convia settings while preserving recorded voice messages and the dedicated AI voice-call experience.

## User Experience

### Shared Convia invocation

- Only typed text in a human-to-human conversation is eligible for invocation detection.
- Leading whitespace is ignored.
- `Convia` is matched case-insensitively as the first complete word.
- After `Convia`, the client may use whitespace, a comma, a colon, or their full-width equivalents. Examples include `convia check this`, `Convia, check this`, and `CONVIA：查一下`.
- A word that only starts with the same letters, such as `Conviable`, does not invoke AI.
- A message containing `Convia` anywhere other than the beginning is an ordinary shared message.
- The invocation message is saved and shown as the caller's normal shared message.
- The Convia response is saved and shown as a shared AI message with no bubble. Both participants see the same response.
- The dedicated Convia room keeps its existing direct AI-chat behavior and does not require the prefix.

### Failure behavior

- The caller's invocation message remains saved if OpenAI generation fails.
- No shared placeholder or technical-error message is written as Convia.
- Only the caller sees a localized transient error saying that Convia cannot respond right now.
- Firestore remains authoritative if realtime publication fails. The shared AI response appears after refresh or reconciliation.

### Composer

- Focusing the message textarea does not add a border, outline, ring, or glow. The existing rounded composer container remains visible.
- The attachment button and attachment panel are hidden. Existing backend attachment compatibility and rendering for historical messages remain intact.
- The waveform `AI Assist` button and the old private-assist client flow are removed.
- The microphone recording button remains available in both human and Convia conversations.
- A recorded message in the Convia room is transcribed and sent to AI. The answer does not include synthesized speech; existing non-audio tool results such as generated images remain compatible.
- A recorded message in a human conversation remains a shared voice message sent to the contact. Its transcript does not invoke Convia even if it begins with the word `Convia`.
- Existing voice-message playback remains supported.
- The dedicated Convia Realtime voice-call feature remains supported.

### Message appearance

- The current user's ordinary messages use a white background with black text, matching the supplied ChatGPT reference.
- The other participant's messages retain the existing dark bubble treatment.
- Convia messages retain the ChatGPT-like no-bubble treatment and the `Convia` label.

### Convia settings

- The visible AI name is fixed to `Convia`; users cannot edit it.
- The AI avatar picker is centered in the dialog.
- The text `Convia` appears centered below the avatar.
- Voice selection, AI-generated-voice disclosure, preview controls, and preview errors are hidden.
- Avatar replacement and the global prompt remain editable.
- Stored voice settings and the underlying voice-call/TTS implementation remain compatible; hiding the settings does not remove those backend capabilities.

## Architecture

### Server-authoritative message flow

`POST /api/messages/send` remains the authoritative entry point for typed human messages.

1. Authenticate the caller and validate that the recipient is a current friend at the same friendship generation used by the existing delivery safeguards.
2. Apply the existing request identity and idempotency rules.
3. Persist the caller's typed message to both users as a normal shared message.
4. Detect the Convia prefix on the server. The client may show optimistic state but is not authoritative for detection.
5. If no invocation is present, finish the existing shared-message flow unchanged.
6. If invoked, fetch the caller's stored global prompt and build a bounded shared-conversation context.
7. Ask OpenAI for one text response.
8. Revalidate the friendship generation before shared AI persistence so deletion or revocation cannot leak a later response.
9. Persist one canonical Convia message to both users with the same message ID, timestamp, shared visibility, and caller/request provenance.
10. Publish the human and AI messages through the existing realtime channel. A publish failure does not undo durable writes.
11. Return the human-message result plus either the canonical AI response or a caller-only AI error state.

This design intentionally avoids a second client-orchestrated AI request and avoids adding a queue or worker service.

### Invocation parser

The invocation parser is a small, independently tested server helper. It returns either no invocation or the command text after stripping the supported prefix separator. A bare `Convia` is a valid invocation with an empty explicit command; the recent conversation provides its context.

The parser accepts:

- optional leading whitespace;
- `Convia` in any letter case;
- an end-of-message boundary or a following whitespace/comma/colon/full-width comma/full-width colon.

It rejects partial-word matches and occurrences later in the message.

### Shared context

- Select at most the 50 most recent messages visible to both participants, including the current invocation.
- Include human and shared Convia messages.
- Exclude `private_to_user`, old `assist_user`, old `assist_ai`, revoked, malformed, or non-shared records.
- Preserve chronological order after selecting the most recent records.
- Label each message with its actual speaker: caller, contact, or Convia.
- Bound each message and total context with the existing OpenAI input limits.
- Treat all conversation text as untrusted quoted history. It cannot override system instructions.
- Include caller and recipient identities only to attribute speakers; do not expose private account data beyond names already used in the conversation.

### Prompt ownership

- The backend loads the global prompt from the authenticated caller's account.
- The client cannot provide or override that prompt in the shared-message request.
- Simultaneous invocations from both participants are independent. Each invocation uses its own caller's global prompt.
- The global prompt controls style and preferences but does not override safety, visibility, authorization, or data-boundary rules.

### Shared AI message contract

The shared AI response uses a dedicated shared-AI role compatible with the current `ai_proxy` rendering and history normalization. It includes:

- one canonical deterministic message ID derived from the friendship generation and invocation request ID;
- `visibility: shared`;
- the triggering caller ID and client request ID as bounded provenance;
- text content only;
- no audio URL or private audio artifact;
- the same creation time in both users' conversation copies.

The recipient receives the normal unread increment and latest-message ordering update. The caller's copy is read. Existing reconciliation can recover missed realtime publication without duplicating the AI response.

### Idempotency and concurrency

- Replaying a completed request returns the stored human and AI results without another OpenAI call.
- Concurrent requests with the same request ID have one owner; losers return the canonical result and are not charged for OpenAI usage.
- Distinct simultaneous invocations may both generate replies and are ordered by their persisted timestamps.
- If generation succeeds but friendship revalidation fails, the response is not persisted or published and any temporary artifacts are cleaned up.
- Cost control is charged to the authenticated invocation owner only when that request actually reaches OpenAI.

## Compatibility and Removed Paths

- The human-conversation private-assist UI and client invocation path are removed.
- The obsolete `/api/assist/message` behavior is no longer called by the web client. Its server removal or explicit disabled response is allowed only after tests prove that no production UI depends on it; historical private messages remain untouched in Firestore and remain excluded from shared history.
- Attachment sending is removed from the visible composer, while attachment display and backend compatibility remain available for existing data and older clients.
- Human voice-message delivery, AI-room voice transcription, historical audio playback, and the dedicated AI voice call remain supported.

## Error Handling and Security

- Validate authentication, friendship, generation, text size, and request identity before any OpenAI call.
- Never log full conversation history, global prompts, provider secrets, or raw OpenAI error bodies.
- Return localized, generic caller-facing failures.
- Never persist provider error text as a shared message.
- Enforce the current OpenAI text quota and replay semantics.
- Recheck authorization after the provider call and before publishing shared output.
- Keep conversation history clearly separated from system instructions to reduce prompt-injection risk.

## Testing

### Backend

- Parser tests for letter case, leading whitespace, supported separators, bare `Convia`, later occurrences, and partial-word rejection.
- Context tests for the 50-message limit, chronological order, shared-role attribution, and exclusion of private/revoked/malformed records.
- Route tests proving ordinary text does not call OpenAI.
- Route tests proving an invocation uses the authenticated caller's global prompt and not client-provided data.
- Shared-persistence tests proving both copies have the same AI message ID, text, timestamp, visibility, and provenance.
- Unread and latest-message ordering tests for the recipient.
- Idempotent replay and concurrent-loser tests proving one OpenAI call and one canonical response.
- Friendship deletion/generation-race tests proving no post-revocation AI leak.
- Realtime failure tests proving durable success and later reconciliation.
- Provider-failure tests proving the caller message persists, no shared AI error is written, and only a generic caller error is returned.
- Voice tests proving human-room recordings remain shared voice messages and AI-room recordings produce replies without synthesized audio.

### Frontend

- Composer tests proving attachment and AI Assist controls are absent while microphone recording remains.
- Tests proving typed human-room invocations use the shared send path rather than the private-assist path.
- Tests proving voice messages in human rooms never trigger shared AI invocation.
- AI-room voice tests proving the response does not render or autoplay synthesized audio.
- AI settings tests for the fixed `Convia` label, centered avatar layout, hidden voice controls, editable avatar, and editable global prompt.
- Message-row tests for white/black self bubbles, retained peer bubbles, and no-bubble Convia messages.
- CSS tests or DOM assertions proving textarea focus does not add a border, ring, outline, or glow.

### Verification

- Run all backend and frontend automated tests, production frontend build, dependency audit, provider-boundary checks, and Python compilation.
- Verify desktop and 390-by-844 mobile layouts in the browser.
- Verify a two-user conversation in which one user invokes Convia and both accounts receive the same response.
- Verify the caller-specific prompt by invoking from each participant with distinguishable test prompts.
- Verify recorder behavior in both a human room and the Convia room.
- Verify the dedicated Convia voice call still connects and disconnects normally.
- After deployment, verify Cloud Run health, production authentication boundaries, Vercel status, responsive UI, and browser console logs.

## Out of Scope

- File or media attachment creation in the composer.
- Voice-triggered shared Convia mentions in human conversations.
- Synthesized AI voice replies to recorded messages.
- Human-to-human live calls.
- A background job queue or new worker service.
- Migration or deletion of historical private-assist messages.
