# Security & Performance Review — Blackhawk Leadership Dashboard

**Scope:** Reviewed this repository end-to-end: Express server (`server.ts`), React/Vite client (`src/`), analytics (`src/analytics/posthog.ts`), auth gates (`src/auth/`), data parsing/storage (`src/data/`, SQLite via `better-sqlite3`), Docker/Railway deployment (`Dockerfile`, `railway.toml`), and `README.md` / `.env.example`.  
**Not reviewed:** Live Railway/Netlify configuration, DNS, WAF, or secrets actually configured in hosting dashboards (only code and docs).

---

## Prioritized findings

### P0 — Ship blockers / critical exposure

1. **Exec/energy restriction is UI-only; the API enforces only the main password**
   **Why it matters:** `EnergyGate` gates rendering in the browser only. The server enforces `VITE_PASSWORD` for all `/api/*` routes, including `/api/data/energy/average`. Any user who can use the main Bearer token can call the energy endpoint directly and view leadership-restricted analysis, bypassing the intended “exec-only” control.
   **Where:** `server.ts` (`/api/data/energy/average` protected by `requireAuth`), `src/auth/EnergyGate.tsx`, `src/utils/api.ts` (main token attached to API calls).
   **Fix / verify:** Enforce executive authorization server-side for `/api/data/energy/*` (separate exec token validated against `VITE_ENERGY_PASSWORD`, or remove energy routes when exec auth is not present). Verification: with only the main auth token, `curl /api/data/energy/average` should not return `200` unless exec auth is also present.

2. **Bearer token is password-equivalent and stored in `localStorage`**
   **Why it matters:** After successful login, the client stores `token: btoa(password)` in `localStorage` and reuses it as the Bearer token (`Authorization: Bearer ...`) for API calls. This couples your long-lived credential material to browser storage; if any XSS/vector ever exfiltrates `localStorage`, the attacker can reuse the token to call protected APIs until expiry.
   **Where:** `src/auth/AuthGate.tsx` (base64 token storage), `src/utils/api.ts` (Authorization header), `server.ts` (Bearer decoded and timing-safe compared to `VITE_PASSWORD`).
   **Fix / verify:** Switch to opaque, random session tokens stored in `HttpOnly`/`Secure` cookies; rotate and expire server-side. Verification: confirm the API rejects password-equivalent Bearer tokens and tokens can’t be replayed outside cookie scope.

### P1 — High

3. **Free-text operational notes (`comments`) are persisted, served, and exported (privacy risk)**
   **Why it matters:** Guidewheel `Comments` are parsed and stored in SQLite (`issues.comments`), returned verbatim by `GET /api/data/issues`, and included in exported CSVs. Free text can include operator names, contact info, shift notes, or other sensitive operational material.
   **Where:** `src/data/parser.ts`, `server.ts` (`comments` field in `/api/data/issues`), `src/utils/exports.ts` (CSV export includes `Comments`).
   **Fix / verify:** Add explicit privacy guidance for `Comments` in `README.md`. Consider truncation/redaction for display/export (or opt-in export of comments). Verification: exported CSVs should not include sensitive fields unless explicitly required.

4. **PostHog sends fine-grained operational behavior to a US SaaS**
   **Why it matters:** The app tracks filter changes (`filter_changed`) including date ranges, plant/device selections, threshold, and changeover types. While not “direct PII” by itself, it is operational intelligence and may be subject to internal governance/retention/consent requirements.
   **Where:** `src/components/GlobalFilters.tsx`, `src/analytics/posthog.ts`, `README.md` (PostHog section).
   **Fix / verify:** Ensure tracking can be fully disabled (`VITE_POSTHOG_DISABLED=true`) and document retention/consent expectations. Verification: with `VITE_POSTHOG_DISABLED=true`, no PostHog init/capture should occur.

5. **Token misuse risk due to header-based bearer auth + missing CSRF controls (context-dependent)**
   **Why it matters:** Auth is done via `Authorization: Bearer ...` header (not cookies), which generally reduces classic CSRF risk. However, because the token is stored in `localStorage`, any XSS that can read localStorage becomes catastrophic (see P0-2).
   **Where:** `src/auth/AuthGate.tsx`, `src/utils/api.ts`, `server.ts` bearer validation.
   **Fix / verify:** Address at the root with HttpOnly cookies + opaque tokens (preferred; see P0-2). Verification: confirm tokens are not accessible to JS.

### P2 — Medium

