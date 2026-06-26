import { format, startOfWeek, parse, isValid } from 'date-fns'

export function parseTimestamp(s: string): Date | null {
  if (!s || !s.trim()) return null
  // Handle "2026/02/17 09:25" format
  const cleaned = s.trim().replace(/\//g, '-')
  const dt = new Date(cleaned)
  if (isValid(dt)) return dt
  // Fallback: try date-fns parse
  const dt2 = parse(s.trim(), 'yyyy/MM/dd HH:mm', new Date())
  if (isValid(dt2)) return dt2
  return null
}

export function getCalendarDate(dt: Date): string {
  return format(dt, 'yyyy-MM-dd')
}

// Convert an Excel serial date number to a JS Date (UTC). Excel's epoch is
// 1899-12-30 (accounting for the spurious 1900 leap year). Returns null if the
// value is not a usable serial date (e.g. a time-only fraction < 1).
export function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial < 1) return null
  const ms = Math.round((serial - 25569) * 86400 * 1000) // 25569 = days 1899-12-30→1970-01-01
  const dt = new Date(ms)
  return isValid(dt) ? dt : null
}

// Plausibility window for real Guidewheel data. Anything outside this is
// treated as invalid — this is what blocks the Excel-epoch "Dec 31, 1899" bug
// (a stored "1899-12-31" string, or a tiny Excel serial like 1/2/100 that maps
// to 1899–1900) from ever surfacing as a date.
const MIN_VALID_YEAR = 2000
const MAX_VALID_YEAR = 2100

function withinPlausibleYear(yyyyMmDd: string): boolean {
  const year = parseInt(yyyyMmDd.slice(0, 4), 10)
  return Number.isFinite(year) && year >= MIN_VALID_YEAR && year <= MAX_VALID_YEAR
}

// Normalize any incoming date value to a strict "YYYY-MM-DD" string, or null if
// it cannot be interpreted as a real calendar date. Handles:
//   - ISO with optional time:  "2026-06-18", "2026-06-18T08:18", "2026-06-18 08:18"
//   - slash format:            "2026/06/18", "2026/06/18 08:18"
//   - Excel serial numbers:    "46191"  → a real date
//   - time-only fractions:     "0.2633" → null (NOT a date — must never display)
//   - Excel-epoch garbage:     "1899-12-31", serial "1"/"100" → null (implausible year)
export function normalizeDateOnly(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim()
  if (!s) return null

  let candidate: string | null = null

  // Already ISO date (optionally with time) — take the date portion.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    candidate = `${iso[1]}-${iso[2]}-${iso[3]}`
  } else {
    // Slash-separated date — take the date portion.
    const slash = s.match(/^(\d{4})\/(\d{2})\/(\d{2})/)
    if (slash) {
      candidate = `${slash[1]}-${slash[2]}-${slash[3]}`
    } else if (/^\d+(\.\d+)?$/.test(s)) {
      // Pure number → Excel serial. Fractions < 1 are time-only and rejected.
      const dt = excelSerialToDate(parseFloat(s))
      candidate = dt ? format(dt, 'yyyy-MM-dd') : null
    } else {
      // Last resort: let the Date parser try, but only accept a real date.
      const dt = new Date(s)
      candidate = isValid(dt) ? format(dt, 'yyyy-MM-dd') : null
    }
  }

  // Reject implausible years (Excel epoch / corrupt serials). Real data is 2025+.
  if (candidate && !withinPlausibleYear(candidate)) return null
  return candidate
}

// Render a "YYYY-MM-DD" string as a human-readable date like "Jun 18, 2026".
// Returns "—" for anything that is not a real date (never shows raw decimals).
export function formatDisplayDate(value: string | null | undefined): string {
  const norm = normalizeDateOnly(value ?? null)
  if (!norm) return '—'
  const dt = new Date(norm + 'T00:00:00')
  return isValid(dt) ? format(dt, 'MMM d, yyyy') : '—'
}

// Render a min→max range as "Jun 18, 2026 to Jun 18, 2026" (or "—" if invalid).
export function formatDateRange(min: string | null | undefined, max: string | null | undefined): string {
  const a = formatDisplayDate(min)
  const b = formatDisplayDate(max)
  if (a === '—' && b === '—') return '—'
  return `${a} to ${b}`
}

