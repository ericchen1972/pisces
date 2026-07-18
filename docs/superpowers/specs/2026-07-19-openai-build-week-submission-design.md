# OpenAI Build Week Submission Design

## Goal

Prepare Convia for OpenAI Build Week judging without producing the demo video. The submission must present a reproducible public project, give judges immediate access to two isolated demo accounts, and explain Convia's product argument in the author's original direct voice.

The primary meaningful extension after the July 13, 2026 submission-period start is the replacement of the prior interface with a coherent ChatGPT-like desktop and mobile experience. The submission will also document the OpenAI migration, shared Convia participation in human conversations, communication forwarding, voice features, testing, and deployment work completed during the eligible period.

## Product Position

The submission will make this argument directly:

> ChatGPT Desktop's attempt to merge everyday conversation and Codex into one product is a failure of product shape. Coding work and daily human communication do not share the same rhythm, context, or purpose. Codex deserves a focused workspace. ChatGPT is better suited to becoming a messenger: a place where AI participates in real relationships and finally becomes the everyday life entry point OpenAI has repeatedly said it wants to build.

Convia is presented as a working demonstration of that position, not as a generic collection of AI chat features. Its differentiating product flow is:

1. Two real people have a shared conversation.
2. Convia can join that conversation as an identifiable third participant.
3. Both people can see shared Convia replies.
4. Convia can understand contact and conversation context and relay a message while keeping its own third-person identity.
5. Private Convia chat, Realtime voice, transcription, text-to-speech, image, and music capabilities support the product but do not replace the core story.

The Devpost category will be **Apps for Your Life**.

## Demo Account Architecture

### Accounts

Create or normalize exactly two public judge accounts:

- Judy: `judy@gods.tw`
- Haland: `haland@gods.tw`

The account seed operation must be idempotent. Running it repeatedly must not create duplicate users, friendships, chat metadata, groups, or sample messages. Judy and Haland must be mutual friends and appear in each other's contact lists with usable default group metadata.

### Authentication Boundary

Production's arbitrary tester-login capability remains disabled. The public exception applies only to the two exact normalized email addresses above.

- Remove the Judy source-IP requirement.
- Do not expose a production form accepting arbitrary tester email addresses.
- Reject every non-allowlisted demo identity even when a caller submits a valid-looking email.
- Keep ordinary Google sign-in, session validation, authorization, friendship validation, quotas, and API behavior unchanged.
- Mark demo sessions with the existing tester provider or an equally narrow server-side marker so they remain distinguishable from Google accounts.

### Window and Cookie Isolation

Opening two ordinary windows on the same hostname would share the Flask session cookie and cause the second login to replace the first. The approved solution is to serve the same deployed frontend through two dedicated Vercel hostnames:

- one Judy demo hostname;
- one Haland demo hostname.

Each hostname uses the existing same-origin `/api` proxy. The Flask session cookie remains host-scoped by the browser, so the two windows can stay logged into different accounts without adding bearer-token authentication or changing normal API authorization.

The canonical login page opens the selected hostname in a new window. The dedicated hostname performs a one-time allowlisted demo login and then removes any transient login query or route state from the visible URL. Refreshing the resulting app keeps the established host-scoped session.

If either Vercel alias cannot be created, deployment is not considered complete. Do not silently fall back to two same-host windows.

## Login Experience and Localization

Keep the current Convia login visual system and Google sign-in. Add two visible demo actions:

- Traditional Chinese: `用 Judy 登入`, `用 Haland 登入`
- English: `Sign in as Judy`, `Sign in as Haland`

Both actions open a new window and leave the original login page available.

Use the existing locale normalization contract. Traditional Chinese browser locales, including supported `zh-TW` and Hant forms, receive Traditional Chinese. Every other locale, including Simplified Chinese, receives English. Do not use IP geolocation for language or button visibility.

The former IP-dependent Judy capability is removed from the frontend session-capability response and from backend visibility decisions. The two demo buttons are public judge entry points, while the generic tester-login UI remains controlled by the existing local or explicit tester capability.

## Submission Artifacts

### README

Rewrite and extend `README.md` so a judge can understand and run the project without prior context. It will include:

1. Direct product thesis and target audience.
2. The primary July 13+ meaningful extension: the ChatGPT-like interface redesign.
3. A concise before/after section separating pre-existing work from eligible Build Week work.
4. Working production and demo links.
5. A two-window Judy/Haland judge walkthrough.
6. Architecture and provider ownership.
7. Complete local setup steps for frontend and backend.
8. Required and optional environment variables without secret values.
9. Sample-data and demo-account behavior.
10. Test and production-build commands.
11. How Codex and GPT-5.6 were used, what Codex accelerated, and which product and engineering decisions remained human decisions.
12. The primary `/feedback` Codex task identifier and instructions for obtaining the formal feedback value if the submission form requires a generated value rather than the task UUID.
13. Known limitations and judge troubleshooting.

