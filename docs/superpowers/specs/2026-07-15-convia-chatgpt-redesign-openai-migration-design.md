# Convia ChatGPT-Style Redesign and OpenAI Migration

Date: 2026-07-15  
Status: Approved design

## Objective

Rename the user-facing Pisces product to Convia and replace the existing purple glass, phone-shaped interface with a responsive, dark interface modeled closely on ChatGPT Web. Add account-synchronized contact groups and migrate AI text, transcription, text-to-speech, and live AI calls from Gemini or Google speech services to OpenAI APIs.

Internal identifiers, database names, service URLs, and compatibility strings containing `pisces` do not need to be renamed unless they are visible to users or directly prevent the new behavior.

## Scope

This project includes:

- A complete redesign of every user-visible screen, including login, chat, group management, friend management, settings, AI settings, image viewing, tester login, and AI calls.
- Desktop, tablet, and mobile layouts in the same implementation.
- Account-synchronized contact groups with default groups, renaming, ordering, deletion, assignment, and unread totals.
- ChatGPT-style conversation width, composer, dark visual hierarchy, and AI message treatment.
- OpenAI Responses API for visible AI replies and structured AI decisions.
- OpenAI Realtime API for calls with Convia AI.
- OpenAI transcription and text-to-speech for recorded voice workflows.
- Preservation of Gemini and Lyria only for image and music generation.
- Focused decomposition of the current large React file into maintainable UI components without rewriting unrelated working business logic.

This project does not include:

- User-to-user voice calls, incoming calls, call signaling, SIP, TURN, or a peer media relay service.
- A light theme.
- Manual drag-and-drop ordering of contacts or groups.
- A complete frontend rewrite or a new state-management framework.
- Renaming internal Firestore databases, Cloud Run services, URLs, session cookies, or stable internal IDs solely because they contain `pisces`.

## Brand, Theme, Localization, and Assets

- All user-visible product naming becomes **Convia**.
- The interface uses a ChatGPT-style dark theme only.
- Remove the centered phone frame, decorative background, purple glass effects, gradients, and ornamental Pisces branding from authenticated and unauthenticated screens.
- Use a plain text Convia wordmark unless a separate approved vector brand asset is later supplied.
- Detect the browser language. Traditional Chinese environments use Traditional Chinese; all other environments use English.
- Remove the current forced-English override.
- User-created and persisted group names are not translated after creation. The locale is used only when seeding the initial groups.
- Every UI control icon must be an inline SVG or a reusable React SVG component. Do not use PNG, WebP, emoji, or font glyphs as interface icons.
- Google profile photos, user-selected AI avatars, and chat media are content, not interface icons, and may remain raster images.
- A real contact always uses the contact's Google `avatar_url` in the sidebar, conversation header, and future call surfaces. Use initials only when the image is absent or fails to load.
- Convia AI uses the user's configured AI avatar with a bundled fallback.

## Responsive Application Shell

### Desktop and tablet

- Use a full-height two-column shell.
- The left sidebar is approximately 240–280 pixels wide and remains visible.
- The main conversation occupies the remaining width.
- Constrain message content and the composer to a centered readable column similar to ChatGPT Web.
- Keep the account and settings entry at the bottom of the sidebar.

### Mobile

- The conversation uses the full viewport.
- A menu button opens the same sidebar as a modal drawer.
- Close the drawer after selecting a contact.
- Use safe-area padding for the header and composer.
- Dialogs become full-width sheets or full-screen views when their desktop dimensions do not fit.

## Sidebar and Contact Groups

The top of the sidebar contains:

1. Convia wordmark and an SVG add-friend action.
2. A fixed Convia AI entry in the visual position occupied by ChatGPT's primary new-chat entry.
3. User contact groups.

Convia AI is not a member of a contact group and cannot be moved or deleted.

Seed four groups for an account that has no groups:

- Traditional Chinese: 家人, 朋友, 商務, 路人甲
- Other locales: Family, Friends, Business, Others

Each real contact belongs to exactly one group. The initial catch-all group is the default group for newly added or migrated contacts. The user's record stores `default_contact_group_id`. If the default group is deleted, the required deletion destination becomes the new default group.

Group rules:

- Group names may be changed.
- Names must be unique after Unicode normalization, trimming, whitespace collapsing, and case folding.
- At least one group must remain.
- A group containing contacts can be deleted only after the user selects an existing destination group.
- Deletion moves all contacts before removing the group.
- Group order is changed in the management dialog with up and down SVG buttons.
- Group ordering is synchronized to the account.
- Expanded or collapsed UI state is local to the current device.
- Contacts cannot be manually reordered.
- Contacts are ordered by descending `last_message_at`. Contacts without messages appear below active contacts and are ordered by localized display name.

Unread behavior:

- A collapsed or expanded group header shows the sum of unread messages for its contacts.
- An expanded contact row shows that contact's unread count.
- Counts over 99 may render as `99+`.
- Opening a conversation immediately clears the local count and calls the existing server mark-read behavior.
- Ably events update the contact count, recompute the group total, and move the contact to the top of its group.
- After an Ably reconnect, refetch group and friend metadata to reconcile missed events.

## Group and Contact Management

Provide a Group Manager dialog with:

- Inline rename.
- Duplicate-name validation.
- Up and down ordering controls.
- Add group.
- Delete group.
- A required destination selector when deleting a populated group.
- Save progress and inline server errors.

Each contact's overflow menu contains:

- Edit alias and existing per-contact AI settings.
- Move to group.
- Delete contact.

Mutations are server-confirmed rather than purely optimistic. Disable duplicate submissions. When the server succeeds but the client cannot apply the response, refetch authoritative group and friend data.

## Conversation Design

- The conversation header shows the selected contact's Google avatar and display name.
- The user's messages and the real contact's messages both use low-contrast dark bubbles, differentiated by alignment.
- AI-authored messages, AI Assist output, and AI proxy messages do not use bubbles. They use ChatGPT-like readable text, a small Convia AI label, and an optional action row.
- Private AI Assist output inside a real-contact conversation must be labeled as visible only to the current user.
- Preserve the existing distinction between normal real-person messages, private AI Assist exchanges, and relayed AI proxy messages.
- Preserve audio, image, and music rendering.
- Use a centered, rounded ChatGPT-style composer with SVG attachment, microphone, AI Assist, and send actions.
- The composer grows up to a defined maximum height and remains fixed above the mobile safe area.
- Stream visible AI text into a no-bubble message as it arrives.
- After an AI stream completes successfully, save the final message to Firestore.
- If a stream fails, keep the partial text in the current UI, mark it incomplete, and offer retry. Do not store incomplete output as a completed history message.

## Login, Settings, and Supporting Screens

- The login screen contains the Convia wordmark, a short product line, and Google sign-in on a plain dark background.
- Remove the simulated phone status bar and bottom mobile navigation.
- Account and general settings open from the bottom-left account entry.
- Use one reusable dark Dialog component for settings, add friend, tester login, confirmation, and editing workflows.
- Dialogs support Escape, focus trapping, visible focus indicators, field-associated errors, and keyboard operation.
- Preserve all existing settings and workflows unless this document explicitly replaces them.
- AI voice settings use OpenAI-supported voices and include a preview action.
- Clearly disclose that generated speech is AI-generated.

## Voice Call Semantics

There are three distinct call states:

### Convia AI conversation

- Show an enabled phone SVG action.
- Start a private OpenAI Realtime call with Convia AI.

### Real-contact conversation in normal mode

- Keep a phone SVG button visible as a disabled future affordance.
- Its tooltip or accessible description says that person-to-person voice calls are coming later.
- Do not request microphone permission or create a realtime session from this button.

### Real-contact conversation in AI Assist mode

- Show a separate AI voice-assist SVG action using a spark or waveform visual, not the disabled person-call phone action.
- This action starts a private OpenAI Realtime call with Convia AI.
- Include the selected contact's relationship and recent conversation context.
- The AI speaks only to the current user and does not pretend to be connected to the contact.

The existing Pisces implementation already follows the latter semantic at the backend: a call opened from a contact room connects to the AI with that contact's context. The redesign makes this distinction explicit instead of presenting it as a real-person call.

## Firestore Data Model

Create:

`users/{user_id}/contact_groups/{group_id}`

- `name`
- `normalized_name`
- `sort_order`
- `created_at`
- `updated_at`

Add to `users/{user_id}`:

- `default_contact_group_id`

Add to `users/{user_id}/chat_meta/{contact_id}`:

- `group_id`

Continue using existing chat metadata:

- `unread_count`
- `last_message_at`
- `last_message_preview`
- `last_read_at`

Do not persist a separate group unread total. Derive it from contact unread counts to avoid dual sources of truth.

## Group API Design

All endpoints require the existing authenticated session and operate only on the current user's records.

- `POST /api/contact-groups/bootstrap`
  - Creates defaults only when the account has no groups.
  - Accepts `locale` only for initial group names.
- `POST /api/contact-groups/list`
- `POST /api/contact-groups/create`
- `POST /api/contact-groups/update`
  - Supports rename.
- `POST /api/contact-groups/reorder`
  - Accepts the complete ordered group ID list.
- `POST /api/contact-groups/assign`
  - Assigns one contact to one group.
- `POST /api/contact-groups/delete`
  - Requires `group_id` and `move_to_group_id` when contacts exist.

Update `/api/friends/list` to return:

- `group_id`
- `last_message_at`
- `last_message_preview`
- `unread_count`

Use Firestore transactions or batch writes for uniqueness and destructive group operations. Chunk batch updates if a user has enough contacts to exceed a Firestore batch limit.

## OpenAI Service Architecture

Create `api/openai_service.py` to isolate provider calls, response parsing, structured decisions, audio conversion, and errors from Flask route code.

Read the API key with this precedence:

1. `OPENAI_KEY`
2. `OPENAI_API_KEY`

Both local `config.json` and Cloud Run environment variables remain supported through the existing configuration loader. Never return the standard API key to the browser or write it to logs.

Default models, with environment-variable overrides:

- Visible text replies: `gpt-5.6-terra`
- Routing, intent, AI Assist decisions, and structured media decisions: `gpt-5.6-luna`
- Live AI calls: `gpt-realtime-2.1`, initially with low reasoning effort
- Recorded audio transcription: `gpt-4o-mini-transcribe`
- Text-to-speech: `gpt-4o-mini-tts`

Use the Responses API for text and structured decisions. Firestore remains the sole conversation-history source. Send the selected history on each request instead of relying on OpenAI-hosted conversation state. Use a stable privacy-preserving hash of the internal user ID as `safety_identifier`.

Do not silently fall back from OpenAI to Gemini for text or voice. A provider failure must produce a retryable user-facing error. Gemini and Lyria remain independent providers only for image and music generation.

After migrating Gemini Live out of the frontend, remove the frontend `@google/genai` dependency if no remaining browser code requires it. Keep backend Google dependencies that are still required for image and music generation.

## Realtime AI Call Flow

1. The authenticated browser requests a short-lived Realtime client secret from Convia's Flask backend.
2. The backend calls OpenAI using `OPENAI_KEY` and binds the privacy-preserving user safety identifier.
3. The browser establishes a WebRTC call to OpenAI Realtime using only the short-lived secret.
4. The session receives the user's AI name, voice, global prompt, allowed history, and optional selected-contact context.
5. The browser handles media tracks, interruption, mute, connection state, and call teardown.
6. On close or error, stop all microphone and playback tracks and discard the short-lived credential.

The dynamic `about_friend` behavior remains available in the main Convia AI call. If the user mentions a known contact, inject only the minimum relevant private context into that AI session.

## Voice Settings Migration

- Existing Gemini voice names remain stored for compatibility but are not used for OpenAI speech.
- Add an OpenAI voice field rather than overwriting historical provider settings.
- If no OpenAI voice is selected, map the prior setting deterministically to `marin` or `cedar`.
- Let the user choose a supported OpenAI voice and preview it.
- Use a voice supported by both Realtime and TTS when one setting controls both experiences.

## Frontend Decomposition

Keep data coordination and existing complex behavior stable while extracting visual units:

- `App.jsx`: routing, authentication, and top-level orchestration.
- `features/chat/ChatShell.jsx`: responsive application shell.
- `features/chat/ContactSidebar.jsx`: AI entry, group list, account entry.
- `features/chat/ContactGroup.jsx`: group header, unread total, contact sorting.
- `features/chat/Conversation.jsx`: header and message timeline.
- `features/chat/MessageRow.jsx`: role-specific content and bubble rules.
- `features/chat/Composer.jsx`: input, recording, attachments, AI Assist, send.
- `features/groups/GroupManagerDialog.jsx`: group lifecycle and ordering.
- `features/calls/AiCallOverlay.jsx`: OpenAI Realtime call states.
- `components/Dialog.jsx` and focused form controls.
- `styles/tokens.css`, `styles/app-shell.css`, and feature-level style files.

