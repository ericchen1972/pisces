# OpenAI Build Week Demo Video Design

## Objective

Create an English-language demonstration video for the Convia OpenAI Build Week submission. The video will use real production interactions captured from the Judy and Haland demo accounts, then use HyperFrames for editing, narration, captions, layout, transitions, and final delivery.

The video must remain under three minutes, clearly demonstrate the working product, and explain specifically how Codex and GPT-5.6 contributed to the eligible work completed after July 13, 2026.

## Delivery Format

- Runtime target: approximately 2 minutes 50 seconds, with a hard maximum of 2 minutes 55 seconds.
- Canvas: 1920 x 1080 landscape.
- Language: English narration and English captions.
- Narration: warm English AI female voice generated for this video, without imitating a real person.
- Audio: narration, restrained original interface sound effects, and necessary product audio only.
- Music: no copyrighted background music.
- Final publishing target: public YouTube video for the Devpost submission.
- Review sequence: HyperFrames Studio preview first; MP4 render only after explicit approval.

## Product Thesis

The video will state the product argument directly:

> Combining everyday ChatGPT conversation and Codex inside one Desktop product is the wrong product shape. Codex deserves a focused development workspace. ChatGPT is better suited to becoming a Messenger: a place where AI participates in real human relationships and becomes an everyday life entry point.

Convia is presented as a working version of this argument. It is not another isolated AI chat box. It is a messenger where two real people can talk normally and invite an identifiable AI participant into their shared conversation.

## Narrative Structure

### 0:00-0:20 — Direct thesis

Open with the ChatGPT Desktop and Codex product critique. Use restrained typography and brief real Convia interface details rather than generic AI imagery.

### 0:20-0:38 — Convia as the answer

Introduce Convia as an AI participant inside a real messenger. Establish Judy, Haland, and Convia as three distinct identities.

### 0:38-1:35 — Two independent users

Show the production Judy and Haland accounts. Judy is the main view and Haland appears in a floating picture-in-picture window. Demonstrate a natural conversation about meeting at a bar next Tuesday.

### 1:35-2:05 — Shared Convia reply

Judy invokes Convia inside the human conversation. At the moment the shared AI reply arrives, transition briefly to an equal 50/50 split so the same reply is visibly present for both users.

### 2:05-2:25 — Supporting capability

Show Judy privately asking Convia to relay a follow-up message to Haland. Verify that Haland receives the message from Convia in the third person. End the segment with a six-to-eight-second glimpse of the OpenAI Realtime voice interface. Do not include Gemini image generation in the video.

### 2:25-2:42 — Codex and GPT-5.6 evidence

Show approximately fifteen seconds of the real Codex workspace, dated commits, backend and frontend verification, and production deployment evidence. The narration must identify concrete contributions: tracing the existing authentication rules, designing the two-account exception, adding regression tests, preserving authorization boundaries, deploying, and diagnosing the initial deployment to the wrong Google Cloud project.

### 2:42-2:50 — Closing

End with the Convia logo, production URL, and the line:

> Codex is where we build. Convia is where AI lives with people.

## Product Conversation Script

The production interaction will use these human messages:

1. Judy: `Hey Haland, are you free next Tuesday night? Want to grab a drink?`
2. Haland: `I'm free after eight. The usual bar?`
3. Judy: `That works. I may be a few minutes late.`
4. Judy: `Convia, summarize our plan in one sentence for both of us. Keep it under 25 words.`

The Convia response must be the real production response. Its intended meaning is that Judy and Haland will meet at their usual bar next Tuesday after 8 PM and Judy may arrive a few minutes late. The video must not fabricate an AI response if the actual wording differs.

The private relay interaction will use:

- Judy to Convia: `Tell Haland I'll text when I'm on my way.`

The resulting Haland message must visibly identify Convia as the sender or relaying participant and must not impersonate Judy.

## Capture Architecture

### Browser capture

- Use the public production demo hosts for Judy and Haland.
- Capture the application with an English browser locale.
- Drive the real UI using Browser with stable, semantic controls.
- Record each narrative segment separately rather than attempting a single uninterrupted take.
- Preserve real waiting, delivery, and shared-state behavior in source captures, then remove only dead time during editing.
- Avoid displaying unrelated personal information, browser chrome, saved accounts, or private conversations.

### HyperFrames composition

- Use captured production media as the source of truth; do not recreate the Convia product UI in animation.
- Keep Judy as the readable hero view for most of the product demonstration.
- Present Haland in a bordered picture-in-picture panel at the lower right.
- Transition to a 50/50 split only when simultaneous visibility materially proves shared state.
- Use local zooms, pointer emphasis, and short text annotations to direct attention without obscuring product content.
- Use transitions between every scene and entrance animation for every new scene, following HyperFrames composition rules.
- Build static hero layouts before adding motion.

## Visual Identity

The composition will derive its visual identity from the deployed Convia interface and repository assets:

- dark graphite canvas;
- white user-message surfaces;
- unbubbled Convia responses;
- subtle gray borders and restrained shadows;
- the existing Convia wordmark and messenger logo assets;
- modern sans-serif typography consistent with the application;
- controlled, product-focused motion rather than neon AI effects or generic glowing gradients.

A project-specific `DESIGN.md` will record exact extracted colors, typography, spacing, motion rules, and prohibited visual patterns before composition HTML is written.

## Narration and Captions

- Write narration for a natural speaking pace that fits the verified 2:50 timing.
- Generate the approved warm English female voice through the HyperFrames narration workflow.
- Produce word-level timestamps and synchronize English captions to the actual narration audio.
- Captions must remain clear of the composer, contact names, message text, and picture-in-picture panel.
- Narration must accurately distinguish Codex/GPT-5.6 development work from the application's runtime OpenAI services.
- The video must explicitly explain both how Codex accelerated the work and what GPT-5.6 contributed to reasoning, implementation, testing, and debugging.

## Reliability and Error Handling

- Run a production preflight before capture: both demo logins, friendship, message delivery, shared Convia invocation, private relay, OpenAI response availability, and Realtime interface availability.
- Use short, bounded AI prompts to reduce unpredictable response length.
- If a provider times out or returns unsuitable output, repeat only that source segment. Do not edit the interface to imply a response that was never produced.
- If old messages are present, frame and scroll to the new deterministic sequence without deleting unrelated user data.
- Keep every source scene independent so a failed capture cannot invalidate the whole recording.
- Preserve a small timing reserve so narration or transition adjustments cannot push the final render beyond the competition limit.

## Validation

The video is ready for approval only when all of the following are true:

- the duration is no more than 2:55;
- the canvas is 1920 x 1080;
- English narration is audible and English captions are complete;
- Judy and Haland are visibly separate authenticated users;
- the same real Convia reply is readable in both users' views;
- the private relay visibly preserves Convia's third-person identity;
- the Codex segment shows real workspace evidence and names specific contributions;
- GPT-5.6 usage is accurately explained;
- no copyrighted music or unauthorized third-party material is included;
- `npx hyperframes lint` passes;
- `npx hyperframes validate` passes without errors;
- `npx hyperframes inspect` reports no unresolved layout overflow;
- the animation map contains no unexplained collision, offscreen, invisible, or pacing flags;
- the active HyperFrames Studio preview is reviewed before MP4 rendering.

## Out of Scope

- Recreating Convia as a fictional animated UI.
- Fabricating model responses or delivery state.
- Showing every media feature.
- Using Gemini image generation as a product highlight.
- Uploading to YouTube before the final MP4 is explicitly approved.
