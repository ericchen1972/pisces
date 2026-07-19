# OpenAI Build Week Demo Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reviewable 1920 x 1080 HyperFrames Studio project for a 2:50 English OpenAI Build Week demo using real Judy, Haland, Convia, and Codex evidence.

**Architecture:** Browser drives the deployed Judy and Haland accounts and produces sanitized production-state captures. HyperFrames treats those captures as immutable product evidence, composes them into seven timed scenes, generates a female English narration and synchronized captions, and validates the deterministic timeline before exposing a Studio preview. Generated audio, raw captures, snapshots, and renders remain local; the composition source, sanitized assets, transcript, script, design reference, and storyboard are committed.

**Tech Stack:** Browser, HyperFrames 0.7.64, Node.js 24.15.0, GSAP 3.14.2, Kokoro TTS, Whisper transcription, FFmpeg, HTML, CSS, JavaScript.

---

## File Map

Create one self-contained project under `video/build-week-demo/`:

```text
video/build-week-demo/
├── package.json                         HyperFrames project metadata and checks
├── DESIGN.md                            exact Convia visual tokens and constraints
├── SCRIPT.md                            human-readable narration and on-screen dialogue
├── STORYBOARD.md                        beat timing, assets, motion, transitions, and SFX
├── narration.txt                        exact TTS input
├── narration.wav                        generated locally; ignored by git
├── transcript.json                      word-level timings; committed
├── timing.json                          numeric beat boundaries derived from narration
├── index.html                           root composition, audio, and beat orchestration
├── tests/check-contract.mjs             deterministic project contract check
├── tools/build-timing.mjs               derives seven non-overlapping beat ranges
├── assets/
│   ├── brand/                           copied Convia SVG logo assets
│   ├── product/                         sanitized production screenshots
│   ├── codex/                           sanitized Codex and verification screenshots
│   └── sfx/                             original, license-safe UI sounds if used
├── capture/
│   ├── site/                            HyperFrames website capture output
│   └── raw/                             raw Browser captures; ignored by git
├── compositions/
│   ├── beat-01-thesis.html
│   ├── beat-02-convia.html
│   ├── beat-03-two-users.html
│   ├── beat-04-shared-ai.html
│   ├── beat-05-relay-voice.html
│   ├── beat-06-codex.html
│   ├── beat-07-close.html
│   └── captions.html
├── snapshots/                           generated locally; ignored by git
└── renders/                             generated locally; ignored by git
```

### Task 1: Pin the video toolchain and scaffold the project

**Files:**
- Create: `video/build-week-demo/package.json`
- Create: `video/build-week-demo/tests/check-contract.mjs`
- Modify: `.gitignore`

- [ ] **Step 1: Verify the required local tools**

Run:

```bash
PATH=/Users/eric/.nvm/versions/node/v24.15.0/bin:$PATH node --version
PATH=/Users/eric/.nvm/versions/node/v24.15.0/bin:$PATH npx hyperframes info
PATH=/Users/eric/.nvm/versions/node/v24.15.0/bin:$PATH npx hyperframes doctor
ffmpeg -version
```

Expected: Node reports `v24.15.0`; HyperFrames reports `0.7.64`; doctor confirms Chrome and FFmpeg are usable.

- [ ] **Step 2: Scaffold with the official CLI**

Run from the repository root:

```bash
PATH=/Users/eric/.nvm/versions/node/v24.15.0/bin:$PATH npx hyperframes init video/build-week-demo --non-interactive
```

Expected: `video/build-week-demo/index.html` and project metadata are created without an engine warning.

- [ ] **Step 3: Write a failing project contract check**

Create `video/build-week-demo/tests/check-contract.mjs` with this contract:

```js
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const required = [
  'DESIGN.md', 'SCRIPT.md', 'STORYBOARD.md', 'narration.txt',
  'transcript.json', 'index.html',
  'compositions/beat-01-thesis.html',
  'compositions/beat-02-convia.html',
  'compositions/beat-03-two-users.html',
  'compositions/beat-04-shared-ai.html',
  'compositions/beat-05-relay-voice.html',
  'compositions/beat-06-codex.html',
  'compositions/beat-07-close.html',
  'compositions/captions.html',
]

for (const file of required) {
  assert.ok(existsSync(join(root, file)), `missing ${file}`)
}

const index = readFileSync(join(root, 'index.html'), 'utf8')
assert.match(index, /data-width="1920"/)
assert.match(index, /data-height="1080"/)
assert.match(index, /data-duration="(1[0-6][0-9](?:\.\d+)?|17[0-5](?:\.\d+)?)"/)
assert.doesNotMatch(index, /<iframe\b/i)
assert.doesNotMatch(index, /repeat\s*:\s*-1/)
console.log('video contract ok')
```

