# OpenAI Build Week Submission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a reproducible OpenAI Build Week version of Convia with two safely allowlisted, simultaneously usable judge accounts and complete non-video submission materials.

**Architecture:** Preserve Flask cookie sessions and isolate Judy and Haland through two Vercel hostnames pointing at the same deployment. A small backend demo-account policy module owns the exact public allowlist, an idempotent seed module owns Firestore account/friendship setup, and a small frontend demo-login module owns popup destinations and one-time login query parsing. Ordinary Google login, local arbitrary tester login, authorization, quotas, friendship checks, and messaging paths remain unchanged.

**Tech Stack:** Flask 3.1, Firestore, React 18, Vite 5, Vitest, pytest, Vercel, Google Cloud Run, GitHub Actions, OpenAI Responses/Realtime/Audio APIs.

---

## File Map

- Create `api/demo_accounts.py`: exact public demo identity policy and deterministic account metadata.
- Create `api/demo_seed.py`: idempotent Firestore upsert for Judy, Haland, contact groups, friendship, and chat metadata.
- Create `api/scripts/seed_build_week_demo.py`: authenticated command-line entry point for the production seed.
- Create `api/tests/test_demo_accounts.py`: pure allowlist tests.
- Create `api/tests/test_demo_seed.py`: fake-Firestore seed and idempotency tests.
- Modify `api/main.py`: replace Judy/IP special handling with the exact two-account policy.
- Modify `api/tests/test_cost_controls.py`: route and session-capability regression coverage.
- Create `web/src/lib/demoAccounts.js`: fixed account keys, configured popup URLs, query parsing, and URL cleanup.
- Create `web/src/lib/demoAccounts.test.js`: pure browser-contract tests.
- Modify `web/src/features/auth/LoginScreen.jsx`: two localized judge buttons and popup-error surface.
- Modify `web/src/features/auth/LoginScreen.test.jsx`: button, localization, and click coverage.
- Modify `web/src/App.jsx`: public buttons, new-window launch, and one-time demo-host login bootstrap.
- Modify `web/src/App.googleIdentity.test.jsx`: authenticated bootstrap and popup behavior coverage.
- Modify `web/src/App.visiblePolicy.test.js`: remove IP/capability-driven Judy visibility assumptions.
- Modify `web/src/styles/forms.css`: layout for two demo buttons and localized popup error.
- Modify `web/vercel.json`: keep the same-origin API rewrite and SPA fallback needed by all aliases.
- Modify `api/requirements.txt`: pin the currently verified dependency versions.
- Create `.github/workflows/test.yml`: backend, frontend, and build checks.
- Create `LICENSE`: MIT license.
- Modify `README.md`: complete Build Week README and judge walkthrough.
- Create `docs/hackathon-submission.md`: English Devpost copy excluding the video.

### Task 1: Establish a Clean Eligible-Work Baseline

**Files:**
- Review: all currently modified and untracked files
- Preserve: `docs/superpowers/specs/2026-07-19-openai-build-week-submission-design.md`

- [ ] **Step 1: Record the existing worktree and eligible commit history**

Run:

```bash
git status --short
git diff --stat
git log --since='2026-07-13T09:00:00-07:00' --date=iso-strict --pretty=format:'%h %ad %s'
```

Expected: the current ChatGPT-like redesign and follow-up fixes are visible; no secret or local environment file is staged.

- [ ] **Step 2: Verify the current baseline before committing it**

Run:

```bash
cd api && .venv/bin/pytest -q
cd ../web && npm test -- --run
npm run build
cd .. && git diff --check
```

Expected: 452 or more backend tests pass, 256 or more frontend tests pass, Vite builds, and `git diff --check` prints nothing.

- [ ] **Step 3: Scan tracked and pending files for secrets**

Run:

```bash
git status --short
git diff -- . ':(exclude)package-lock.json' | rg -n '(OPENAI_KEY|OPENAI_API_KEY|GEMINI_API_KEY|ABLY_KEY|SESSION_SECRET|BLOB_READ_WRITE_TOKEN)\s*[=:]\s*[^<" ]' || true
git ls-files | rg '(^|/)(\.env|config\.json|firestore-sa\.json)$' || true
```

Expected: only variable names, examples, or documentation appear; no secret-bearing file is tracked.

- [ ] **Step 4: Commit the verified current product baseline**

Run:

```bash
git add api web README.md docs/superpowers
git status --short
git commit -m "feat: align Convia production experience"
```

Expected: the deployed ChatGPT-like product work is captured in Git without staging `api/config.json`, `web/.env.local`, service-account keys, or `AGENTS.md`.

### Task 2: Add the Exact Public Demo-Account Policy

**Files:**
- Create: `api/demo_accounts.py`
- Create: `api/tests/test_demo_accounts.py`
- Modify: `api/main.py:176-215`
- Modify: `api/tests/test_cost_controls.py:88-155`

- [ ] **Step 1: Write failing pure policy tests**

Create `api/tests/test_demo_accounts.py`:

```python
from demo_accounts import DEMO_ACCOUNTS, demo_account_for_email, is_public_demo_email


def test_public_demo_accounts_are_exact_and_normalized():
    assert set(DEMO_ACCOUNTS) == {"judy", "haland"}
    assert demo_account_for_email(" JUDY@GODS.TW ")["key"] == "judy"
    assert demo_account_for_email("haland@gods.tw")["display_name"] == "Haland"


def test_every_other_email_is_rejected():
    assert demo_account_for_email("judy@example.com") is None
    assert demo_account_for_email("eric@gods.tw") is None
    assert is_public_demo_email("") is False
```

- [ ] **Step 2: Run the pure policy tests and confirm red**

Run:

```bash
cd api && .venv/bin/pytest tests/test_demo_accounts.py -q
```

Expected: collection fails because `demo_accounts` does not exist.

- [ ] **Step 3: Implement the pure account policy**

Create `api/demo_accounts.py`:

```python
from types import MappingProxyType


DEMO_ACCOUNTS = MappingProxyType({
    "judy": MappingProxyType({
        "key": "judy",
        "email": "judy@gods.tw",
        "display_name": "Judy",
    }),
    "haland": MappingProxyType({
        "key": "haland",
        "email": "haland@gods.tw",
        "display_name": "Haland",
    }),
})

_BY_EMAIL = {account["email"]: account for account in DEMO_ACCOUNTS.values()}


def normalize_demo_email(email):
    return str(email or "").strip().lower()


def demo_account_for_email(email):
    return _BY_EMAIL.get(normalize_demo_email(email))


def is_public_demo_email(email):
    return demo_account_for_email(email) is not None
```

- [ ] **Step 4: Replace IP-based route behavior with the exact allowlist**

In `api/main.py`, import `demo_account_for_email` and `is_public_demo_email`, remove `JUDY_LOGIN_ALLOWED_IP`, `request_client_ips()`, and `is_judy_login_allowed()`, then change the production gate to:

```python
if not is_tester_login_enabled() and not is_public_demo_email(email):
    return jsonify({"ok": False, "error": "not found"}), 404
```

When constructing a public demo tester, use the fixed account display name:

```python
demo_account = demo_account_for_email(email)
display_name = (
    demo_account["display_name"]
    if demo_account
    else (email.split("@", 1)[0] or "tester")
)
```

Remove `judy_login_enabled` from every `/api/session/me` response. Keep `tester_login_enabled` unchanged for local or explicitly enabled generic tester login.

- [ ] **Step 5: Replace the route regression test**

Update `test_session_capability_and_disabled_tester_route` so it asserts:

```python
me = client.get("/api/session/me")
arbitrary = client.post("/api/auth/tester", json={"email": "a@example.com"})
judy = client.post("/api/auth/tester", json={"email": " JUDY@GODS.TW "})
haland = client.post("/api/auth/tester", json={"email": "haland@gods.tw"})
spoofed_ip = client.post(
    "/api/auth/tester",
    json={"email": "eric@gods.tw"},
    headers={"X-Forwarded-For": "220.135.118.126"},
)

assert me.get_json()["tester_login_enabled"] is False
assert "judy_login_enabled" not in me.get_json()
assert arbitrary.status_code == 404
assert spoofed_ip.status_code == 404
assert judy.get_json()["user"]["display_name"] == "Judy"
assert haland.get_json()["user"]["display_name"] == "Haland"
```

- [ ] **Step 6: Run focused and full backend tests**

Run:

```bash
cd api
.venv/bin/pytest tests/test_demo_accounts.py tests/test_cost_controls.py -q
.venv/bin/pytest -q
```

Expected: focused tests pass and the full backend suite passes.