### Devpost Draft

Create `docs/hackathon-submission.md` in English with submission-ready content:

- project name and one-line tagline;
- problem statement;
- direct ChatGPT Desktop and Codex product critique;
- what Convia does;
- eligible Build Week changes, led by the ChatGPT-like redesign;
- how it was built;
- use of Codex and GPT-5.6;
- challenges and decisions;
- accomplishments;
- lessons learned;
- next steps;
- judge testing instructions;
- repository URL `https://github.com/ericchen1972/pisces` and the real deployed demo links recorded after Vercel alias provisioning; invented or unverified URLs are not permitted.

The video is explicitly outside this work.

### Repository Hygiene

- Add an MIT `LICENSE` file.
- Make dependency installation reproducible enough for judging, including explicit Python and Node setup instructions. Pin Python dependencies where current compatibility can be verified without destabilizing production.
- Ensure the public repository contains every change used by the deployed demo.
- Add a lightweight CI workflow only if it can run the existing backend and frontend suites reliably within the remaining submission window.
- Confirm no secrets, local environment files, private identifiers, browser state, or production credentials are tracked.

## Data Flow

1. A judge opens the canonical Convia login page.
2. The page selects Traditional Chinese only for supported Traditional Chinese browser locales; otherwise it uses English.
3. The judge clicks Judy or Haland.
4. The browser opens the corresponding dedicated hostname in a new window.
5. That hostname requests the allowlisted demo login for its fixed identity.
6. The backend verifies the exact identity, establishes the existing Flask session, and returns the normal authenticated account payload.
7. The frontend enters Convia with the standard authenticated application flow.
8. Opening the other account uses the other hostname and therefore a separate cookie jar entry.
9. Judy and Haland can exchange messages through the normal friendship, persistence, Ably, and authorization paths.

No demo-only bypass is added to message authorization, OpenAI quotas, friendship validation, media validation, or account settings.

## Error Handling

- Popup blocked: keep the canonical page intact and show a localized instruction to allow the new window.
- Demo hostname unavailable: show a localized, actionable error; do not log the other identity into the same hostname.
- Allowlisted login rejected: return a stable JSON error without revealing account internals.
- Seed partially fails: abort deployment readiness and rerun the idempotent seed after fixing the cause.
- Missing friendship: report failed demo readiness rather than creating it during an ordinary judge chat request.
- Realtime delivery unavailable: persisted messages remain visible after refresh under existing reconciliation behavior.

## Testing

### Backend

- Exact Judy and Haland identities can use the public demo exception.
- Case and surrounding whitespace normalize safely.
- Any other email is rejected in production when arbitrary tester login is disabled.
- No IP header or remote address changes the allowlist result.
- Ordinary Google and local tester-login behavior remains intact.
- Account seeding is idempotent and produces a symmetric active friendship plus required group metadata.

### Frontend

- English and Traditional Chinese labels follow the browser-locale contract.
- Simplified Chinese and all non-Traditional-Chinese locales receive English.
- Both actions request a new window with the correct dedicated hostname.
- Popup failure is visible and localized.
- Generic tester login remains hidden in production unless explicitly enabled.
- Existing Google sign-in and authenticated-entry tests continue to pass.

### Integration and Deployment

- Run all backend tests.
- Run all frontend tests and the production build.
- Verify repository whitespace and secret scans.
- Deploy backend changes and the frontend from the repository root.
- Assign and verify both dedicated Vercel hostnames.
- Seed Judy and Haland once, then rerun the seed to prove idempotency.
- Open both accounts concurrently and verify host-scoped sessions remain distinct.
- Send a Judy-to-Haland message and a Haland-to-Judy message.
- Verify both users can invoke Convia in their shared conversation.
- Verify the public repository commit matches the deployed implementation.

## Completion Criteria

The work is complete only when:

- the two public demo buttons work from the canonical login page;
- Judy and Haland remain simultaneously logged in through isolated hostnames;
- they are mutual friends and can exchange messages;
- arbitrary tester identities remain disabled in production;
- English and Traditional Chinese behavior matches the browser locale;
- README, Devpost draft, MIT license, setup instructions, eligible-work evidence, Codex collaboration description, and judge walkthrough are committed and pushed;
- backend tests, frontend tests, production build, live demo checks, and repository/deployment synchronization pass;
- no demo video is created as part of this work.
