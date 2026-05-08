# Blackhawk Molding - Color Change Dashboard

Production-lean dashboard for analyzing **color change time** by plant and machine using Guidewheel CSV exports.

## Quick Start

```bash
# Install dependencies
npm install

# Copy env config
cp .env.example .env

# Place your Guidewheel CSV export at:
#   ./data/issues.csv

# Start dev server
npm run dev

# Build for production
npm run build
npm run preview
```

## Password Protection

The dashboard requires a password before any content is visible.

- **Default password**: `blackhawk2026`
- **To change**: Edit `VITE_PASSWORD` in your `.env` file
- Sessions expire after **12 hours** and are stored in localStorage
- **IMPORTANT**: Always change the default password before sharing a customer link

```env
VITE_PASSWORD=your-secure-password-here
```

## PostHog Analytics

Tracking is enabled by default using the project key.

| Env Variable | Default | Purpose |
|---|---|---|
| `VITE_POSTHOG_KEY` | `phc_QIgbD8nFuxMwPrURQbXJxKqI1uEwrmWrnorrr5v1oto` | PostHog project API key |
| `VITE_POSTHOG_DISABLED` | `false` | Set to `true` to disable all tracking |

**Events tracked:**
- `$pageview` on load
- `filter_changed` (date range, plant, device, threshold changes)
- `export_clicked` (which export was triggered)
- `drilldown_plant_week` (plant-week row clicked)
- `drilldown_device` (device row clicked)

## Data Format

Input: CSV exported from Guidewheel, placed at `./data/issues.csv`

Required columns:
```
Start, End, Duration (minutes), Devices, Status, Type, Alert Type,
Time to Acknowledge (TTA), Action, Assignees, Tags, Comments, Changelog
```

A sample file is included at `./data/issues.sample.csv` (loaded automatically if `issues.csv` is missing). You can also drag-and-drop or use the Upload button in the dashboard header.

## Where to Change Key Logic

| What | File | Location |
|---|---|---|
| Plant mapping (1=Addison, etc.) | `src/data/parser.ts` | `getPlant()` function |
| Changeover tag matching | `src/data/parser.ts` | `CHANGEOVER_TAG` constant |
| Color change vs label/foam logic | `src/data/parser.ts` | `isColorChange()` function |
| Default threshold (45 min) | `src/App.tsx` | `getDefaultFilters()` function |
| PostHog key & settings | `src/analytics/posthog.ts` | `DEFAULT_KEY` constant |
| Password & session duration | `src/auth/AuthGate.tsx` | `EXPECTED_PASSWORD` and `EXPIRY_MS` |

## Netlify Deployment

### One-time setup

```bash
# Install Netlify CLI globally (skip if already installed)
npm install -g netlify-cli

# Authenticate
netlify login

# Link this repo to a Netlify site (creates .netlify/ locally — do not commit)
netlify init
```

### Set environment variables

```bash
# HTTP Basic Auth credentials (enforced at the edge, before any asset loads)
netlify env:set BASIC_AUTH_USER "blackhawk" --scope production
netlify env:set BASIC_AUTH_PASS "your-strong-password-here" --scope production

# In-app password gate (client-side, secondary layer)
netlify env:set VITE_PASSWORD "your-strong-password-here" --scope production

# PostHog — key is hardcoded as fallback in src/analytics/posthog.ts
# Only needed if you want to override it without touching source code:
# netlify env:set VITE_POSTHOG_KEY "phc_QIgbD8nFuxMwPrURQbXJxKqI1uEwrmWrnorrr5v1oto" --scope production
```

### Deploy

```bash
# Preview deploy (get a draft URL to test before going live)
netlify deploy --build

# Production deploy
netlify deploy --build --prod
```

### How the auth layers work

| Layer | Where enforced | Bypass risk |
|---|---|---|
| **HTTP Basic Auth** | Netlify edge function (server-side) | None — no assets load without credentials |
| **In-app password gate** | React client (`AuthGate.tsx`) | Easy to bypass with JS tools — secondary only |

The edge function (`netlify/edge-functions/basic-auth.ts`) reads `BASIC_AUTH_USER` and `BASIC_AUTH_PASS` from Netlify's environment. If either is unset, the site returns `503` and is fully inaccessible.

---

## Customer Link Security Checklist

Run through this checklist every time a customer-accessible link is shared.

- [ ] **Add to Forward Deployed Tracker** — post entry in the Slack workflow before sharing the link
- [ ] **Run security review** — paste the live URL into the security review tool and post results in `#security`
  - Security review link: `<PASTE LINK HERE>`
- [ ] **Confirm HTTP Basic Auth works in incognito** — open the Netlify URL in a fresh incognito window; the browser must prompt for username and password _before_ any page content or JS loads
- [ ] **Confirm PostHog events fire in production** — after logging in, open PostHog → Live Events and verify `$pageview` and at least one `filter_changed` event appear within 30 seconds
- [ ] **Rotate credentials after sharing** — use `netlify env:set` to update `BASIC_AUTH_PASS` and `VITE_PASSWORD`, then redeploy

---

## Deployment Checklist

- [ ] **Password protection enabled** - changed from default in `.env`
- [ ] **PostHog events firing** - verify in PostHog dashboard
- [ ] **Add to Forward Deployed Tracker** (Slack workflow)
- [ ] **Security review completed**
  - Security review link: <PASTE LINK HERE>
  - Ping security channel with visibility
- [ ] **Customer expectations set** - fast-moving proof of concept
- [ ] **CSV data file placed** at `./data/issues.csv`
- [ ] **Build succeeds** - `npm run build` passes