6. **Full-table reads + no pagination/date bounding (performance + data-exfil size)**
   **Why it matters:** The server returns complete datasets:
   - `GET /api/data/issues` loads all `issues` rows
   - `GET /api/data/energy/average` loads all `energy_average` rows
   Responses scale linearly with DB size, increasing latency, bandwidth cost, and the amount of sensitive data an authenticated user can retrieve.
   **Where:** `server.ts` (`SELECT * FROM issues ...`, `getEnergyAvg` selects all energy_average rows).
   **Fix / verify:** Add date-bounded queries/pagination (query params validated server-side) and consider response compression + caching (`ETag`/`If-None-Match`). Verification: load time and payload size should drop when selecting narrower date ranges.

7. **No HTTP response compression/caching**
   **Why it matters:** Large JSON payloads are returned without compression; this increases tail latency and bandwidth costs.
   **Where:** `server.ts` (no compression/caching middleware detected).
   **Fix / verify:** Add `compression` middleware and set reasonable caching headers where applicable. Verification: compare payload transfer sizes via browser network inspector.

8. **Upload file metadata is stored (`file_name`) and may retain customer-identifying strings**
   **Why it matters:** Upload ingestion logs `fileName` (`req.file.originalname`) into `ingestion_log.file_name`. If users upload files that include customer names, this becomes a stored retention of those strings.
   **Where:** `server.ts` upload handler + `ingestion_log` table schema.
   **Fix / verify:** Consider hashing or truncating `file_name`, or documenting retention. Verification: file names should not include sensitive identifiers (or should be safely transformed).

### P3 — Low / hardening

9. **Startup logging discloses deployment paths**
   **Why it matters:** Server logs database path and listens on the configured port. Usually fine, but avoid overly detailed logs in shared/third-party log aggregators.
   **Where:** `server.ts` listen callback.
   **Fix / verify:** Downgrade/remove DB-path logging in production. Verification: confirm production logs don’t include sensitive path info.

10. **Supply chain hygiene**
   **Why it matters:** Dependency versions are pinned via `package-lock.json`, but there is no visible Dependabot/GitHub security automation in-repo.
   **Where:** repository configuration (no visible `.github/`).
   **Fix / verify:** Enable automated dependency updates and security alerts. Verification: ensure you have a process for routine CVE remediation.

---

## Verified OK / assumptions

- **XSS via `dangerouslySetInnerHTML` / `innerHTML`:** No matches found in `src/`.
- **Explicit `eval` / `new Function`:** Not found in application source.
- **SQLite ingestion safety:** WAL mode enabled; ingestion uses a transaction; dedup uses `INSERT OR IGNORE` + deterministic row hashes.
- **API rate limiting exists:** `express-rate-limit` is applied for reads and separately for uploads.
- **Upload size is bounded:** Multer `limits.fileSize` is set (10 MB).
- **PostHog fallback key:** No hardcoded PostHog default key; tracking only initializes when `VITE_POSTHOG_KEY` is set and can be disabled via `VITE_POSTHOG_DISABLED=true`.

**Assumption:** This review focuses on code-level security; actual exposure depends on infrastructure (how broadly the service is reachable, reverse proxy settings, and any additional edge auth/WAF).

---

## README / PII alignment

The current `README.md` includes a **Data Categories & PII** section that explains that `Comments` are stored in SQLite and identifies what PostHog receives. However, it does not fully specify **retention duration**, and does not include a complete “PII inventory” (identifiers, destinations, retention/rotation) in a legal/compliance-friendly format.  
Given that `comments` are exported and served verbatim, you should explicitly document retention and handling expectations for customer/operator-provided free text.

---

## API performance summary

| Area | Observation |
|------|-------------|
| Read paths | Full dataset reads on each request; no pagination/date-bounding. |
| Write paths | CSV ingestion is transactional with dedup; max upload size is bounded. |
| Client | One-shot parallel fetch on mount; in-memory filtering and recomputation for charts. |
| Network | No response compression/caching detected. |

---

## Recommended next steps (ordered)

1. **Enforce exec authorization server-side for `/api/data/energy/*`** (P0).
2. **Replace password-equivalent bearer tokens with opaque server sessions stored in HttpOnly cookies** (P0).
3. **Add privacy governance for `Comments`** (redaction/truncation, export controls, and retention documentation) (P1).
4. **Implement date-bounded/paginated queries and add compression/caching** for large JSON payloads (P2).
5. **Harden stored upload metadata retention** (`file_name`) to avoid keeping customer-identifying strings longer than necessary (P2).

---

*Review generated from static analysis of the repository; validate all P0 items against your actual deployment URL and threat model.*

# Security & Performance Review — Blackhawk Leadership Dashboard

