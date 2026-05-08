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