- [ ] **Step 4: Run the contract to verify it fails**

Run:

```bash
PATH=/Users/eric/.nvm/versions/node/v24.15.0/bin:$PATH node video/build-week-demo/tests/check-contract.mjs
```

Expected: FAIL with `missing DESIGN.md`.

- [ ] **Step 5: Add scripts and generated-artifact ignores**

Pin the validated CLI version:

```bash
cd video/build-week-demo
PATH=/Users/eric/.nvm/versions/node/v24.15.0/bin:$PATH npm install --save-dev hyperframes@0.7.64
```

Set these `package.json` scripts without removing CLI-generated metadata:

```json
{
  "scripts": {
    "check": "node tests/check-contract.mjs",
    "lint": "hyperframes lint",
    "validate": "hyperframes validate",
    "inspect": "hyperframes inspect --samples 15",
    "preview": "hyperframes preview --port 3017"
  }
}
```

Append to `.gitignore`:

```gitignore
# Generated Build Week video artifacts
video/build-week-demo/narration.wav
video/build-week-demo/capture/raw/
video/build-week-demo/snapshots/
video/build-week-demo/renders/
video/build-week-demo/.hyperframes/
```

- [ ] **Step 6: Commit the scaffold and failing contract**

```bash
git add .gitignore video/build-week-demo/package.json video/build-week-demo/index.html video/build-week-demo/tests/check-contract.mjs
git commit -m "chore: scaffold Build Week demo video"
```

### Task 2: Capture the deployed visual system and define the brand

**Files:**
- Create: `video/build-week-demo/capture/site/**`
- Create: `video/build-week-demo/assets/brand/convia-logo-bridge.svg`
- Create: `video/build-week-demo/assets/brand/convia-logo-messenger.svg`
- Create: `video/build-week-demo/DESIGN.md`

- [ ] **Step 1: Capture the production site**

Run:

```bash
PATH=/Users/eric/.nvm/versions/node/v24.15.0/bin:$PATH npx hyperframes capture https://pisces-plum.vercel.app -o video/build-week-demo/capture/site --max-screenshots 8 --json
```

Expected: capture JSON reports screenshots, downloaded assets, extracted tokens, visible text, and fonts.

- [ ] **Step 2: Inspect every required capture artifact**

View all `capture/site/screenshots/scroll-*.png`, then read:

```text
capture/site/extracted/tokens.json
capture/site/extracted/visible-text.txt
capture/site/extracted/asset-descriptions.md
capture/site/extracted/animations.json
```

Write down the exact top colors, font families and weights, recognizable product surfaces, and reusable assets before authoring `DESIGN.md`.

- [ ] **Step 3: Copy the approved Convia brand assets**

Copy, without editing the originals:

```text
web/public/images/convia-logo-bridge.svg
  -> video/build-week-demo/assets/brand/convia-logo-bridge.svg
web/public/images/convia-logo-messenger.svg
  -> video/build-week-demo/assets/brand/convia-logo-messenger.svg
```

- [ ] **Step 4: Write `DESIGN.md` from exact captured values**

The document must contain exactly these six sections:

```markdown
# Convia Build Week Video Design System
## Overview
## Colors
## Typography
## Elevation
## Components
## Do's and Don'ts
```

Record five to ten exact HEX colors from `tokens.json`. Define the dark graphite canvas, white human-message surface, unbubbled AI reply, quiet border, primary text, secondary text, and any actual accent. Use the captured font family or the closest locally available family only when the capture identifies no downloadable font. Prohibit neon AI gradients, fake chat UI, glossy 3D robots, heavy glassmorphism, and motion that obscures real product evidence.

- [ ] **Step 5: Verify the visual-identity gate**

Run:

```bash
rg -n '^## (Overview|Colors|Typography|Elevation|Components|Do.s and Don.ts)$' video/build-week-demo/DESIGN.md
rg -n '#[0-9A-Fa-f]{6}' video/build-week-demo/DESIGN.md
```

Expected: all six sections appear and at least five exact HEX colors are present.

- [ ] **Step 6: Commit the capture reference and design system**

```bash
git add video/build-week-demo/capture/site video/build-week-demo/assets/brand video/build-week-demo/DESIGN.md
git commit -m "docs: define Convia video identity"
```

### Task 3: Preflight production and capture the real conversation states