**Scope:** Reviewed this repository end-to-end: Express server (`server.ts`), React/Vite client (`src/`), analytics (`src/analytics/posthog.ts`), auth gates (`src/auth/`), data parsing/storage (`src/data/`, SQLite via `better-sqlite3`), Docker/Railway deployment (`Dockerfile`, `railway.toml`), and `README.md` / `.env.example`.  
**Not reviewed:** Live Railway/Netlify configuration, DNS, WAF, or secrets actually configured in hosting dashboards (only code and docs).

---

## Prioritized findings

### P0 — Ship blockers / critical exposure

1. **Server API has no authentication or authorization**  
   **Why it matters:** Every route on the Express app (`GET /api/status`, `GET /api/data/issues`, `GET /api/data/energy/*`, `POST /api/upload`) is callable by anyone who can reach the host. The React `AuthGate` and `EnergyGate` only run in the browser; they do not protect the API. An attacker with the deployment URL can read the full issues/energy database and upload arbitrary CSVs (data poisoning, DoS via large files).  
   **Where:** `server.ts` (all `/api/*` handlers).  
   **Fix / verify:** Add server-side auth (e.g. shared secret in `Authorization` header validated in middleware, session cookies with HttpOnly + CSRF for browser POSTs, or mTLS / private network + edge auth). Apply the same check to `/health` only if you need to hide existence of the service; otherwise health can stay public for orchestration. Re-verify after deploy that unauthenticated `curl` to `/api/data/issues` fails.

2. **Default and build-time passwords are discoverable**  
   **Why it matters:** `VITE_PASSWORD` and `VITE_ENERGY_PASSWORD` are compiled into the client bundle (`import.meta.env`). Defaults `blackhawk2026` and `energy2026` apply when env vars are unset. Anyone can read the bundle or README and bypass the “gates,” or run the app without setting secrets.  
   **Where:** `src/auth/AuthGate.tsx` (line 6), `src/auth/EnergyGate.tsx` (line 4), `README.md` (default password documented).  
   **Fix:** Remove hardcoded defaults in production builds; fail the build or show a blocking error if required env vars are missing. Treat client gates as **UX only**; real protection must be server-side (P0-1) and/or edge (e.g. HTTP Basic in front of the whole site).

### P1 — High

3. **Operational/PII-adjacent data in `comments` and PostHog event properties**  
   **Why it matters:** Guidewheel `Comments` are parsed and stored (`parser.ts` → `issues.comments`) and returned by `GET /api/data/issues`. Free text may include names, shift notes, or other sensitive content. PostHog `filter_changed` sends the **partial** filter object (`GlobalFilters.tsx`), which can include `dateFrom`, `dateTo`, `plant`, `device`, `threshold`, `changeoverType` — not direct PII but fine-grained operational behavior sent to a US SaaS (`us.i.posthog.com`).  
   **Where:** `src/data/parser.ts`, `server.ts` (issues columns), `src/components/GlobalFilters.tsx`, `src/analytics/posthog.ts`.  
   **Fix:** Document in README what fields are stored and sent externally; consider redacting or truncating `comments` for display/export, or hashing for analytics. Add a README **PII & data flow** section per your forward-deployed playbook. Optionally set `VITE_POSTHOG_DISABLED=true` for sensitive deployments or narrow `trackEvent` payloads.

4. **PostHog project key hardcoded**  
   **Why it matters:** `phc_...` in `src/analytics/posthog.ts` and `.env.example` means any clone sends events to the same project if env is not overridden. Key rotation and tenant isolation are harder.  
   **Where:** `src/analytics/posthog.ts` (`DEFAULT_KEY`), `.env.example`, `README.md`.  
   **Fix:** Remove default key; require `VITE_POSTHOG_KEY` at build time for production or disable tracking when unset.

5. **Unbounded upload size and no rate limiting**  
   **Why it matters:** Multer allows **100 MB** per upload (`server.ts`). Combined with unauthenticated `POST /api/upload`, this is a straightforward disk/memory/CPU abuse vector. No throttling on read endpoints either.  
   **Where:** `server.ts` (`multer` limits).  
   **Fix:** Lower max file size to a realistic CSV ceiling, add rate limiting (e.g. `express-rate-limit`) per IP or per auth identity, and consider total ingestion time limits.

### P2 — Medium

