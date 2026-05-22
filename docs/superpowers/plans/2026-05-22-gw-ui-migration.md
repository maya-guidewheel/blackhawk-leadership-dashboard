# Blackhawk Dashboard — Guidewheel UI Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Blackhawk Leadership Dashboard frontend to use the `@safigen/fd-gw-ui` design system — same data, same charts, same calculations, same backend — but consistent with the Guidewheel brand and other FD apps.

**Architecture:**
- **Scope:** Frontend visual restyle only. `server.ts`, SQLite, custom auth, recharts chart *types*, and all `src/data/*` aggregations are untouched.
- **Strategy:** Install `@safigen/fd-gw-ui` + its Tailwind preset. Redefine the existing `bh-*` CSS aliases (`bh-card`, `bh-section-title`, `bh-table`, `bh-btn-ghost`) in terms of GW semantic tokens — this lets one file change update ~80% of the look-and-feel instantly. Then progressively replace inline raw colors / hand-rolled headers / tabs / tiles with GW components (`Card`, `Button`, `Badge`, `Banner`, `Tabs`, `MetricCard`, `PageHeader`).
- **Visual direction:** Drop the dark `#32373c` header in favor of GW's light shell pattern (light `bg-card` header with subtle border, matching `fd-app-starter`). Replace orange `#ff6900` accents with GW's `bg-primary` blue. Chart palette moves to `chart-1..8`.

**Tech Stack:** React 19, Vite 6, TypeScript, Tailwind 3, recharts, `@safigen/fd-gw-ui` (new).

**Out of scope (do not touch):**
- `server.ts`, `src/data/*`, `src/utils/api.ts`, `src/utils/dates.ts`, `src/utils/exports.ts`
- Auth logic in `AuthGate`/`EnergyGate` (only their *visual* shell changes)
- Chart *types* — every `<BarChart>` stays a `<BarChart>`, every `<LineChart>` stays a `<LineChart>`. Only colors / axes / tooltips / containers change.
- `package.json` server-side deps, `Dockerfile`, `railway.toml`, env handling.

---

## Verification cadence

Each stage ends with a Playwright screenshot pass. Dev server runs on `http://localhost:5173` (vite default) via `npm run dev`. Login password is in `.env` (`VITE_PASSWORD`). Take screenshots of: Changeover tab, Tagging tab, OEE tab, Energy vs Uptime tab. Compare against the previous stage's screenshots — no regressions, only improvements.

If the dev server isn't already running, start it in the background with `npm run dev &` and wait for it to bind to a port.

---

## Stage 1 — Foundation: install GW UI and rewire tokens

**Goal:** Single commit that swaps the color/spacing system underneath the entire app. After this, the app renders in Guidewheel colors with no component changes.

### Task 1.1: Install dependencies

**Files:** `package.json`, `package-lock.json`

- [ ] **Step 1:** Verify `~/.npmrc` has the `@safigen` GitHub Packages token (gw-setup step 5). If missing, surface to user and stop.

Run: `grep -q "npm.pkg.github.com/:_authToken" ~/.npmrc && echo OK || echo MISSING`
Expected: `OK`

- [ ] **Step 2:** Install the package at the version used by `fd-app-starter`:

```bash
npm install --save @safigen/fd-gw-ui@0.1.0
```

- [ ] **Step 3:** Verify install:

```bash
ls node_modules/@safigen/fd-gw-ui/dist/tailwind.preset.js
```
Expected: file exists.

- [ ] **Step 4:** Commit:

```bash
git add package.json package-lock.json
git commit -m "add @safigen/fd-gw-ui dependency"
```

### Task 1.2: Switch Tailwind config to GW preset

**Files:** `tailwind.config.js`

- [ ] **Step 1:** Replace `tailwind.config.js` entirely with:

```js
/** @type {import('tailwindcss').Config} */
import guidewheelPreset from './node_modules/@safigen/fd-gw-ui/dist/tailwind.preset.js'

export default {
  presets: [guidewheelPreset],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    './node_modules/@safigen/fd-gw-ui/dist/**/*.{js,cjs,mjs}',
  ],
  theme: {
    extend: {
      maxWidth: {
        dashboard: '1300px',
      },
    },
  },
}
```

The previous `bh-*` color extensions are deleted — those legacy classes will be redefined in CSS in Task 1.3, mapping to GW tokens.

- [ ] **Step 2:** Run typecheck to confirm config still parses:

```bash
npm run build 2>&1 | head -40
```
Expected: build proceeds past the tailwind config step (errors in *components* are OK at this stage; we're only checking the config compiles).

If a fatal config error appears, fix it before moving on.

- [ ] **Step 3:** Do not commit yet — Task 1.3 finishes the foundation.

### Task 1.3: Rewire index.css to GW tokens and redefine bh-* aliases

**Files:** `src/index.css`

- [ ] **Step 1:** Replace `src/index.css` with the following. This (a) imports GW token vars + base styles, (b) keeps the `--color-*` legacy vars but points them at GW semantic vars so inline `style={{ color: 'var(--color-muted)' }}` etc. continues to work during the migration, (c) redefines the `bh-*` classes against GW tokens.

```css
@import '@safigen/fd-gw-ui/tokens';
@import '@safigen/fd-gw-ui/styles.css';
@tailwind base;
@tailwind components;
@tailwind utilities;

/* ─── Legacy compatibility aliases ───────────────────────────────────────── */
/* Old code references var(--color-primary), --color-muted, etc. Map these  */
/* to GW semantic vars during the migration. Remove after Stage 7.          */
:root {
  --color-primary:    var(--color-foreground);
  --color-secondary:  var(--chart-1);
  --color-accent:     var(--color-btn-primary);
  --color-background: var(--color-background);
  --color-surface:    var(--color-card);
  --color-text:       var(--color-foreground);
  --color-muted:      var(--color-muted-foreground);
  --color-border:     var(--color-border);
  --color-danger:     var(--color-danger);
  --color-warning:    var(--color-warning);
  --color-success:    var(--color-success);
}

body {
  margin: 0;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
    'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
  background-color: var(--color-background);
  color: var(--color-foreground);
}

/* ─── Card alias (redefined against GW tokens) ───────────────────────────── */
.bh-card {
  background: var(--color-card);
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.04);
}

/* ─── Section heading (redefined: blue accent bar instead of orange) ─────── */
.bh-section-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-foreground);
  letter-spacing: 0;
  display: flex;
  align-items: center;
  gap: 0.625rem;
  margin-bottom: 1rem;
}

.bh-section-title::before {
  content: '';
  display: inline-block;
  width: 3px;
  height: 1em;
  background: var(--color-btn-primary);
  border-radius: 2px;
  flex-shrink: 0;
}

/* ─── Table (redefined against GW tokens, no dark header bg) ─────────────── */
.bh-table {
  width: 100%;
  font-size: 0.8125rem;
  border-collapse: collapse;
}

.bh-table thead th {
  background-color: var(--color-background-accent);
  color: var(--color-muted-foreground);
  font-weight: 600;
  font-size: 0.6875rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.625rem 0.875rem;
  white-space: nowrap;
  position: sticky;
  top: 0;
  z-index: 1;
  border-bottom: 1px solid var(--color-border);
}

.bh-table tbody tr {
  border-bottom: 1px solid var(--color-border-muted);
  transition: background-color 0.1s ease;
}

.bh-table tbody tr:last-child {
  border-bottom: none;
}

.bh-table tbody tr:hover {
  background-color: var(--color-background-accent);
}

.bh-table tbody td {
  padding: 0.625rem 0.875rem;
  color: var(--color-foreground);
  vertical-align: middle;
}

/* ─── Ghost button (redefined against GW btn tokens) ─────────────────────── */
.bh-btn-ghost {
  background-color: var(--color-btn-default);
  color: var(--color-btn-default-foreground);
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  padding: 0.4375rem 0.875rem;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}

.bh-btn-ghost:hover {
  background-color: var(--color-btn-default-accent);
  color: var(--color-btn-default-accent-foreground);
}

/* ─── Sub-card header ───────────────────────────────────────────────────── */
.bh-sub-header {
  padding: 0.625rem 0.875rem;
  border-bottom: 1px solid var(--color-border);
  background-color: var(--color-background-accent);
}

.bh-sub-header h3 {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-muted-foreground);
  margin: 0;
}
```

- [ ] **Step 2:** Start the dev server in the background:

```bash
npm run dev > /tmp/blackhawk-dev.log 2>&1 &
sleep 4
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173
```
Expected: `200`.

- [ ] **Step 3:** Use Playwright to log in and screenshot the Changeover tab:

```
mcp__plugin_playwright_playwright__browser_navigate → http://localhost:5173
[fill password from .env file VITE_PASSWORD]
[click Login]
mcp__plugin_playwright_playwright__browser_take_screenshot → stage1-changeover.png
```

Then capture the other tabs:
```
[click Tagging & Downtime] → screenshot stage1-tagging.png
[click OEE Trends]         → screenshot stage1-oee.png
[click Energy vs Uptime]   → screenshot stage1-energy-uptime.png
```

Expected outcome:
- Background is now off-white (GW `--color-background`), not the old `#f0f2f5`.
- Card text is GW foreground colors. Header still shows dark `#32373c` (that's expected — Stage 2 swaps it).
- Section title bars are blue (GW `btn-primary`), not orange.
- No layout breaks, no missing colors (no `var(--color-X)` rendering as `transparent`).

- [ ] **Step 4:** If anything looks broken, debug before moving on. Check browser console via `browser_console_messages` — Tailwind preset incompatibilities show here.

- [ ] **Step 5:** Commit:

```bash
git add tailwind.config.js src/index.css
git commit -m "wire up @safigen/fd-gw-ui tokens and Tailwind preset"
```

---

## Stage 2 — App shell: header, tabs, upload UI

**Goal:** Replace the dark header bar, hand-rolled tab buttons, the dark upload-button, and the upload feedback banner with GW-aligned UI. This is the most visually noticeable change.

### Task 2.1: Replace header with light GW shell

**Files:** `src/App.tsx:339-420`

- [ ] **Step 1:** Replace the entire `<header>` block (lines 339-420) with:

```tsx
<header className="bg-card border-b border-border">
  {/* Top bar */}
  <div className="max-w-dashboard mx-auto px-6 flex items-center justify-between h-16">
    <div className="flex items-center gap-4">
      <img
        src="/blackhawk_molding_logo.jpg"
        alt="Blackhawk Molding"
        className="h-9 w-auto object-contain"
      />
      <div className="h-7 w-px bg-border" aria-hidden />
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-widest text-subtle-foreground">
          Powered by Guidewheel
        </div>
        <h1 className="text-sm font-semibold text-foreground leading-tight">
          Leadership Dashboard
        </h1>
      </div>
    </div>

    <div className="flex items-center gap-3">
      {lastUpdatedText && (
        <span className="text-xs text-muted-foreground hidden md:inline">
          {lastUpdatedText}
        </span>
      )}
      <label className="inline-flex items-center gap-2 cursor-pointer rounded-md bg-btn-primary text-btn-primary-foreground hover:bg-btn-primary-accent px-3.5 py-1.5 text-sm font-medium transition-colors">
        {uploading ? 'Uploading…' : 'Upload CSV'}
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileUpload}
          disabled={uploading}
          className="hidden"
        />
      </label>
    </div>
  </div>

  {/* Tab bar */}
  <div className="max-w-dashboard mx-auto px-6 flex items-end gap-1 border-t border-border-muted">
    {TABS.map(tab => {
      const isActive = activeTab === tab.id
      return (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none -mb-px ${
            isActive
              ? 'text-foreground border-b-2 border-btn-primary'
              : 'text-muted-foreground border-b-2 border-transparent hover:text-foreground'
          }`}
        >
          {tab.label}
          {tab.badge && (
            <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
              isActive
                ? 'bg-btn-primary/10 text-btn-primary'
                : 'bg-background-accent text-subtle-foreground'
            }`}>
              {tab.badge}
            </span>
          )}
        </button>
      )
    })}
  </div>
</header>
```

Note: the dark `style={{ backgroundColor: 'var(--color-primary)' }}` wrapper is gone. The header is now light. The logo no longer needs a white box around it (it sits naturally on the light bg).

- [ ] **Step 2:** Refresh the browser and re-screenshot:

```
browser_navigate → http://localhost:5173
[ensure logged in]
browser_take_screenshot → stage2-header.png
```

Expected: light header, blue underline on active tab, blue Upload CSV button. Logo visible at natural size.

- [ ] **Step 3:** Check for visual regressions on hover states and tab switching by clicking each tab.

- [ ] **Step 4:** Commit:

```bash
git add src/App.tsx
git commit -m "restyle header and tabs with GW light shell"
```

### Task 2.2: Replace upload feedback banner

**Files:** `src/App.tsx:422-474`

- [ ] **Step 1:** Replace the upload feedback banner block (lines 422-474, the `{uploadFeedback && (...)}` block) with:

```tsx
{uploadFeedback && (
  <div className="max-w-dashboard mx-auto px-4 sm:px-6 mt-3">
    <div
      className={`rounded-md border px-4 py-3 text-sm ${
        uploadFeedback.rowsAdded > 0
          ? 'border-success bg-success/5 text-success'
          : 'border-warning bg-warning/5 text-warning'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="text-foreground">
          <span className="font-semibold">{uploadFeedback.fileName}</span>
          {' — '}
          <span className="font-semibold">
            {uploadFeedback.rowsAdded.toLocaleString()} records added
          </span>
          {uploadFeedback.duplicatesSkipped > 0 && (
            <span className="text-muted-foreground">
              , {uploadFeedback.duplicatesSkipped.toLocaleString()} duplicates skipped
            </span>
          )}
          <span className="ml-2 text-xs text-muted-foreground">
            ({uploadFeedback.type.replace(/_/g, ' ')})
          </span>
        </div>
        <button
          onClick={() => setUploadFeedback(null)}
          className="text-muted-foreground hover:text-foreground text-lg leading-none shrink-0"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
      {uploadFeedback.rowsAdded === 0 && uploadFeedback.type === 'oee' && uploadFeedback.diagnostics && (
        <div className="mt-2 text-xs space-y-1 text-muted-foreground">
          <div><span className="font-semibold text-foreground">Detected format:</span> {uploadFeedback.diagnostics.format} ({uploadFeedback.diagnostics.rowsRead} rows read)</div>
          <div>
            <span className="font-semibold text-foreground">Columns found:</span>{' '}
            {uploadFeedback.diagnostics.headersFound.length > 0
              ? uploadFeedback.diagnostics.headersFound.join(', ')
              : '(none detected)'}
          </div>
          {uploadFeedback.diagnostics.format === 'production' && (
            <div><span className="font-semibold text-foreground">Expected columns:</span> Device, Scheduled Time, OEE</div>
          )}
          {uploadFeedback.diagnostics.format === 'simple' && (
            <div><span className="font-semibold text-foreground">Expected columns:</span> Machine, Date, OEE</div>
          )}
          {uploadFeedback.diagnostics.sampleIssues.length > 0 && (
            <div>
              <span className="font-semibold text-foreground">Parse issues:</span>{' '}
              {uploadFeedback.diagnostics.sampleIssues.join(' · ')}
            </div>
          )}
        </div>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 2:** Also replace the error banner (currently lines 488-492):

```tsx
{error && (
  <div className="mb-4 rounded-md border border-danger bg-danger/5 px-4 py-2 text-sm text-danger">
    {error}
  </div>
)}
```

- [ ] **Step 3:** Trigger an upload to verify the banner renders correctly. If you don't have a CSV handy, briefly set `uploadFeedback` in the React DevTools, or skip if Playwright trigger isn't easy — Stage 7 polish will catch any banner regressions.

- [ ] **Step 4:** Commit:

```bash
git add src/App.tsx
git commit -m "restyle upload feedback banner with GW semantic tokens"
```

---

## Stage 3 — Auth gates

**Goal:** Login screens look like part of the Guidewheel product, not a separate skin.

### Task 3.1: Restyle AuthGate

**Files:** `src/auth/AuthGate.tsx`

- [ ] **Step 1:** Read `src/auth/AuthGate.tsx` end to end before editing — only the JSX changes; auth state machinery (`useEffect`, token persistence, login handler) is untouched.

- [ ] **Step 2:** Replace the rendered login form. The login screen should be a centered card on `bg-background` with:
  - Logo at top (the Blackhawk JPG, ~h-12)
  - "Powered by Guidewheel" small label
  - `<h1 className="text-xl font-semibold text-foreground">Leadership Dashboard</h1>`
  - Single password input — use semantic Tailwind: `<input className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-btn-primary/30" />`
  - Submit button: `<button className="w-full rounded-md bg-btn-primary text-btn-primary-foreground hover:bg-btn-primary-accent px-3 py-2 text-sm font-medium">Sign in</button>`
  - Any error message uses `text-danger`
  - Wrap the form in `<div className="rounded-lg border border-border bg-card p-6 w-full max-w-sm shadow-sm">`
  - Outer wrapper: `<div className="min-h-screen flex items-center justify-center bg-background px-4">`

Keep all the existing state handlers and submit logic. Only the surrounding JSX changes.

- [ ] **Step 3:** Repeat for `src/auth/EnergyGate.tsx` — same shell, but the heading reads "Energy & Cost — Executive Access" and there's a small `<Badge>`-style label that says "Restricted". For the badge use:

```tsx
<span className="inline-flex items-center rounded-full bg-warning/10 text-warning px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
  Restricted
</span>
```

- [ ] **Step 4:** Verify both gates render via Playwright:

```
[clear localStorage/sessionStorage to force re-login]
browser_navigate → http://localhost:5173
browser_take_screenshot → stage3-authgate.png
[log in]
[click Energy & Cost tab]
browser_take_screenshot → stage3-energygate.png
```

- [ ] **Step 5:** Commit:

```bash
git add src/auth/AuthGate.tsx src/auth/EnergyGate.tsx
git commit -m "restyle login gates with GW card shell"
```

---

## Stage 4 — Section titles, cards, tables, buttons (mass restyle via aliases)

**Goal:** Most of this work was already done in Stage 1 by redefining `bh-card`, `bh-section-title`, `bh-table`, `bh-btn-ghost`. This stage cleans up the remaining hand-rolled inline equivalents.

### Task 4.1: Replace inline metric-label styling with semantic Tailwind

The pattern `text-[0.65rem] font-bold uppercase tracking-wider mb-2 leading-tight` with `style={{ color: 'var(--color-muted)' }}` appears in many places (KPICards, PlantComparison chart label, etc.). Standardize via a single utility class.

**Files:** `src/index.css`

- [ ] **Step 1:** Add a `.bh-metric-label` utility at the bottom of `src/index.css`:

```css
/* ─── Metric label (small uppercase eyebrow) ─────────────────────────────── */
.bh-metric-label {
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1.2;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-muted-foreground);
}
```

- [ ] **Step 2:** Find every occurrence of the old pattern and replace:

```bash
grep -rn 'text-\[0\.6[5]\?rem\] font-bold uppercase tracking-wider' src/ | wc -l
```

For each match in `src/components/*.tsx`, replace the className blob with `bh-metric-label` (and drop the inline `style={{ color: 'var(--color-muted)' }}` next to it if present). Files affected (from initial audit): `KPICards.tsx`, `PlantComparison.tsx`, `WeeklyPlantSummary.tsx`, `DeviceDrilldown.tsx`, `NeedsAttention.tsx`, `TrendView.tsx`, `OEETrends.tsx`, `EnergyDashboard.tsx`, `EnergyUptimeDashboard.tsx`, `TaggingDashboard.tsx`.

For each file:
1. Open it.
2. Find every occurrence matching the regex above.
3. Replace the full className blob (the whole `className="..."` value) with `bh-metric-label`.
4. Remove any sibling `style={{ color: 'var(--color-muted)' }}` on the same element.

- [ ] **Step 3:** Take a Playwright screenshot of the Changeover tab to confirm metric labels still read clearly (just in a slightly different shade now):

```
browser_take_screenshot → stage4-changeover.png
```

- [ ] **Step 4:** Commit:

```bash
git add src/index.css src/components/
git commit -m "standardize metric labels with bh-metric-label utility"
```

### Task 4.2: Sweep remaining inline color styles to Tailwind tokens

Find leftover `style={{ color: 'var(--color-muted)' }}`, `style={{ color: 'var(--color-text)' }}`, `style={{ backgroundColor: 'var(--color-background)' }}` and convert to Tailwind classes.

- [ ] **Step 1:** Identify the scope:

```bash
grep -rn "style={{ *color: 'var(--color-" src/components/ src/App.tsx | wc -l
grep -rn "style={{ *backgroundColor: 'var(--color-" src/components/ src/App.tsx | wc -l
```

- [ ] **Step 2:** For each occurrence, replace:

| Pattern | Replacement (add to className) |
|---|---|
| `style={{ color: 'var(--color-muted)' }}` | `text-muted-foreground` |
| `style={{ color: 'var(--color-text)' }}` | `text-foreground` |
| `style={{ color: 'var(--color-primary)' }}` | `text-foreground` (the old dark primary was foreground-like; if it was meant as accent, use `text-btn-primary` instead — judge by context) |
| `style={{ color: 'var(--color-danger)' }}` | `text-danger` |
| `style={{ color: 'var(--color-success)' }}` | `text-success` |
| `style={{ color: 'var(--color-warning)' }}` | `text-warning` |
| `style={{ backgroundColor: 'var(--color-background)' }}` | `bg-background` |
| `style={{ backgroundColor: 'var(--color-surface)' }}` | `bg-card` |
| `style={{ backgroundColor: 'var(--color-primary)' }}` | (was the dark header — should already be gone after Stage 2; remove or replace with `bg-card`) |

Work file-by-file. After each file, glance at the rendered result.

- [ ] **Step 3:** Verify the dev server still renders without console errors and screenshot each tab:

```
browser_take_screenshot → stage4-changeover.png
browser_take_screenshot → stage4-tagging.png
browser_take_screenshot → stage4-oee.png
browser_take_screenshot → stage4-energy-uptime.png
```

- [ ] **Step 4:** Commit:

```bash
git add src/
git commit -m "convert inline var() color styles to semantic Tailwind tokens"
```

---

## Stage 5 — KPI / metric tiles

**Goal:** The KPI cards are the most prominent UI element on the Changeover tab. Give them the GW "metric" look — tight, semantic, with built-in trend coloring.

### Task 5.1: Restyle KPICards with GW MetricCard-style tiles

**Files:** `src/components/KPICards.tsx`

- [ ] **Step 1:** Replace the file with:

```tsx
import type { StatsSummary, ColorChangeEvent } from '../data/types'

interface Props {
  stats: StatsSummary
  threshold: number
  events: ColorChangeEvent[]
}

function fmt(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString()
}

interface Metric {
  label: string
  value: string
  suffix?: string
  tone?: 'success' | 'warning' | 'danger'
}

export default function KPICards({ stats, threshold, events }: Props) {
  const onTargetPct = events.length > 0
    ? Math.round((events.filter(e => e.duration <= threshold).length / events.length) * 100)
    : 0

  const onTargetTone: Metric['tone'] =
    onTargetPct >= 90 ? 'success' : onTargetPct >= 70 ? 'warning' : 'danger'

  const cards: Metric[] = [
    { label: 'Total Changeovers', value: fmt(stats.count) },
    { label: '% On Target', value: `${onTargetPct}%`, tone: onTargetTone },
    { label: 'Average Duration', value: fmt(stats.avg), suffix: 'min' },
    { label: 'Median Duration', value: fmt(stats.median), suffix: 'min' },
    { label: '90th Percentile', value: fmt(stats.p90), suffix: 'min' },
    { label: 'Fastest Event', value: fmt(stats.fastest), suffix: 'min' },
    { label: 'Slowest Event', value: fmt(stats.slowest), suffix: 'min' },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-7">
      {cards.map(c => (
        <div
          key={c.label}
          className="rounded-lg border border-border bg-card p-4 transition-shadow hover:shadow-sm"
        >
          <div className="bh-metric-label mb-2">{c.label}</div>
          <div className="flex items-baseline gap-1">
            <span
              className={`text-2xl font-semibold leading-none ${
                c.tone === 'success' ? 'text-success' :
                c.tone === 'warning' ? 'text-warning' :
                c.tone === 'danger'  ? 'text-danger'  :
                'text-foreground'
              }`}
            >
              {c.value}
            </span>
            {c.suffix && (
              <span className="text-xs font-medium text-muted-foreground">
                {c.suffix}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2:** Screenshot:

```
browser_navigate → http://localhost:5173
[Changeover tab]
browser_take_screenshot → stage5-kpis.png
```

- [ ] **Step 3:** Commit:

```bash
git add src/components/KPICards.tsx
git commit -m "restyle KPI cards with semantic tone tokens"
```

---

## Stage 6 — Recharts visual rebrand

**Goal:** Every chart keeps its type (Bar stays Bar, Line stays Line, Pie stays Pie) but adopts the GW chart palette, grid, axis, and tooltip styles.

### Task 6.1: Define a shared chart styling helper

**Files:** `src/utils/chartTheme.ts` (new)

- [ ] **Step 1:** Create `src/utils/chartTheme.ts`:

```ts
// Shared recharts styling helpers — keep visual conventions in one place
// so every chart in the app stays consistent with the GW palette.

export const chartColors = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
] as const

export function chartColor(index: number): string {
  return chartColors[index % chartColors.length]
}

// Common axis tick style — pass directly to <XAxis tick={...} /> / <YAxis tick={...} />
export const axisTick = {
  fontSize: 11,
  fill: 'var(--chart-axis-label)',
} as const

// Common Tooltip contentStyle
export const tooltipStyle = {
  fontSize: 12,
  background: 'var(--chart-tooltip-bg)',
  border: '1px solid var(--chart-tooltip-border)',
  borderRadius: 6,
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
  color: 'var(--color-foreground)',
} as const

export const tooltipCursorFill = 'var(--color-background-accent)'

export const gridStroke = 'var(--chart-grid-line)'

// Semantic chart colors for OEE-style metric overlays
export const oeeColors = {
  availability: 'var(--oee-availability)',
  performance:  'var(--oee-performance)',
  quality:      'var(--oee-quality)',
  overall:      'var(--oee-overall)',
} as const

// Status tones (used in PlantComparison dots, NeedsAttention badges)
export const statusColors = {
  good: 'var(--color-success)',
  warn: 'var(--color-warning)',
  bad:  'var(--color-danger)',
} as const
```

- [ ] **Step 2:** Commit:

```bash
git add src/utils/chartTheme.ts
git commit -m "add shared chartTheme helper for recharts styling"
```

### Task 6.2: Apply chartTheme to PlantComparison

**Files:** `src/components/PlantComparison.tsx`

- [ ] **Step 1:** Update imports to add `import { axisTick, tooltipStyle, tooltipCursorFill, gridStroke, statusColors, chartColor } from '../utils/chartTheme'`.

- [ ] **Step 2:** Replace the `plantStatus` color hexes with `statusColors`:

```tsx
function plantStatus(p90: number, threshold: number) {
  if (p90 <= threshold) return { dot: '●', color: statusColors.good }
  if (p90 <= threshold * 1.25) return { dot: '●', color: statusColors.warn }
  return { dot: '●', color: statusColors.bad }
}
```

- [ ] **Step 3:** Replace the recharts block (currently lines 88-99) with:

```tsx
<ResponsiveContainer width="100%" height={250}>
  <BarChart data={chartData} barCategoryGap="35%">
    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
    <XAxis dataKey="plant" tick={axisTick} axisLine={false} tickLine={false} />
    <YAxis tick={axisTick} axisLine={false} tickLine={false} />
    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: tooltipCursorFill }} />
    <Bar dataKey="avg" name="Avg (min)" fill={chartColor(0)} radius={[4, 4, 0, 0]} />
  </BarChart>
</ResponsiveContainer>
```

- [ ] **Step 4:** Replace the inline `style={{ color: 'var(--color-muted)' }}` label with `className="bh-metric-label mb-3"`.

- [ ] **Step 5:** Screenshot, verify, commit:

```
browser_take_screenshot → stage6-plant-comparison.png
```

```bash
git add src/components/PlantComparison.tsx
git commit -m "apply chartTheme to PlantComparison"
```

### Task 6.3: Apply chartTheme to the remaining chart-bearing components

For each file below, do the same kind of pass as Task 6.2:
- Import from `../utils/chartTheme`
- Replace hex colors in `fill` / `stroke` / `tick fill` with theme tokens
- Replace `<CartesianGrid stroke="#e2e4e9" ...>` with `stroke={gridStroke}`
- Replace `<XAxis tick={{ fontSize: ..., fill: '#6b7280' }} ...>` with `tick={axisTick}`
- Replace `<Tooltip contentStyle={{ ... }} cursor={{ fill: 'rgba(...)' }} />` with `<Tooltip contentStyle={tooltipStyle} cursor={{ fill: tooltipCursorFill }} />`
- Multi-series charts: walk through `<Bar>` / `<Line>` / `<Area>` / `<Cell>` in source order and assign `fill={chartColor(0)}`, `fill={chartColor(1)}`, etc.
- OEE-specific overlays use `oeeColors.availability` / `.performance` / `.quality` / `.overall`
- Threshold reference lines (`ReferenceLine`) use `stroke="var(--color-danger)"` for "limit" lines and `stroke={gridStroke}` for neutral guides

Do **not** change `<BarChart>` to `<LineChart>` or vice versa. Keep all chart types.

- [ ] **Step 1:** `src/components/NeedsAttention.tsx`

  Read the whole file. Audit which charts/badges use hex colors. Replace per the rules above. Pay special attention to: "needs attention" badge background — should use `bg-danger/10 text-danger` for severe, `bg-warning/10 text-warning` for medium.

  Screenshot Changeover tab after.

  ```bash
  git add src/components/NeedsAttention.tsx
  git commit -m "apply chartTheme + semantic tones to NeedsAttention"
  ```

- [ ] **Step 2:** `src/components/WeeklyPlantSummary.tsx`

  Apply chartTheme. Multi-plant series get `chartColor(0)`, `chartColor(1)`, … in plant order.

  ```bash
  git add src/components/WeeklyPlantSummary.tsx
  git commit -m "apply chartTheme to WeeklyPlantSummary"
  ```

- [ ] **Step 3:** `src/components/DeviceDrilldown.tsx`

  Apply chartTheme. Heatmap cells likely use a per-bucket scale — keep the bucketing logic and just retarget the color stops to `var(--chart-1)` / `var(--chart-3)` / `var(--chart-5)` (light to dark blue) or to `var(--color-success)` → `var(--color-warning)` → `var(--color-danger)` if buckets represent severity (judge by reading the existing code).

  ```bash
  git add src/components/DeviceDrilldown.tsx
  git commit -m "apply chartTheme to DeviceDrilldown"
  ```

- [ ] **Step 4:** `src/components/TrendView.tsx`

  ```bash
  git add src/components/TrendView.tsx
  git commit -m "apply chartTheme to TrendView"
  ```

- [ ] **Step 5:** `src/components/OEETrends.tsx`

  This is the OEE-specific component — use `oeeColors` for availability/performance/quality/overall lines, not the generic chart palette.

  ```bash
  git add src/components/OEETrends.tsx
  git commit -m "apply chartTheme and oeeColors to OEETrends"
  ```

- [ ] **Step 6:** `src/components/TaggingDashboard.tsx` (733 lines — biggest file in the migration)

  This will be the longest single task. Read the file first, identify every chart, every status badge, every metric label. Do the conversions methodically. Commit when done.

  ```bash
  git add src/components/TaggingDashboard.tsx
  git commit -m "apply chartTheme to TaggingDashboard"
  ```

- [ ] **Step 7:** `src/components/EnergyDashboard.tsx` (1070 lines — second biggest)

  Energy charts may have specific connotations (kWh = blue, cost = warning/amber). Use:
  - kWh series → `chartColor(0)` (GW blue)
  - $ cost series → `chartColor(3)` (a contrasting hue from the GW palette)
  - Stay consistent across all charts in this file.

  ```bash
  git add src/components/EnergyDashboard.tsx
  git commit -m "apply chartTheme to EnergyDashboard"
  ```

- [ ] **Step 8:** `src/components/EnergyUptimeDashboard.tsx`

  ```bash
  git add src/components/EnergyUptimeDashboard.tsx
  git commit -m "apply chartTheme to EnergyUptimeDashboard"
  ```

- [ ] **Step 9:** Full Playwright screenshot pass:

```
browser_take_screenshot → stage6-changeover.png
[click Tagging & Downtime]
browser_take_screenshot → stage6-tagging.png
[click OEE Trends]
browser_take_screenshot → stage6-oee.png
[click Energy vs Uptime]
browser_take_screenshot → stage6-energy-uptime.png
[click Energy & Cost, log in if needed]
browser_take_screenshot → stage6-energy.png
```

Expected: every chart now uses GW palette. Grid lines are subtle. Axis labels are muted. Tooltips have rounded GW look.

---

## Stage 7 — Polish, cleanup, final pass

**Goal:** Strip the legacy compatibility layer, sweep for any remaining inline raw colors, polish spacing, capture before/after.

### Task 7.1: Strip leftover legacy aliases

**Files:** `src/index.css`

- [ ] **Step 1:** Search the codebase for any remaining usage of the legacy compatibility vars and inline raw hexes:

```bash
grep -rn "var(--color-text\|var(--color-surface\|var(--color-muted)\|var(--color-primary)\|var(--color-secondary)\|var(--color-accent)\|var(--color-bg\b" src/ | grep -v "src/index.css"
grep -rEn "#([0-9a-fA-F]{6})" src/components/ src/App.tsx src/auth/ | grep -vE "color: 'var\(" | head
```

If usage remains, convert it to the semantic Tailwind equivalent or to `chartTheme` tokens. Do not delete the legacy `:root` block in `index.css` until grep returns no results outside `index.css`.

- [ ] **Step 2:** When grep is clean, remove the legacy `:root { --color-*: ... }` block from `src/index.css` (the entire "Legacy compatibility aliases" section added in Stage 1).

- [ ] **Step 3:** Re-run the same greps to confirm nothing broke (and that we didn't leave dangling references).

- [ ] **Step 4:** Run typecheck and full build:

```bash
npm run build
```
Expected: clean build.

- [ ] **Step 5:** Final screenshot pass:

```
browser_take_screenshot → stage7-changeover.png
browser_take_screenshot → stage7-tagging.png
browser_take_screenshot → stage7-oee.png
browser_take_screenshot → stage7-energy-uptime.png
browser_take_screenshot → stage7-energy.png
```

Eyeball each against the Stage 1 screenshots. The brand transformation should be obvious and the data unchanged.

- [ ] **Step 6:** Commit:

```bash
git add src/index.css src/
git commit -m "remove legacy --color-* aliases after full GW token migration"
```

### Task 7.2: Polish pass with impeccable:polish

- [ ] **Step 1:** Invoke the `impeccable:polish` skill on the migrated UI. Provide the screenshots and ask for alignment / spacing / consistency issues. Apply suggested fixes.

- [ ] **Step 2:** Verify dev server still runs, build still passes, commit any polish changes:

```bash
git add src/
git commit -m "polish pass on GW migration"
```

### Task 7.3: README + done

- [ ] **Step 1:** Add a single line at the top of `README.md` under the project title noting the UI now uses `@safigen/fd-gw-ui` and link to `docs/superpowers/plans/2026-05-22-gw-ui-migration.md`.

- [ ] **Step 2:** Final commit:

```bash
git add README.md
git commit -m "note GW UI migration in README"
```

---

## Self-review checklist (before declaring done)

- [ ] All 5 tabs render with no console errors.
- [ ] Headers are light card-bg, not dark grey.
- [ ] Section title accent bars are blue (GW `btn-primary`), not orange.
- [ ] No hex color literals remain in component files (only in `chartTheme.ts` if any, and even there only as comments).
- [ ] Every chart kept its original chart type (Bar / Line / Pie / etc. — verify by diff against `master`).
- [ ] `server.ts`, `src/data/*`, `src/utils/api.ts`, `src/utils/dates.ts`, `src/utils/exports.ts` are byte-for-byte unchanged.
- [ ] `npm run build` passes.
- [ ] All 7 stages produced commits — the git history reads as a clean, atomic migration.