- [ ] **Step 7: Commit the policy**

```bash
git add api/demo_accounts.py api/tests/test_demo_accounts.py api/main.py api/tests/test_cost_controls.py
git commit -m "feat: allowlist Build Week demo accounts"
```

### Task 3: Add Idempotent Judy/Haland Firestore Seeding

**Files:**
- Create: `api/demo_seed.py`
- Create: `api/scripts/seed_build_week_demo.py`
- Create: `api/tests/test_demo_seed.py`

- [ ] **Step 1: Write failing seed contract tests**

Create tests using the existing fake Firestore types from `tests/test_contact_groups.py`. The core assertions are:

```python
result_one = seed_demo_accounts(client, server_timestamp="NOW")
snapshot_one = dict(client.data)
result_two = seed_demo_accounts(client, server_timestamp="NOW")

assert result_one == result_two
assert client.data == snapshot_one
assert result_one["accounts"]["judy"]["email"] == "judy@gods.tw"
assert result_one["accounts"]["haland"]["email"] == "haland@gods.tw"
assert result_one["friendship"]["status"] == "accepted"
assert result_one["friendship"]["alias_for_a"] in {"Judy", "Haland"}
assert result_one["friendship"]["alias_for_b"] in {"Judy", "Haland"}
assert result_one["judy_group_id"]
assert result_one["haland_group_id"]
```

- [ ] **Step 2: Run the seed test and confirm red**

Run:

```bash
cd api && .venv/bin/pytest tests/test_demo_seed.py -q
```

Expected: collection fails because `demo_seed` does not exist.

- [ ] **Step 3: Implement the idempotent seed service**

Implement `seed_demo_accounts(client, server_timestamp)` in `api/demo_seed.py` with these exact operations:

```python
def tester_user_id(email):
    digest = hashlib.sha1(email.strip().lower().encode("utf-8")).hexdigest()
    return f"tester_{digest[:24]}"


def seed_demo_accounts(client, server_timestamp):
    accounts = {
        key: {**dict(spec), "id": tester_user_id(spec["email"])}
        for key, spec in DEMO_ACCOUNTS.items()
    }
    for account in accounts.values():
        client.collection("users").document(account["id"]).set({
            "display_name": account["display_name"],
            "email": account["email"],
            "email_verified": True,
            "provider": "tester",
            "ai_avatar_url": "/images/fish.png",
            "updated_at": server_timestamp,
        }, merge=True)

    service = ContactGroupService(client, server_timestamp)
    for account in accounts.values():
        service.bootstrap(account["id"], "en")

    judy = accounts["judy"]
    haland = accounts["haland"]
    user_a, user_b = sorted([judy, haland], key=lambda item: item["id"])
    pair_key = f'{user_a["id"]}_{user_b["id"]}'
    friendship = {
        "pair_key": pair_key,
        "user_a_id": user_a["id"],
        "user_b_id": user_b["id"],
        "user_a_email": user_a["email"],
        "user_b_email": user_b["email"],
        "user_a_display_name": user_a["display_name"],
        "user_b_display_name": user_b["display_name"],
        "alias_for_a": user_b["display_name"],
        "alias_for_b": user_a["display_name"],
        "special_prompt_for_a": "",
        "special_prompt_for_b": "",
        "relationship_for_a": "Build Week demo friend",
        "relationship_for_b": "Build Week demo friend",
        "status": "accepted",
        "requested_by": judy["id"],
        "accepted_at": server_timestamp,
        "updated_at": server_timestamp,
    }
    client.collection("friendships").document(pair_key).set(friendship, merge=True)

    judy_group_id = service.get_default_group_id(judy["id"])
    haland_group_id = service.get_default_group_id(haland["id"])
    service.assign(judy["id"], haland["id"], judy_group_id)
    service.assign(haland["id"], judy["id"], haland_group_id)
    return {
        "accounts": accounts,
        "friendship": friendship,
        "judy_group_id": judy_group_id,
        "haland_group_id": haland_group_id,
    }
```

The implementation must preserve an existing avatar, AI settings, and `created_at`; it must not write sample conversation messages or delete judge activity.

- [ ] **Step 4: Add the production command**

Create `api/scripts/seed_build_week_demo.py`:

```python
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from google.cloud import firestore
import main
from demo_seed import seed_demo_accounts


if __name__ == "__main__":
    result = seed_demo_accounts(main.get_firestore_client(), firestore.SERVER_TIMESTAMP)
    print(json.dumps({
        "ok": True,
        "accounts": {
            key: {"id": value["id"], "email": value["email"]}
            for key, value in result["accounts"].items()
        },
        "pair_key": result["friendship"]["pair_key"],
    }, sort_keys=True))
```

- [ ] **Step 5: Run seed tests twice and the backend suite**

Run:

```bash
cd api
.venv/bin/pytest tests/test_demo_seed.py -q
.venv/bin/pytest tests/test_demo_seed.py -q
.venv/bin/pytest -q
```

Expected: both focused runs and the complete backend suite pass.

- [ ] **Step 6: Commit the seed**

```bash
git add api/demo_seed.py api/scripts/seed_build_week_demo.py api/tests/test_demo_seed.py
git commit -m "feat: seed Build Week demo friendship"
```

### Task 4: Add Host-Isolated Demo Popup Contracts

**Files:**
- Create: `web/src/lib/demoAccounts.js`
- Create: `web/src/lib/demoAccounts.test.js`
- Modify: `web/src/features/auth/LoginScreen.jsx`
- Modify: `web/src/features/auth/LoginScreen.test.jsx`
- Modify: `web/src/styles/forms.css`

- [ ] **Step 1: Write failing pure frontend contract tests**

Create `web/src/lib/demoAccounts.test.js`:

```javascript
import { describe, expect, it, vi } from 'vitest'
import { demoAccountFromUrl, demoLoginUrl, openDemoWindow, stripDemoLoginQuery } from './demoAccounts.js'

describe('Build Week demo accounts', () => {
  it('accepts only the two fixed keys', () => {
    expect(demoAccountFromUrl('https://judy.example/?demo_account=judy')).toBe('judy')
    expect(demoAccountFromUrl('https://haland.example/?demo_account=haland')).toBe('haland')
    expect(demoAccountFromUrl('https://example.test/?demo_account=eric')).toBe('')
  })

  it('opens a named separate window', () => {
    const popup = { opener: window, location: { replace: vi.fn() } }
    const openWindow = vi.fn(() => popup)
    expect(openDemoWindow('judy', openWindow, { judy: 'https://judy.example', haland: 'https://haland.example' })).toBe(true)
    expect(openWindow).toHaveBeenCalledWith(
      '',
      'convia-demo-judy',
      'popup',
    )
    expect(popup.opener).toBeNull()
    expect(popup.location.replace).toHaveBeenCalledWith('https://judy.example/?demo_account=judy')
  })

  it('reports blocked popups and removes only its query parameter', () => {
    expect(openDemoWindow('haland', () => null, { judy: 'https://judy.example', haland: 'https://haland.example' })).toBe(false)
    expect(stripDemoLoginQuery('https://haland.example/?demo_account=haland&ref=devpost')).toBe('https://haland.example/?ref=devpost')
  })
})
```

- [ ] **Step 2: Run the pure frontend test and confirm red**

Run:

```bash
cd web && npm test -- --run src/lib/demoAccounts.test.js
```

Expected: the test fails because `demoAccounts.js` does not exist.

- [ ] **Step 3: Implement the popup/query helper**

Create `web/src/lib/demoAccounts.js` with exact exported keys and injected dependencies for tests:

```javascript
export const DEMO_ACCOUNT_EMAILS = Object.freeze({
  judy: 'judy@gods.tw',
  haland: 'haland@gods.tw',
})

export function demoDestinations(env = import.meta.env) {
  return {
    judy: String(env.VITE_DEMO_JUDY_URL || '').replace(/\/$/, ''),
    haland: String(env.VITE_DEMO_HALAND_URL || '').replace(/\/$/, ''),
  }
}

export function demoLoginUrl(key, destinations = demoDestinations()) {
  if (!DEMO_ACCOUNT_EMAILS[key] || !destinations[key]) return ''
  const url = new URL(destinations[key])
  url.searchParams.set('demo_account', key)
  return url.toString()
}

export function demoAccountFromUrl(value) {
  const key = new URL(value).searchParams.get('demo_account') || ''
  return DEMO_ACCOUNT_EMAILS[key] ? key : ''
}

export function stripDemoLoginQuery(value) {
  const url = new URL(value)
  url.searchParams.delete('demo_account')
  return url.toString()
}

export function openDemoWindow(key, openWindow = window.open, destinations = demoDestinations()) {
  const url = demoLoginUrl(key, destinations)
  if (!url) return false
  const popup = openWindow('', `convia-demo-${key}`, 'popup')
  if (!popup) return false
  popup.opener = null
  popup.location.replace(url)
  return true
}
```