6. **API shape: full-table reads, no pagination or caching**  
   **Why it matters:** `GET /api/data/issues` runs `SELECT * FROM issues ORDER BY ...` and returns every row as JSON. Same pattern for energy endpoints. Latency and payload size grow linearly with history; the client keeps all events in React state (`App.tsx`). Mobile/slow links suffer; server repeats identical work on every refresh.  
   **Where:** `server.ts` (`stmts.getIssues`, `getEnergyAvg`, `getEnergyMax`), `src/App.tsx` (`loadAll`, `refreshIssues`).  
   **Fix:** Add optional query params (`since`, `limit`, `cursor`) or server-side filtering by date range; use HTTP caching headers or ETag for unchanged datasets; compress responses (`compression` middleware). For the client, virtualize long lists if you add tables with many rows.

7. **`GET /api/data/energy/max` exposed but unused by the UI**  
   **Why it matters:** Extra attack surface and DB read path with no product benefit unless something else calls it.  
   **Where:** `server.ts`; client only fetches `energy/average` in `App.tsx`.  
   **Fix:** Remove the route or wire it into the app; if kept, protect with same auth as other routes.

8. **Documentation vs repo drift (Netlify / edge auth)**  
   **Why it matters:** `README.md` describes `netlify/edge-functions/basic-auth.ts` and Netlify env vars, but `.gitignore` ignores `netlify/` and comments say deployment is Railway. Operators may assume Basic Auth exists when it does not in this tree.  
   **Where:** `README.md`, `.gitignore`.  
   **Fix:** Single source of truth: document Railway + required reverse-proxy/auth, or commit the edge function template without ignoring it for reference.

9. **Upload error messages may leak implementation details**  
   **Why it matters:** `res.status(500).json({ error: msg })` forwards `Error.message` from ingestion (`server.ts`). Parser/database errors might expose paths or internal strings.  
   **Where:** `server.ts` upload catch block.  
   **Fix:** Log full error server-side; return generic message to client in production.

### P3 — Low / hardening

10. **Session semantics for “executive” gate**  
    **Why it matters:** `EnergyGate` stores only `sessionStorage` flag `1` after password match — no expiry, weaker than `AuthGate`’s 12h expiry. Still fully bypassable via API (P0).  
    **Where:** `src/auth/EnergyGate.tsx`.

11. **Startup logging**  
    **Why it matters:** Server logs database path and port — useful for ops, minor info disclosure in shared log aggregators.  
    **Where:** `server.ts` listen callback.

12. **Supply chain**  
    **Why it matters:** Dependencies are pinned via `package-lock.json` (good). No Dependabot config visible in-repo (no `.github/`).  
    **Fix:** Enable automated dependency updates in the hosting provider or add GitHub Dependabot.

---

## Verified OK / assumptions

- **XSS via `dangerouslySetInnerHTML`:** No matches in `src/`; React text rendering escapes content by default.  
- **Explicit `eval` / `new Function`:** Not found in application source.  
- **SQLite:** WAL mode enabled; transactions used for ingestion; `INSERT OR IGNORE` used for deduplication.  
- **PostHog:** `autocapture: false` reduces noisy/leaky UI capture.  
- **Client bundle:** No obvious server-only secrets beyond the intentional `VITE_*` pattern (still a concern for passwords and PostHog key — see P0/P1).  
- **Assumption:** If the app is only reachable on a private network with VPN/firewall, risk is lower — **confirm in infrastructure**, not from this repo alone.

---

## README / PII alignment

The README documents PostHog events and password behavior but does **not** include an explicit **PII inventory** (identifiers collected, retention, subprocessors, regions) aligned with code. The CSV schema lists columns including **Comments** — those values are persisted and API-exposed; this should be stated explicitly for customer/legal expectations.

---

## API performance summary

| Area | Observation |
|------|-------------|
| Read paths | Full scans, no pagination; JSON serialization of entire tables on each request. |
| Write paths | Single-file upload; transactional inserts; reasonable for moderate CSV size. |
| Client | One-shot parallel fetch on mount (`issues`, `energy/average`, `status`); in-memory filtering; acceptable for small/medium datasets, degrades with very large exports. |
| Network | No response compression configured in Express; consider `compression` middleware. |

---

## Recommended next steps (ordered)

1. Enforce **server-side authentication** on all `/api/*` routes used in production (P0).  
2. Remove default `VITE_*` password fallbacks from production builds; document operator setup (P0/P1).  
3. Add **rate limiting** and reduce **max upload** size (P1).  
4. Document **data categories** (including comments) and PostHog data flow in README (P1 / playbook).  
5. Plan **pagination or date-bounded queries** before datasets grow further (P2).

---

*Review generated from static analysis of the repository; validate all P0 items against your actual deployment URL and threat model.*