Do not move every business function out of `App.jsx` in one pass. Extract provider logic and presentation boundaries required by this redesign, then preserve stable working flows behind explicit props and callbacks.

## Error and Recovery Behavior

- Disable repeated form submissions while a mutation is pending.
- Display validation errors beside the responsible field.
- Require confirmation for contact deletion and group deletion.
- Preserve unsent text when a send fails.
- Preserve recorded audio when transcription or upload fails so the user can retry.
- Preserve partial streamed AI text but do not commit it as completed history.
- On expired Realtime credentials, close the session and allow a fresh call attempt.
- On microphone denial, explain how to retry without repeatedly prompting.
- Always stop media tracks, audio contexts, timers, and realtime connections during call teardown or component unmount.
- Log provider errors without secrets, raw credentials, or unnecessary personal content.

## Accessibility

- All controls have accessible names.
- All icons are SVG and are either labeled controls or `aria-hidden` decoration.
- Menus and dialogs are keyboard-operable.
- Focus is trapped and restored correctly for dialogs and the mobile drawer.
- Use visible focus rings and sufficient dark-theme contrast.
- Respect reduced-motion preferences for drawer, typing, and call animations.
- Unread counts are available to assistive technology, not only shown visually.

## Testing Strategy

### Backend

- Default group bootstrap for Traditional Chinese and English.
- Group creation, normalized duplicate detection, rename, reorder, assignment, and authorization.
- Group deletion with contact movement and default-group reassignment.
- At-least-one-group invariant.
- Friend-list group metadata, unread count, preview, and last-message timestamps.
- OpenAI Responses request construction and streamed output parsing using mocks.
- Structured routing and AI Assist parsing using mocks.
- Transcription and TTS behavior using mocks.
- Realtime short-lived credential creation using mocks.
- No key or standard Realtime credential appears in API responses or logs.
- Gemini remains reachable only from image and music paths.

### Frontend

Add Vitest and React Testing Library for focused component and state tests:

- Group unread summation and sorting.
- Missing timestamp and missing avatar fallbacks.
- Local group collapse behavior.
- Mobile drawer open, close, focus, and contact selection.
- Human bubbles versus no-bubble AI messages.
- Private AI Assist labeling.
- Disabled person-call button and enabled AI voice-assist action.
- SVG icon usage for interface controls.
- Locale selection: Traditional Chinese versus English.
- OpenAI streaming success, partial failure, and retry state.

### Visual and Deployment Verification

- Check representative desktop, tablet, and mobile viewport sizes.
- Verify every modal and long settings form at small viewport heights.
- Run the frontend production build and backend test suite.
- Verify the deployed Cloud Run readiness and relevant authenticated API behavior.
- Verify the deployed Vercel login page, sidebar, real-contact chat, AI chat, AI Assist, group mutations, unread behavior, and AI call entry points.

## Acceptance Criteria

- No user-visible Pisces product name remains in the primary application experience.
- The full interface follows the approved ChatGPT-style dark direction on desktop and mobile.
- All user-visible screens use the shared visual system.
- All interface icons are SVG.
- Real contacts use Google avatars with initials fallback.
- Convia AI is fixed above the account's contact groups.
- Group definitions, names, order, default group, and contact membership synchronize through Firestore.
- A contact belongs to exactly one group and is sorted by the latest message time.
- Group and contact unread totals update correctly from live messages and read actions.
- Human-authored messages use bubbles; AI-authored messages do not.
- Text generation, AI decisions, transcription, TTS, and AI calls use OpenAI APIs.
- Image and music generation continue to use the existing Gemini or Lyria paths.
- A normal real-contact chat visibly reserves but does not implement person-to-person calling.
- AI calls work from the Convia AI room and as a clearly labeled private AI Assist call from a contact room.
- No provider secret is exposed to the browser or logs.
- Automated tests, production build, and proportional live verification pass before completion.

## Estimated Implementation Effort

For Codex-assisted implementation, testing, visual iteration, and deployment verification, estimate 10–18 hours of active work. The OpenAI migration, streaming, Realtime WebRTC, voice-setting migration, and regression testing account for the increase from the earlier UI-only estimate.