**Files:**
- Create: `video/build-week-demo/capture/raw/*.png`
- Create: `video/build-week-demo/assets/product/*.png`

- [ ] **Step 1: Verify the production accounts before changing conversation state**

Check all of the following through the deployed UI and API:

```text
https://convia-judy.vercel.app/?demo_account=judy
https://convia-haland.vercel.app/?demo_account=haland
```

Acceptance evidence:

```text
Judy signs in as tester_a733d3023078824487c4fcd7.
Haland signs in as tester_2a42f0d5887e71483d6b0036.
Each account lists the other as an accepted friend.
An arbitrary tester email still receives HTTP 404.
```

- [ ] **Step 2: Capture clean authenticated establishing frames**

Use Browser semantic locators and save full-frame screenshots as:

```text
capture/raw/judy-authenticated.png
capture/raw/haland-authenticated.png
```

Do not include browser account menus, unrelated tabs, Google account details, or conversations outside Judy, Haland, and Convia.

- [ ] **Step 3: Send the approved human dialogue through the real UI**

Send in this order, waiting for delivery before the next message:

```text
Judy: Hey Haland, are you free next Tuesday night? Want to grab a drink?
Haland: I'm free after eight. The usual bar?
Judy: That works. I may be a few minutes late.
```

Capture the newest-message state after each delivery:

```text
capture/raw/judy-invitation.png
capture/raw/haland-reply.png
capture/raw/judy-late.png
```

- [ ] **Step 4: Invoke the real shared Convia flow**

Send from Judy:

```text
Convia, summarize our plan in one sentence for both of us. Keep it under 25 words.
```

Wait up to the application's normal 30-second shared-AI deadline. Capture the actual response in both accounts:

```text
capture/raw/judy-shared-convia.png
capture/raw/haland-shared-convia.png
```

Reject the take and retry the segment only if the provider times out, the reply is empty, or it does not summarize the visible conversation. Never edit response text into the product screenshot.

- [ ] **Step 5: Capture the private relay and Realtime interface**

In Judy's fixed Convia room send:

```text
Tell Haland I'll text when I'm on my way.
```

Capture the private request, Haland's received third-person relay, and the Realtime call interface without recording private ambient audio:

```text
capture/raw/judy-private-relay.png
capture/raw/haland-relay-received.png
capture/raw/realtime-call-interface.png
```

- [ ] **Step 6: Sanitize and promote the selected captures**

Crop or mask only browser chrome and unrelated information. Do not alter product messages, sender identity, timestamps, delivery state, or AI output. Promote the final images to:

```text
assets/product/judy-authenticated.png
assets/product/haland-authenticated.png
assets/product/judy-invitation.png
assets/product/haland-reply.png
assets/product/judy-late.png
assets/product/judy-shared-convia.png
assets/product/haland-shared-convia.png
assets/product/judy-private-relay.png
assets/product/haland-relay-received.png
assets/product/realtime-call-interface.png
```

If visible interface controls remain Chinese because of the capture browser locale, keep the authentic UI and ensure the nearby English annotation and caption translate the control. The human and AI conversation itself must remain English.

- [ ] **Step 7: Visually inspect every promoted image**

Verify each image is readable at 1920 x 1080 composition scale, contains only the approved demo identities, and shows no secrets or private account details.

- [ ] **Step 8: Commit only sanitized product evidence**

```bash
git add video/build-week-demo/assets/product
git commit -m "assets: capture Build Week product demo"
```

### Task 4: Capture real Codex, commit, test, and deployment evidence

**Files:**
- Create: `video/build-week-demo/assets/codex/codex-workspace.png`
- Create: `video/build-week-demo/assets/codex/commit-history.png`
- Create: `video/build-week-demo/assets/codex/test-results.png`
- Create: `video/build-week-demo/assets/codex/deployment-proof.png`

- [ ] **Step 1: Prepare a disclosure-safe Codex frame**

Show the real primary Convia task with the Build Week implementation context and no secrets, tokens, browser accounts, unrelated conversations, or hidden system content. Capture the visible Codex application as `codex-workspace.png`.

- [ ] **Step 2: Capture dated eligible commits**

Render a readable terminal frame from:

```bash
git log --since='2026-07-13 09:00:00 -0700' --date=short --pretty=format:'%ad  %h  %s' --reverse
```

The frame must visibly include the ChatGPT-like redesign, exact demo-account work, and submission preparation commits. Save it as `commit-history.png`.

- [ ] **Step 3: Capture fresh test evidence**

