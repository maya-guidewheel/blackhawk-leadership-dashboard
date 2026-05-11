# Blackhawk Molding — Leadership Dashboard

Production dashboard for analyzing **changeover time** and **energy cost** by plant and machine, using Guidewheel CSV exports. Deployed on Railway.

---

## Quick Start (local dev)

```bash
npm install
cp .env.example .env   # then fill in real values — see below
npm run dev
```

---

## Environment Variables

All required. No hardcoded defaults exist in production builds.

| Variable | Purpose |
|---|---|
| `VITE_PASSWORD` | Password for the main dashboard login gate |
| `VITE_ENERGY_PASSWORD` | Password for the executive Energy & Cost tab |
| `VITE_POSTHOG_KEY` | PostHog project API key. Omit or leave blank to disable tracking. |
| `VITE_POSTHOG_DISABLED` | Set to `"true"` to disable all PostHog tracking (useful locally) |
| `DB_PATH` | Path to SQLite database file (default: `./blackhawk.db`; Railway: `/data/blackhawk.db`) |
| `PORT` | HTTP port (default: `3001`) |

Set these in Railway → Service → Variables. For local dev, copy `.env.example` to `.env` and fill in values.

---

## Authentication

### How it works

There are two layers of authentication:

1. **Client-side gate (UX)** — `AuthGate.tsx` and `EnergyGate.tsx` check a password before rendering any content. Sessions are stored in localStorage with a 12-hour expiry.

2. **Server-side API auth (security)** — every `/api/*` request requires an `Authorization: Bearer <token>` header. The token is the base64-encoded password, set automatically by the client after login. The server validates it against `VITE_PASSWORD` using a timing-safe comparison. Unauthenticated requests return `401`.

> The `/health` endpoint is intentionally public — it is required by Railway's health check.

### Important: set both env vars

If `VITE_PASSWORD` is not set:
- The login screen shows "Dashboard not configured"
- All `/api/*` requests return `500`

If `VITE_ENERGY_PASSWORD` is not set:
- The Energy tab shows "Energy tab not configured"

---

## Data Upload

Upload Guidewheel CSVs via the **Upload CSV** button in the dashboard header. Two supported types:

- **Issues CSV** — changeover events (Start, End, Duration, Devices, Tags columns required)
- **Energy CSV** — daily average power per machine (Machine; Date; Energy kWh columns)

Files are deduplicated on ingest — re-uploading the same file is safe. Max upload size: **10 MB**.

---

## Analytics (PostHog)

Tracking fires only when `VITE_POSTHOG_KEY` is set.

**Events tracked:**
- `$pageview` on load
- `filter_changed` — date range, plant, device, threshold, changeover type changes
- `export_clicked` — which export was triggered
- `drilldown_plant_week` — plant-week row clicked
- `drilldown_device` — device row clicked

To disable locally: set `VITE_POSTHOG_DISABLED=true` in `.env`.

---

## Data Categories & PII

The following data is stored in SQLite and served by the `/api/data/issues` endpoint:

| Field | Source | Notes |
|---|---|---|
| `device` | Guidewheel CSV | Machine ID (e.g. `1M001`) |
| `plant` | Derived from device ID | Addison / Mayflower / Sparks |
| `start_dt`, `end_dt`, `duration` | Guidewheel CSV | Event timestamps |
| `comments` | Guidewheel CSV | Free-text; may include operator names or notes |
| `tags`, `status` | Guidewheel CSV | Operational metadata |

PostHog receives filter state (date ranges, plant names, device IDs, thresholds) — no direct PII, but fine-grained operational behavior. Data is processed by PostHog (US region, `us.i.posthog.com`).

---

## Railway Deployment

The project deploys from source using `railway up` or via GitHub integration.

```bash
# Deploy from local (current approach)
railway up

# Check deployment status
railway status

# View logs
railway logs
```

### Persistent volume

The SQLite database lives on a Railway persistent volume mounted at `/data/blackhawk.db`. Set `DB_PATH=/data/blackhawk.db` in Railway variables. Without this, the database resets on every deploy.

---

## Key Files

| File | Purpose |
|---|---|
| `server.ts` | Express backend, SQLite ingestion, API routes, auth middleware |
| `src/App.tsx` | Main React app, data loading, tab routing |
| `src/auth/AuthGate.tsx` | Main login gate |
| `src/auth/EnergyGate.tsx` | Executive energy tab gate |
| `src/utils/api.ts` | `apiFetch` wrapper — attaches auth token to every API call |
| `src/data/parser.ts` | CSV parsing, plant/machine type detection |
| `src/data/energyAggregations.ts` | Idle threshold logic, energy cost calculations |
| `src/components/EnergyDashboard.tsx` | Energy & Cost tab |
| `src/components/GlobalFilters.tsx` | Changeover tab filters |
| `Dockerfile` | Multi-stage production build |
| `railway.toml` | Railway service configuration |

---

## Customer Link Security Checklist

Run through this before sharing a link with any customer or stakeholder.

- [ ] **VITE_PASSWORD and VITE_ENERGY_PASSWORD set** to non-default values in Railway → Variables
- [ ] **Verify API auth**: `curl https://<your-domain>/api/data/issues` should return `401` with no `Authorization` header
- [ ] **Verify login gate**: open the URL in incognito — confirm password screen appears before any data loads
- [ ] **Confirm PostHog events firing** (if tracking enabled): open PostHog → Live Events after logging in
- [ ] **Add to Forward Deployed Tracker** — post entry in the Slack workflow before sharing the link
- [ ] **Run security review** — paste the live URL into the security review tool and post results in `#security`
- [ ] **Rotate credentials after sharing** — update Railway variables and redeploy