- [ ] **Step 4: Replace the Judy-only LoginScreen props with two demo actions**

Use this public interface:

```jsx
export default function LoginScreen({
  locale = 'en',
  googleButtonRef,
  isLoggingIn = false,
  error = '',
  testerLoginEnabled = false,
  demoLoginError = '',
  onOpenTesterLogin,
  onOpenDemoAccount,
})
```

Render both buttons unconditionally for signed-out users:

```jsx
<div className="login-card__demo-actions" aria-label={zh ? '黑客松測試帳號' : 'Hackathon demo accounts'}>
  <button type="button" className="secondary-button" onClick={() => onOpenDemoAccount('judy')}>
    {zh ? '用 Judy 登入' : 'Sign in as Judy'}
  </button>
  <button type="button" className="secondary-button" onClick={() => onOpenDemoAccount('haland')}>
    {zh ? '用 Haland 登入' : 'Sign in as Haland'}
  </button>
</div>
{demoLoginError ? <p className="form-error" role="alert">{demoLoginError}</p> : null}
```

Keep the generic `Tester login` text button conditional on `testerLoginEnabled`.

- [ ] **Step 5: Update LoginScreen tests for locale and both callbacks**

Assert exact English and Traditional Chinese labels, call `onOpenDemoAccount` with `judy` and `haland`, and assert non-demo generic tester login remains hidden when `testerLoginEnabled` is false.

- [ ] **Step 6: Run focused frontend tests**

Run:

```bash
cd web
npm test -- --run src/lib/demoAccounts.test.js src/features/auth/LoginScreen.test.jsx
```

Expected: all focused tests pass.

- [ ] **Step 7: Commit the popup surface**

```bash
git add web/src/lib/demoAccounts.js web/src/lib/demoAccounts.test.js web/src/features/auth/LoginScreen.jsx web/src/features/auth/LoginScreen.test.jsx web/src/styles/forms.css
git commit -m "feat: add Build Week demo launchers"
```

### Task 5: Auto-Authenticate Each Dedicated Demo Host

**Files:**
- Modify: `web/src/App.jsx`
- Modify: `web/src/App.googleIdentity.test.jsx`
- Modify: `web/src/App.visiblePolicy.test.js`

- [ ] **Step 1: Add failing App-level tests**

Add tests that set `window.history.replaceState` to `/?demo_account=judy` or `/?demo_account=haland`, mock `/api/auth/tester`, and assert:

```javascript
expect(fetch).toHaveBeenCalledWith('/api/auth/tester', expect.objectContaining({
  method: 'POST',
  credentials: 'include',
  body: JSON.stringify({ email: 'judy@gods.tw', avatar_url: '' }),
}))
expect(window.location.search).not.toContain('demo_account')
```

Also assert the canonical login button calls `window.open` and a `null` result produces `Please allow pop-ups to open the demo account.` or `請允許彈出式視窗以開啟測試帳號。`.

- [ ] **Step 2: Run the App tests and confirm red**

Run:

```bash
cd web && npm test -- --run src/App.googleIdentity.test.jsx src/App.visiblePolicy.test.js
```

Expected: failures show that Haland, popup launch, and query-driven login are not wired.

- [ ] **Step 3: Implement the bootstrap without a session race**

In `App.jsx`:

```javascript
import {
  DEMO_ACCOUNT_EMAILS,
  demoAccountFromUrl,
  openDemoWindow,
  stripDemoLoginQuery,
} from './lib/demoAccounts.js'
```

Remove `judyLoginEnabled` state and `loginAsJudy`. Add `demoLoginError` and:

```javascript
const openDemoAccount = (key) => {
  setDemoLoginError('')
  if (openDemoWindow(key)) return
  setDemoLoginError(t(
    'Please allow pop-ups to open the demo account.',
    '請允許彈出式視窗以開啟測試帳號。',
  ))
}
```