Run:

```bash
/tmp/convia-build-week-venv-20260719/bin/python -m pytest -q api/tests
cd web && npm test -- --run && npm run build
```

Create one readable terminal capture containing `456 passed`, the successful frontend test result, and `✓ built`. Save it as `test-results.png`.

- [ ] **Step 4: Capture production deployment evidence**

Run:

```bash
gcloud run services describe pisces --project pisces-hackathon --region asia-east1 --format='value(status.latestReadyRevisionName,status.traffic[0].percent,spec.template.spec.containers[0].image)'
npx vercel inspect https://pisces-plum.vercel.app
```

Capture the ready revision, 100% traffic, production target, and public alias without displaying environment variables. Save as `deployment-proof.png`.

- [ ] **Step 5: Inspect and commit the evidence assets**

Confirm the four images contain no credentials, private email addresses other than the public demo identities, or unrelated project data.

```bash
git add video/build-week-demo/assets/codex
git commit -m "assets: capture Codex Build Week evidence"
```

### Task 5: Write the exact narration and storyboard

**Files:**
- Create: `video/build-week-demo/SCRIPT.md`
- Create: `video/build-week-demo/narration.txt`
- Create: `video/build-week-demo/STORYBOARD.md`

- [ ] **Step 1: Write the narration in seven labeled beats**

Use this exact narrative content, adjusting punctuation only for natural TTS pauses:

```text
ChatGPT Desktop is failing at product shape. It asks one interface to be an everyday conversation space and a coding workspace at the same time. Those jobs have different rhythms, different context, and different trust boundaries. Codex deserves focus. ChatGPT is better suited to becoming a Messenger.

This is Convia: a working version of that argument. It is not another private AI chat box. It is a messenger where AI can participate in real relationships while keeping its own identity.

Here are Judy and Haland. They are two independent production accounts, opened on separate hostnames with isolated sessions. Judy asks Haland to meet for a drink next Tuesday. Haland is free after eight, and Judy may arrive a few minutes late. This is ordinary person-to-person messaging first. The AI does not need to dominate every conversation.

Now Judy invites Convia into the shared thread. Convia reads the visible conversation, summarizes the plan, and answers both people. The same real response appears for Judy and Haland. Convia is a third participant, not Judy pretending to be an assistant and not an assistant impersonating Haland.

Convia also works privately. Judy can ask it to tell Haland that she will text when she is on her way. Haland receives that message from Convia in the third person. The product also connects OpenAI Responses, Audio, and Realtime for text, recorded speech, and live voice interaction.

The largest eligible change after July thirteenth was a complete ChatGPT-like interface and an OpenAI-centered communication path. I used Codex with GPT-five-point-six to trace the legacy authentication and provider boundaries, design the exact Judy and Haland exception, write regression tests before fixes, preserve friendship and authorization rules, and deploy the result. Codex also helped catch a real release mistake: the first backend build went to the wrong Google Cloud project. We diagnosed the live behavior, redeployed to Pisces Hackathon, and verified both demo accounts while arbitrary tester login still returned not found.

Codex is where we build. Convia is where AI lives with people.
```

`SCRIPT.md` must also list the four human dialogue messages and the private relay request exactly as captured. `narration.txt` contains only the spoken paragraphs with pronunciation substitutions applied.

- [ ] **Step 2: Check narration length before TTS**

Run:

```bash
wc -w video/build-week-demo/narration.txt
```

Expected: 335 to 390 words. This supports approximately 2:35 to 2:50 at a clear 135-145 words per minute plus pauses.

- [ ] **Step 3: Write the storyboard with seven complete beats**

For each beat, include:

```text
Concept
VO cue
Visual description
Mood direction
Assets
Animation choreography
Transition
Depth layers
SFX cues
```

Use these estimated ranges until the transcript replaces them:

```text
Beat 1  0:00-0:20  thesis
Beat 2  0:20-0:38  Convia answer
Beat 3  0:38-1:35  two users
Beat 4  1:35-2:05  shared AI
Beat 5  2:05-2:25  relay and voice
Beat 6  2:25-2:42  Codex and GPT-5.6
Beat 7  2:42-2:50  close
```

The primary transition is a 0.4-second editorial push slide. Use a 0.5-second cinematic zoom only for the shared-AI reveal, a 0.5-second blur crossfade into Codex evidence, and a 0.7-second color dip to graphite for the close. Do not mix CSS and shader transitions inside the same composition; this plan uses CSS transitions only.

- [ ] **Step 4: Add the asset audit and production tree**

