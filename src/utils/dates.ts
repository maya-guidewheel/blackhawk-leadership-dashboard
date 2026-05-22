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