Make `loginTesterAccount` return `true` after applying the authenticated user and `false` for validation, HTTP, provider, or abort failure. At the start of the existing restore effect, detect the one-time query. If present, call `loginTesterAccount` with `modal: false`; only after it returns `true`, replace the URL with `stripDemoLoginQuery(window.location.href)`. Return from the effect without issuing the competing `/api/session/me` restore request. The allowlisted backend remains the authority; the query never supplies an arbitrary email.

- [ ] **Step 4: Pass the new LoginScreen props**

Use:

```jsx
<LoginScreen
  locale={isZh ? 'zh-TW' : 'en'}
  googleButtonRef={googleButtonRef}
  isLoggingIn={isLoggingIn}
  error={googleError}
  testerLoginEnabled={testerLoginEnabled}
  demoLoginError={demoLoginError}
  onOpenTesterLogin={() => setTesterModalOpen(true)}
  onOpenDemoAccount={openDemoAccount}
/>
```

- [ ] **Step 5: Run focused and full frontend verification**

Run:

```bash
cd web
npm test -- --run src/App.googleIdentity.test.jsx src/App.visiblePolicy.test.js src/features/auth/LoginScreen.test.jsx src/lib/demoAccounts.test.js
npm test -- --run
npm run build
```

Expected: focused tests, the complete frontend suite, and the production build pass.

- [ ] **Step 6: Commit the integrated login flow**

```bash
git add web/src/App.jsx web/src/App.googleIdentity.test.jsx web/src/App.visiblePolicy.test.js
git commit -m "feat: isolate demo account sessions by host"
```

### Task 6: Make the Repository Reproducible and Submission-Ready

**Files:**
- Modify: `api/requirements.txt`
- Create: `.github/workflows/test.yml`
- Create: `LICENSE`
- Modify: `README.md`
- Create: `docs/hackathon-submission.md`

- [ ] **Step 1: Pin the verified backend environment**

Replace `api/requirements.txt` with:

```text
Flask==3.1.3
openai==2.45.0
google-cloud-firestore==2.23.0
google-genai==1.65.0
ably==2.0.12
cryptography==46.0.5
pytest==9.1.1
```

- [ ] **Step 2: Add continuous verification**

Create `.github/workflows/test.yml`:

```yaml
name: test

on:
  push:
  pull_request:

jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          cache: pip
          cache-dependency-path: api/requirements.txt
      - run: pip install -r api/requirements.txt
      - run: pytest -q
        working-directory: api

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
          cache-dependency-path: web/package-lock.json
      - run: npm ci
        working-directory: web
      - run: npm test -- --run
        working-directory: web
      - run: npm run build
        working-directory: web
```

- [ ] **Step 3: Add the MIT license**

Create `LICENSE` with the standard MIT text, copyright line:

```text
Copyright (c) 2026 Eric Chen
```

- [ ] **Step 4: Rewrite README around the approved thesis**

The opening must include this exact product argument before the feature list:

```markdown
ChatGPT Desktop's attempt to merge everyday conversation and Codex into one product is a failure of product shape. Coding work and daily human communication do not share the same rhythm, context, or purpose. Codex deserves a focused workspace. ChatGPT is better suited to becoming a messenger: a place where AI participates in real relationships and finally becomes the everyday life entry point OpenAI has repeatedly said it wants to build.
```

Then include: Apps for Your Life category, pre-July-13 baseline, July-13+ ChatGPT-like redesign as the largest meaningful extension, OpenAI migration, shared Convia replies, judge links, two-window walkthrough, local installation, environment setup, sample data behavior, test commands, `/feedback` task `019f6400-da42-7353-abc6-a45ecca1e4f1`, Codex/GPT-5.6 collaboration, human decisions, security boundaries, and known limitations.

- [ ] **Step 5: Write the English Devpost submission draft**

Create `docs/hackathon-submission.md` with completed prose under these headings:

```markdown
# Convia — OpenAI Build Week Submission

## Tagline
AI belongs in human conversation, not bolted onto a coding workspace.

## Inspiration
## What it does
## The Build Week extension
## How we built it
## How Codex and GPT-5.6 were used
## Challenges
## Accomplishments
## What we learned
## What's next
## How judges can test it
## Links
```

The text must be direct about the ChatGPT Desktop/Codex critique, identify the ChatGPT-like interface as the largest July 13+ change, distinguish human product decisions from Codex execution, and omit a video URL.

- [ ] **Step 6: Verify docs and dependency installation**