Assign every promoted product and Codex capture to a beat or explicitly mark it `SKIP`. Require both logo assets in Beat 1 or Beat 2 and Beat 7. Require all ten product captures and all four Codex captures to appear at least once.

- [ ] **Step 5: Commit the locked story**

```bash
git add video/build-week-demo/SCRIPT.md video/build-week-demo/narration.txt video/build-week-demo/STORYBOARD.md
git commit -m "docs: script Build Week demo video"
```

### Task 6: Generate the female narration and replace estimates with real timing

**Files:**
- Create: `video/build-week-demo/narration.wav`
- Create: `video/build-week-demo/transcript.json`
- Create: `video/build-week-demo/timing.json`
- Create: `video/build-week-demo/tools/build-timing.mjs`
- Modify: `video/build-week-demo/STORYBOARD.md`

- [ ] **Step 1: Audition three female voices**

Generate the first narration paragraph with:

```bash
PATH=/Users/eric/.nvm/versions/node/v24.15.0/bin:$PATH npx hyperframes tts "ChatGPT Desktop is failing at product shape. Codex deserves focus. ChatGPT is better suited to becoming a Messenger." --voice af_nova --output /tmp/convia-af-nova.wav
PATH=/Users/eric/.nvm/versions/node/v24.15.0/bin:$PATH npx hyperframes tts "ChatGPT Desktop is failing at product shape. Codex deserves focus. ChatGPT is better suited to becoming a Messenger." --voice af_bella --output /tmp/convia-af-bella.wav
PATH=/Users/eric/.nvm/versions/node/v24.15.0/bin:$PATH npx hyperframes tts "ChatGPT Desktop is failing at product shape. Codex deserves focus. ChatGPT is better suited to becoming a Messenger." --voice bf_emma --output /tmp/convia-bf-emma.wav
```

Confirm that `af_nova` is warm, clear, and non-theatrical; use the other two files only as comparison evidence. The approved production voice for this plan is `af_nova`.

- [ ] **Step 2: Generate the full narration**

Run from `video/build-week-demo`:

```bash
PATH=/Users/eric/.nvm/versions/node/v24.15.0/bin:$PATH npx hyperframes tts narration.txt --voice af_nova --output narration.wav
```

Expected: `narration.wav` is intelligible, complete, and contains no pronunciation failure for Codex, GPT-5.6, API, or URLs.

- [ ] **Step 3: Measure duration and enforce the hard limit**

Run:

```bash
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 video/build-week-demo/narration.wav
```

Expected: audio duration is between 155 and 171 seconds. If it exceeds 171 seconds, shorten redundant narration text; do not speed the voice into an unnatural delivery.

- [ ] **Step 4: Produce word-level timestamps**

Run from `video/build-week-demo`:

```bash
PATH=/Users/eric/.nvm/versions/node/v24.15.0/bin:$PATH npx hyperframes transcribe narration.wav --model medium.en --language en
```

Expected: `transcript.json` contains every spoken word with `text`, `start`, and `end`.

- [ ] **Step 5: Replace storyboard estimates with transcript timing**

Create `tools/build-timing.mjs` so paragraph boundaries in `narration.txt` map deterministically to transcript words:

```js
import { readFileSync, writeFileSync } from 'node:fs'

const paragraphs = readFileSync('narration.txt', 'utf8')
  .trim()
  .split(/\n\s*\n/)
  .filter(Boolean)
const words = JSON.parse(readFileSync('transcript.json', 'utf8'))
const countWords = (text) => text.match(/[\p{L}\p{N}]+(?:[.'-][\p{L}\p{N}]+)*/gu)?.length ?? 0

if (paragraphs.length !== 7) throw new Error(`expected 7 narration paragraphs, got ${paragraphs.length}`)
if (!Array.isArray(words) || words.some((word) => !Number.isFinite(word.start) || !Number.isFinite(word.end))) {
  throw new Error('transcript.json must be a word-timestamp array')
}

const counts = paragraphs.map(countWords)
const totalCount = counts.reduce((sum, value) => sum + value, 0)
if (Math.abs(totalCount - words.length) > 4) {
  throw new Error(`narration/transcript word mismatch: ${totalCount} vs ${words.length}`)
}

let cursor = 0
const boundaries = [0]
for (let index = 0; index < counts.length - 1; index += 1) {
  cursor += counts[index]
  const left = words[Math.min(cursor - 1, words.length - 1)]
  const right = words[Math.min(cursor, words.length - 1)]
  boundaries.push(Number(((left.end + right.start) / 2).toFixed(2)))
}
const totalDuration = Number((Math.ceil((words.at(-1).end + 0.8) * 10) / 10).toFixed(1))
boundaries.push(totalDuration)

const beats = boundaries.slice(0, -1).map((start, index) => ({
  id: index + 1,
  start,
  duration: Number((boundaries[index + 1] - start).toFixed(2)),
}))

if (totalDuration > 175) throw new Error(`video duration ${totalDuration}s exceeds 175s`)
writeFileSync('timing.json', JSON.stringify({ totalDuration, beats }, null, 2) + '\n')
console.log(JSON.stringify({ totalDuration, beats }))
```