export type QuickRangeKey = '7d' | '30d' | 'mtd' | 'qtd' | 'ytd' | 'all'

export const QUICK_RANGES: { key: QuickRangeKey; label: string }[] = [
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'mtd', label: 'Month to date' },
  { key: 'qtd', label: 'Quarter to date' },
  { key: 'ytd', label: 'Year to date' },
  { key: 'all', label: 'All data' },
]

// Compute a {from,to} window for a quick-range key, clamped to the available
// data window [dataMin, dataMax] so a picker can never select outside real data.
// Anchored to dataMax (latest valid record), not "today", because data lags.
export function quickRange(
  key: QuickRangeKey,
  dataMin: string,
  dataMax: string,
): { from: string; to: string } {
  if (!dataMin || !dataMax) return { from: dataMin, to: dataMax }
  if (key === 'all') return { from: dataMin, to: dataMax }

  const anchor = new Date(dataMax + 'T00:00:00')
  let from = new Date(anchor)
  if (key === '7d') from.setDate(anchor.getDate() - 6)
  else if (key === '30d') from.setDate(anchor.getDate() - 29)
  else if (key === 'mtd') from = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  else if (key === 'qtd') from = new Date(anchor.getFullYear(), Math.floor(anchor.getMonth() / 3) * 3, 1)
  else if (key === 'ytd') from = new Date(anchor.getFullYear(), 0, 1)

  const fromStr = format(from, 'yyyy-MM-dd')
  // Clamp the start to the earliest available data.
  return { from: fromStr < dataMin ? dataMin : fromStr, to: dataMax }
}

// Parse a server timestamp into a Date. SQLite's datetime('now') returns UTC as
// "YYYY-MM-DD HH:MM:SS" with NO timezone marker, which the JS Date constructor
// would otherwise read as LOCAL time. Treat such bare strings as UTC.
function parseServerTimestamp(s: string): Date | null {
  if (!s) return null
  // Already zoned (Z / ±hh:mm) or full ISO with 'T' → trust as-is.
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) || s.includes('T')) {
    const d = new Date(s)
    return isValid(d) ? d : null
  }
  // Bare "YYYY-MM-DD HH:MM:SS" is UTC — make it explicit.
  const d = new Date(s.replace(' ', 'T') + 'Z')
  return isValid(d) ? d : null
}

// Format a server (UTC) timestamp in the viewer's local timezone, e.g.
// "Jun 22, 2026, 5:09 PM GMT-3". Returns `fallback` for null/unparseable input.
export function formatServerTimestamp(s: string | null | undefined, fallback = 'never'): string {
  if (!s) return fallback
  const d = parseServerTimestamp(s)
  if (!d) return fallback
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  })
}

// Raw UTC string for tooltips, e.g. "2026-06-22 19:57 UTC".
export function formatUtcTooltip(s: string | null | undefined): string {
  const d = parseServerTimestamp(s ?? '')
  if (!d) return ''
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
}

export function getWeekStart(dt: Date): string {
  const monday = startOfWeek(dt, { weekStartsOn: 1 })
  return format(monday, 'yyyy-MM-dd')
}

export function formatDate(dt: Date): string {
  return format(dt, 'yyyy-MM-dd HH:mm')
}

export function formatShortDate(s: string): string {
  // s is "yyyy-MM-dd" — return "MMM dd"
  const dt = new Date(s + 'T00:00:00')
  if (!isValid(dt)) return s
  return format(dt, 'MMM dd')
}

// Format a duration in minutes as "45m", "1h 30m", "8h", "1d 9h 30m" for display.
export function formatDuration(minutes: number): string {
  if (!isFinite(minutes) || minutes < 0) return '–'
  if (minutes < 1) {
    return minutes === 0 ? '0m' : '<1m'
  }
  if (minutes < 60) {
    return minutes < 10
      ? `${Math.round(minutes * 10) / 10}m`
      : `${Math.round(minutes)}m`
  }
  const totalMins = Math.round(minutes)
  const days = Math.floor(totalMins / 1440)
  const hours = Math.floor((totalMins % 1440) / 60)
  const mins = totalMins % 60
  const parts: string[] = []
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  if (mins) parts.push(`${mins}m`)
  return parts.join(' ')
}
