# Security & Performance Review — Blackhawk Leadership Dashboard

**Scope:** `server.ts`, React client (`src/`), PostHog, auth gates, SQLite ingestion, `README.md` / `.env.example`. Not reviewed: live Railway env, DNS, WAF.

---

## At a glance

**Already in the codebase**

- All `/api/*` routes require `Authorization: Bearer …` validated against `VITE_PASSWORD` (timing-safe). Unauthed requests → `401`.
- Rate limiting on `/api` + stricter limit on uploads (`express-rate-limit`).
- Upload cap **10 MB**; upload errors return a generic message to the client; full errors logged server-side.
- No hardcoded PostHog key; init only if `VITE_POSTHOG_KEY` is set; `VITE_POSTHOG_DISABLED=true` disables tracking.
- No default dashboard passwords in code; missing `VITE_PASSWORD` → server `500` + client “not configured” UI.
- `README` has Data Categories / PII notes; SQLite WAL + transactional ingest + dedup.

**Still needs work**

- Exec-only energy: server does **not** check `VITE_ENERGY_PASSWORD` on `/api/data/energy/average` — anyone with the main token can hit the API.
- Auth token is `btoa(password)` in **localStorage** — XSS = full API access until expiry. Prefer HttpOnly session cookies + opaque server-side tokens.
- Performance: full-table reads, no compression/ETag; optional privacy/docs for `comments`, PostHog retention, `ingestion_log.file_name`.

---

## What the developer should do (backlog)

Do these in order unless product says otherwise.

### 1. P0 — Server-side executive gate for energy API

**Problem:** `EnergyGate` is UI-only. `/api/data/energy/average` uses the same `requireAuth` as issues — main password is enough.

**Do:**

- Require a second credential for `GET /api/data/energy/average` (and any future `/api/data/energy/*`), e.g. validate `Authorization` against `VITE_ENERGY_PASSWORD` (separate header, second Bearer, or exec session cookie).
- Update `apiFetch` / client so energy calls only run after exec success and send that credential.
- Decide whether `/api/status` should hide or redact `energy_*` fields for users who have not passed exec (optional product call).

**Done when:** `curl` with only the main Bearer token gets **401** on `/api/data/energy/average`; with exec credential you get **200**.

---

### 2. P0 — Stop storing password-equivalent tokens in localStorage

**Problem:** `AuthGate` stores `btoa(password)` as the Bearer token. Any XSS that reads `localStorage` can replay API calls.

**Do:**

- Issue an opaque random session id from the server after password check; store it in an **HttpOnly** + **Secure** + **SameSite** cookie (or short-lived JWT only in cookie).
- Server validates session on each request; rotate/invalidate on logout/expiry.
- If you stay on Bearer for now, document the residual XSS risk explicitly in README.

**Done when:** JS cannot read the credential used to authorize API calls; tokens are revocable server-side.

---

### 3. P1 — `comments` and exports (privacy / governance)

**Problem:** Guidewheel `Comments` are stored, returned in JSON, and exported in CSV — may contain names or sensitive notes.

**Do (pick what matches policy):**

- Document retention and who may export `Comments` in README (or internal policy doc).
- Optionally: omit or truncate `comments` in API/exports by default; add an explicit “include comments” export if needed.

**Done when:** Product/legal agrees the default behavior matches how you treat operator free text.

---

### 4. P1 — PostHog (governance)

**Problem:** `filter_changed` sends dates, plant, device, thresholds — operational telemetry to US PostHog.

**Do:**

- Confirm `VITE_POSTHOG_DISABLED` / missing key behavior is acceptable for customer deployments.
- Document retention and whether customer consent is required.

**Done when:** README (or customer pack) states when tracking is on, what is sent, and how to turn it off.

---

### 5. P2 — API performance and payload size

**Problem:** `GET /api/data/issues` and energy average return **all** rows every time; no compression or conditional GET.

**Do:**

- Add query params for date range (and validate bounds server-side); paginate or cap if tables grow large.
- Add `compression` middleware; consider `ETag` / `If-None-Match` for stable read responses.

**Done when:** Typical dashboard load transfers less data and TTFB improves on large DBs (measure before/after).

---

### 6. P2 — `ingestion_log.file_name`

**Problem:** Original upload filenames (may include identifying strings) are persisted.

**Do:** Hash or normalize filenames before insert, or document retention and access.

---

### 7. P3 — Nice to have

- Reduce or gate DB path logging in production (`server.ts` startup).
- Add Dependabot or equivalent for `package-lock.json` updates.

---

## Quick verification (after deploy)

```bash
# Should be 401 without Authorization
curl -s -o /dev/null -w "%{http_code}" https://<host>/api/data/issues

# With main Bearer (base64 of VITE_PASSWORD) — should be 200 until exec fix lands
curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer <main_token>" https://<host>/api/data/issues
```

After implementing the energy fix, the second curl to `/api/data/energy/average` with **only** the main token should be **401**.

---

## Verified OK (no action required for these)

- No `dangerouslySetInnerHTML` / `innerHTML` in `src/`.
- No `eval` / `new Function` in app source.
- SQLite: WAL, transactional ingest, `INSERT OR IGNORE` dedup.
- PostHog: no hardcoded project key; `autocapture: false`.

---

*Static review; confirm P0 items against your real deployment URL and threat model.*