Run it from `video/build-week-demo`:

```bash
PATH=/Users/eric/.nvm/versions/node/v24.15.0/bin:$PATH node tools/build-timing.mjs
```

Update each storyboard beat with the matching numeric start and duration from `timing.json`.

- [ ] **Step 6: Commit reproducible timing data**

```bash
git add video/build-week-demo/transcript.json video/build-week-demo/timing.json video/build-week-demo/tools/build-timing.mjs video/build-week-demo/STORYBOARD.md video/build-week-demo/narration.txt
git commit -m "chore: time Build Week narration"
```

### Task 7: Implement the root timeline, captions, and contract

**Files:**
- Modify: `video/build-week-demo/index.html`
- Create: `video/build-week-demo/compositions/captions.html`
- Test: `video/build-week-demo/tests/check-contract.mjs`

- [ ] **Step 1: Re-run the contract and confirm it still fails on missing beats**

```bash
cd video/build-week-demo
PATH=/Users/eric/.nvm/versions/node/v24.15.0/bin:$PATH npm run check
```

Expected: FAIL with the first missing `compositions/beat-*.html` path.

- [ ] **Step 2: Build the root composition**

`index.html` must contain a standalone root, not a `<template>`. Copy the numeric `totalDuration`, beat starts, and beat durations from `timing.json` into the HTML attributes:

```html
<div id="build-week-demo" data-composition-id="build-week-demo"
  data-start="0" data-duration="170.0"
  data-width="1920" data-height="1080">
  <audio id="narration" src="narration.wav" data-start="0"
    data-duration="170.0" data-track-index="0" data-volume="1"></audio>
  <!-- seven non-overlapping beat clips on track 1 -->
  <!-- captions clip on track 2 -->
</div>
```

The `170.0` values above illustrate the attribute shape; use the numeric value in the generated `timing.json`, not an estimate. Reference every sub-composition through its exact `data-composition-src`, starting with `compositions/beat-01-thesis.html` and ending with `compositions/beat-07-close.html`.

- [ ] **Step 3: Build deterministic captions from `transcript.json`**

Group three to seven words per caption, allow no caption group longer than 2.8 seconds, and place captions inside the bottom safe area while reserving the lower-right picture-in-picture zone. Every group must have a timed entrance and a deterministic hard kill:

```js
tl.fromTo(group, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.18 }, group.start)
tl.to(group, { opacity: 0, duration: 0.12 }, group.end - 0.12)
tl.set(group, { opacity: 0, visibility: 'hidden' }, group.end)
```

Use a semi-opaque graphite caption plate, white text, 34-42px type, and a maximum width that never covers the main message being discussed.

- [ ] **Step 4: Run the contract again**

Expected: it still fails only because the seven beat files do not yet exist.

- [ ] **Step 5: Commit the root and captions**

```bash
git add video/build-week-demo/index.html video/build-week-demo/compositions/captions.html
git commit -m "feat: add Build Week video timeline"
```

### Task 8: Build Beats 1-3 — thesis, answer, and two users

**Files:**
- Create: `video/build-week-demo/compositions/beat-01-thesis.html`
- Create: `video/build-week-demo/compositions/beat-02-convia.html`
- Create: `video/build-week-demo/compositions/beat-03-two-users.html`

- [ ] **Step 1: Build each static hero frame before motion**

Use a full-size flex `.scene-content` with `width:100%`, `height:100%`, `box-sizing:border-box`, and edge padding. Beat 1 uses large direct thesis typography plus a real product fragment. Beat 2 uses the Convia messenger logo and three identity labels. Beat 3 uses Judy as a large device panel and Haland as a lower-right picture-in-picture panel.

- [ ] **Step 2: Add deterministic entrances**

Every visible element enters using `tl.fromTo()`. Offset the first entrance by 0.15 to 0.25 seconds. Use at least three entrance patterns per beat and no more than two independent tweens with the same ease.