Run:

```bash
rg -n 'coming soon|insert URL|example\.com' README.md docs/hackathon-submission.md || true
rg -n 'ChatGPT-like|July 13|Codex|GPT-5.6|019f6400-da42-7353-abc6-a45ecca1e4f1|Judy|Haland' README.md docs/hackathon-submission.md
python3 -m venv /tmp/convia-build-week-venv
/tmp/convia-build-week-venv/bin/pip install -r api/requirements.txt
/tmp/convia-build-week-venv/bin/pytest -q api
rm -rf /tmp/convia-build-week-venv
```

Expected: no unfinished markers or invented domains; all required evidence is present; a clean environment installs and passes the backend suite.

- [ ] **Step 7: Commit repository and submission artifacts**

```bash
git add api/requirements.txt .github/workflows/test.yml LICENSE README.md docs/hackathon-submission.md
git commit -m "docs: prepare Convia Build Week submission"
```

### Task 7: Configure, Deploy, Seed, and Verify Both Hostnames

**Files:**
- Modify: Vercel project environment and aliases
- Deploy: frontend and backend
- Seed: production Firestore
- Update: `README.md`, `docs/hackathon-submission.md` with verified URLs

- [ ] **Step 1: Run final local gates**

Run:

```bash
cd api && .venv/bin/pytest -q
cd ../web && npm test -- --run && npm run build
cd .. && git diff --check && git status --short
```

Expected: every test and build passes; only intended final URL documentation edits remain.

- [ ] **Step 2: Provision two Vercel aliases before rebuilding**

Assign the exact project-owned aliases `convia-judy.vercel.app` and `convia-haland.vercel.app` to the same production deployment, then set these production environment variables:

```text
VITE_DEMO_JUDY_URL=https://convia-judy.vercel.app
VITE_DEMO_HALAND_URL=https://convia-haland.vercel.app
```

Expected: both values are different HTTPS hostnames and neither equals `https://pisces-plum.vercel.app`.

- [ ] **Step 3: Deploy Cloud Run and Vercel**

Run the repository's verified production commands from `/Users/eric/Documents/Convia`:

```bash
gcloud builds submit --config api/cloudbuild.yaml --substitutions=REPO_FULL_NAME=ericchen1972/pisces,COMMIT_SHA=$(git rev-parse HEAD) .
npx vercel --prod --yes
```

Expected: Cloud Build succeeds, Cloud Run reports a ready revision with 100% traffic, Vercel reports Ready, and the canonical alias plus both demo aliases resolve to the new deployment.

- [ ] **Step 4: Seed the two production demo accounts twice**

Run with the existing production Firestore credentials configured locally:

```bash
cd api
.venv/bin/python scripts/seed_build_week_demo.py
.venv/bin/python scripts/seed_build_week_demo.py
```

Expected: both runs print `"ok": true`, identical Judy/Haland user IDs, and the same friendship pair key.

- [ ] **Step 5: Perform live two-window verification**

Open the canonical login page. Click Judy and Haland and verify:

1. two different hostnames open;
2. Judy remains Judy after Haland logs in;
3. Haland remains Haland after Judy refreshes;
4. each contact list contains the other account;
5. Judy can send Haland a text message;
6. Haland receives and replies;
7. both can invoke Convia in their shared conversation;
8. a production POST for `eric@gods.tw` to `/api/auth/tester` returns 404;
9. `zh-TW`/Hant shows Traditional Chinese and another locale shows English.

- [ ] **Step 6: Record only verified live URLs**

Replace the deployment-link sections in `README.md` and `docs/hackathon-submission.md` with the canonical, Judy, and Haland HTTPS URLs observed in Step 5.

- [ ] **Step 7: Commit, push, and verify repository/deployment parity**

Run:

```bash
git add README.md docs/hackathon-submission.md
git commit -m "docs: record verified Build Week demo links"
git push origin main
git status --short
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

Expected: the worktree is clean and local `HEAD`, GitHub `main`, README links, Devpost links, and the deployed implementation all describe the same completed Build Week project.

- [ ] **Step 8: Check GitHub Actions**

Run:

```bash
gh run list --repo ericchen1972/pisces --limit 5
```

Expected: the pushed `main` workflow finishes successfully. If it fails, inspect the failing job, reproduce locally, fix, repush, and do not mark the submission ready until both jobs pass.