- [ ] **Step 3: Add one ambient motion per beat**

Animate a wrapper and child separately to avoid transform conflicts. Use a slow horizontal product pan in Beat 1, a restrained logo breathing motion in Beat 2, and a 1.00 to 1.025 product-image push in Beat 3. All ambient motion belongs to the registered timeline and uses finite repeat counts.

- [ ] **Step 4: Add the editorial push transitions**

Use the same 0.4-second directional push language between related beats. Do not fade scene content out before the transition; the root transition handles the outgoing frame.

- [ ] **Step 5: Lint the first three beats**

Run:

```bash
cd video/build-week-demo
PATH=/Users/eric/.nvm/versions/node/v24.15.0/bin:$PATH npx hyperframes lint
```

Expected: no missing timeline registration, data attribute, infinite repeat, duplicate media, or CSS-transform/GSAP conflict errors in Beats 1-3.

- [ ] **Step 6: Commit Beats 1-3**

```bash
git add video/build-week-demo/compositions/beat-01-thesis.html video/build-week-demo/compositions/beat-02-convia.html video/build-week-demo/compositions/beat-03-two-users.html
git commit -m "feat: animate Build Week video opening"
```

### Task 9: Build Beats 4-5 — shared AI, relay, and voice

**Files:**
- Create: `video/build-week-demo/compositions/beat-04-shared-ai.html`
- Create: `video/build-week-demo/compositions/beat-05-relay-voice.html`

- [ ] **Step 1: Build the shared-AI proof frame**

Use `judy-shared-convia.png` and `haland-shared-convia.png` in equal 50/50 panels with a center rule. Keep the actual Convia reply readable in both panels. Add only factual labels: `JUDY — LIVE SESSION`, `HALAND — LIVE SESSION`, and `ONE SHARED CONVIA RESPONSE`.

- [ ] **Step 2: Add the hero transition into shared state**

Use a 0.5-second CSS cinematic zoom through. The two panels settle with different entrances: Judy from left, Haland from right, center proof label from scale and opacity. Do not use shader transitions.

- [ ] **Step 3: Build the private relay sequence**

Place `judy-private-relay.png` as the hero panel, transition to `haland-relay-received.png`, and keep a small `CONVIA SPEAKS AS CONVIA` annotation visible. End with `realtime-call-interface.png` entering as a six-to-eight-second foreground card.

- [ ] **Step 4: Validate real product text integrity**

Compare the displayed screenshots to the promoted assets. No animation layer may replace, redraw, or modify product messages or sender identity.

- [ ] **Step 5: Lint and inspect Beats 4-5 at their hero timestamps**

```bash
PATH=/Users/eric/.nvm/versions/node/v24.15.0/bin:$PATH npx hyperframes lint
PATH=/Users/eric/.nvm/versions/node/v24.15.0/bin:$PATH npx hyperframes inspect --samples 15
```

Expected: no layout overflow and both shared replies remain readable.

- [ ] **Step 6: Commit Beats 4-5**

```bash
git add video/build-week-demo/compositions/beat-04-shared-ai.html video/build-week-demo/compositions/beat-05-relay-voice.html
git commit -m "feat: animate shared Convia demo"
```

### Task 10: Build Beats 6-7 — Codex evidence and close

**Files:**
- Create: `video/build-week-demo/compositions/beat-06-codex.html`
- Create: `video/build-week-demo/compositions/beat-07-close.html`

- [ ] **Step 1: Build the Codex evidence montage**

Use all four sanitized Codex assets. Start with the real Codex workspace, then cascade the commit, test, and deployment cards. Use tabular numerals for `456`, `100%`, dates, revision numbers, and commit hashes. The only claims are:

```text
TRACED LEGACY RULES
TESTED THE EXCEPTIONS
CAUGHT THE WRONG CLOUD PROJECT
VERIFIED PRODUCTION
```

- [ ] **Step 2: Use a blur crossfade for the topic change**

Enter Beat 6 through a 0.5-second focus pull. Use a calm 8-15px blur range, then reveal the evidence cards in importance order, not DOM order.

- [ ] **Step 3: Build the closing frame**

Use the Convia messenger logo, `https://pisces-plum.vercel.app`, and:

```text
CODEX IS WHERE WE BUILD.
CONVIA IS WHERE AI LIVES WITH PEOPLE.
```

Enter the logo, statement, URL, and quiet border as separate elements. The final scene may fade to graphite over its last 0.7 seconds.

- [ ] **Step 4: Run the project contract**

```bash
cd video/build-week-demo
PATH=/Users/eric/.nvm/versions/node/v24.15.0/bin:$PATH npm run check
```

Expected: `video contract ok`.

- [ ] **Step 5: Commit Beats 6-7**

```bash
git add video/build-week-demo/compositions/beat-06-codex.html video/build-week-demo/compositions/beat-07-close.html
git commit -m "feat: complete Build Week video story"
```

### Task 11: Validate every frame and deliver the Studio preview

**Files:**
- Modify as needed: `video/build-week-demo/index.html`
- Modify as needed: `video/build-week-demo/compositions/*.html`
- Modify as needed: `video/build-week-demo/STORYBOARD.md`
- Generate locally: `video/build-week-demo/snapshots/*.png`

- [ ] **Step 1: Run all deterministic checks**

From `video/build-week-demo`:

```bash
PATH=/Users/eric/.nvm/versions/node/v24.15.0/bin:$PATH npm run check
PATH=/Users/eric/.nvm/versions/node/v24.15.0/bin:$PATH npx hyperframes lint
PATH=/Users/eric/.nvm/versions/node/v24.15.0/bin:$PATH npx hyperframes validate
PATH=/Users/eric/.nvm/versions/node/v24.15.0/bin:$PATH npx hyperframes inspect --samples 15 --strict
```

Expected: zero errors; no unresolved contrast or layout warnings.

- [ ] **Step 2: Audit media ownership and disclosure**

List every non-HTML asset referenced by `index.html` and `compositions/*.html`. Confirm each item is one of: a Convia repository asset, a real sanitized Convia/Codex capture created for this video, locally generated narration, or an original UI sound created for this video. Remove any copyrighted music, stock media, third-party logo, or unlicensed sound before continuing.

- [ ] **Step 3: Generate hero snapshots**

Calculate one hero timestamp at 60-70% of each final beat duration and run:

```bash
PATH=/Users/eric/.nvm/versions/node/v24.15.0/bin:$PATH npx hyperframes snapshot . --at "$(jq -r '[.beats[] | (.start + (.duration * 0.65))] | join(",")' timing.json)"
```

- [ ] **Step 4: Inspect all snapshots visually**

Check every generated frame for readable text, complete product images, correct sender identity, useful frame fill, no accidental overlap, exact DESIGN.md colors, and no captions covering product evidence.

- [ ] **Step 5: Generate and inspect the animation map**

Run:

```bash
PATH=/Users/eric/.nvm/versions/node/v24.15.0/bin:$PATH node /Users/eric/.codex/plugins/cache/openai-curated-remote/hyperframes/0.1.2/skills/hyperframes/scripts/animation-map.mjs /Users/eric/Documents/Convia/video/build-week-demo --out /Users/eric/Documents/Convia/video/build-week-demo/.hyperframes/anim-map
```

Read `.hyperframes/anim-map/animation-map.json`, inspect every lifecycle and flag, and fix or explicitly justify all collision, offscreen, invisible, dead-zone, and pacing findings.

- [ ] **Step 6: Start the Studio on the fixed review port**

```bash
cd video/build-week-demo
PATH=/Users/eric/.nvm/versions/node/v24.15.0/bin:$PATH npx hyperframes preview --port 3017
```

Expected review URL:

```text
http://localhost:3017/#project/build-week-demo
```

- [ ] **Step 7: Scrub the entire Studio timeline**

Verify narration starts at zero, captions match speech, no source frame flashes at beat boundaries, Judy/Haland picture-in-picture remains readable, the shared Convia reveal is simultaneous, and the final duration is no more than 175 seconds.

- [ ] **Step 8: Commit preview-ready source fixes**

```bash
git add video/build-week-demo
git commit -m "feat: finalize Build Week video preview"
```

- [ ] **Step 9: Hand off the active Studio preview**

Report `http://localhost:3017/#project/build-week-demo` as the primary deliverable. Do not render MP4 or upload to YouTube until the user explicitly approves the Studio preview.

## Post-Approval Render (Not Part of Initial Execution)

After explicit Studio approval, run:

```bash
cd video/build-week-demo
PATH=/Users/eric/.nvm/versions/node/v24.15.0/bin:$PATH npx hyperframes render --output renders/convia-openai-build-week.mp4 --fps 30 --quality high --strict
ffprobe -v error -show_entries format=duration:format=size -of json renders/convia-openai-build-week.mp4
```

Then review the rendered MP4 from beginning to end before any YouTube upload. Uploading to YouTube requires separate explicit authorization.
