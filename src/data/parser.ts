import Papa from 'papaparse'
import type { RawRow, ColorChangeEvent, EnergyRow, DowntimeEvent, OEERecord } from './types'
import { parseTimestamp, getCalendarDate, getWeekStart, normalizeDateOnly } from '../utils/dates'
import { classifyChangeover, splitTags } from './changeover'

export interface OEEDiagnostics {
  format: 'production' | 'simple' | 'unknown'
  headersFound: string[]
  rowsRead: number
  sampleIssues: string[]
}

// Diagnostics returned when ingesting a Guidewheel Issues file — surfaced to the
// user so uploads never fail silently and changeover classification is auditable.
export interface IssuesDiagnostics {
  rowsRead: number
  changeoverEvents: number       // rows classified as real changeovers
  excludedNonChangeover: number  // valid downtime rows that are NOT changeovers
  skippedInvalid: number         // rows dropped for bad/missing dates or duration
  topExcludedTags: { tag: string; count: number }[]
  dateMin: string
  dateMax: string
  tagsFound: string[]
  machinesFound: string[]
  plantsFound: string[]
}

// Tag values that are semantically equivalent to "no tag" — these should NOT
// be counted as real tags for compliance purposes.
const UNTAGGED_PLACEHOLDERS = new Set([
  'no tag', 'no tags', 'not tagged', 'untagged', 'n/a', 'none', '-',
  'undefined', 'null', '',
])

function isEffectivelyTagged(tags: string): boolean {
  const trimmed = (tags || '').trim()
  if (!trimmed) return false
  const parts = trimmed.toLowerCase().split(/[,;|]+/).map(t => t.trim())
  return parts.some(t => t.length > 0 && !UNTAGGED_PLACEHOLDERS.has(t))
}

function getPlant(device: string): string {
  const first = device.charAt(0)
  switch (first) {
    case '1': return 'Addison'
    case '2': return 'Mayflower'
    case '3': return 'Sparks'
    default: return 'Unknown'
  }
}

function getChangeoverType(device: string): string {
  // Second char of device ID determines type: M=Color Change, K=Roll Change, L=Foam Change
  // Prioritize M > K > L
  const d = device.toUpperCase()
  if (d.includes('M')) return 'Color Change'
  if (d.includes('K')) return 'Roll Change'
  if (d.includes('L')) return 'Foam Change'
  return 'Color Change'
}

export function parseCSV(csvText: string): ColorChangeEvent[] {
  const result = Papa.parse<RawRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  })

  const events: ColorChangeEvent[] = []

  for (const row of result.data) {
    // CHANGEOVER GATE: include ONLY if the raw tags contain an allowed changeover
    // tag. Classification is purely tag-driven — never inferred from device,
    // duration, or machine status. (Garbage in, garbage out.)
    const classification = classifyChangeover(row.Tags)
    if (!classification.isChangeover) continue

    const device = (row.Devices || '').trim()
    if (!device) continue

    // Skip ongoing events
    const durationStr = (row['Duration (minutes)'] || '').trim()
    if (!durationStr || durationStr.toLowerCase() === 'ongoing') continue

    const duration = parseFloat(durationStr)
    if (isNaN(duration) || duration <= 0 || duration >= 600) continue

    // End must be present
    const endStr = (row.End || '').trim()
    if (!endStr) continue

    const start_dt = parseTimestamp(row.Start)
    const end_dt = parseTimestamp(endStr)
    if (!start_dt || !end_dt) continue

    events.push({
      start_dt,
      end_dt,
      duration,
      device,
      plant: getPlant(device),
      changeover_type: getChangeoverType(device),
      status: (row.Status || '').trim(),
      calendar_date: getCalendarDate(start_dt),
      week_start: getWeekStart(start_dt),
      tags: (row.Tags || '').trim(),
      comments: (row.Comments || '').trim(),
      changeover_match_tag: classification.matchedTag ?? undefined,
    })
  }

  return events
}

// Build an audit summary of a Guidewheel Issues file: how many rows were read,
// how many are real changeovers, how many valid downtime rows were excluded
// (and the most common excluded tags), plus the date/tag/machine/plant coverage.
// Used by the upload path so a file can never "silently fail".
export function summarizeIssues(csvText: string): IssuesDiagnostics {
  const result = Papa.parse<RawRow>(csvText, { header: true, skipEmptyLines: true, dynamicTyping: false })
  let changeoverEvents = 0
  let excludedNonChangeover = 0
  let skippedInvalid = 0
  const excludedTagCounts = new Map<string, number>()
  const tagsFound = new Set<string>()
  const machinesFound = new Set<string>()
  const plantsFound = new Set<string>()
  const dates: string[] = []

  for (const row of result.data) {
    const device = (row.Devices || '').trim()
    const durationStr = (row['Duration (minutes)'] || '').trim()
    const endStr = (row.End || '').trim()
    const start_dt = parseTimestamp(row.Start)
    const duration = parseFloat(durationStr)
    const validRow = Boolean(
      device && durationStr && durationStr.toLowerCase() !== 'ongoing' &&
      !isNaN(duration) && duration > 0 && endStr && start_dt
    )
    if (!validRow) { skippedInvalid++; continue }

    if (device) machinesFound.add(device)
    if (device) plantsFound.add(getPlant(device))
    if (start_dt) dates.push(getCalendarDate(start_dt))
    for (const t of splitTags(row.Tags)) tagsFound.add(t)

    if (classifyChangeover(row.Tags).isChangeover) {
      changeoverEvents++
    } else {
      excludedNonChangeover++
      for (const t of splitTags(row.Tags)) {
        excludedTagCounts.set(t, (excludedTagCounts.get(t) ?? 0) + 1)
      }
    }
  }

  dates.sort()
  const topExcludedTags = Array.from(excludedTagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  return {
    rowsRead: result.data.length,
    changeoverEvents,
    excludedNonChangeover,
    skippedInvalid,
    topExcludedTags,
    dateMin: dates[0] ?? '',
    dateMax: dates[dates.length - 1] ?? '',
    tagsFound: Array.from(tagsFound).sort(),
    machinesFound: Array.from(machinesFound).sort(),
    plantsFound: Array.from(plantsFound).sort(),
  }
}

export function parseEnergyCSV(csvText: string): EnergyRow[] {
  const rows: EnergyRow[] = []
  const lines = csvText.split(/\r?\n/)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const parts = line.split(';')
    if (parts.length < 3) continue
    const machine = parts[0].replace(/"/g, '').trim()
    const rawDate = parts[1].replace(/"/g, '').trim()
    const kWh = parseFloat(parts[2].replace(/"/g, '').trim())
    // Normalize the date to YYYY-MM-DD. Handles ISO, slash, and Excel-serial
    // formats and rejects time-only fractions (e.g. "0.2633") so they never get
    // stored and later rendered as a decimal "date".
    const date = normalizeDateOnly(rawDate)
    if (!machine || !date || isNaN(kWh)) continue
    rows.push({ machine, date, kWh })
  }
  return rows
}

function getShift(dt: Date): string {
  const hour = dt.getHours()
  if (hour >= 6 && hour < 14) return '1st Shift'
  if (hour >= 14 && hour < 22) return '2nd Shift'
  return '3rd Shift'
}

export function parseDowntimeCSV(csvText: string): DowntimeEvent[] {
  const result = Papa.parse<RawRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  })

  const events: DowntimeEvent[] = []

  for (const row of result.data) {
    const device = (row.Devices || '').trim()
    if (!device) continue

    // Skip ongoing events
    const durationStr = (row['Duration (minutes)'] || '').trim()
    if (!durationStr || durationStr.toLowerCase() === 'ongoing') continue

    const duration = parseFloat(durationStr)
    if (isNaN(duration) || duration <= 0 || duration >= 2880) continue

    // End must be present
    const endStr = (row.End || '').trim()
    if (!endStr) continue

    const start_dt = parseTimestamp(row.Start)
    const end_dt = parseTimestamp(endStr)
    if (!start_dt || !end_dt) continue

    const tags = (row.Tags || '').trim()
    const is_tagged = isEffectivelyTagged(tags)
    const is_planned = tags.toLowerCase().includes('planned')

    events.push({
      start_dt,
      end_dt,
      duration,
      device,
      plant: getPlant(device),
      status: (row.Status || '').trim(),
      calendar_date: getCalendarDate(start_dt),
      week_start: getWeekStart(start_dt),
      shift: getShift(start_dt),
      tags,
      is_tagged,
      is_planned,
      comments: (row.Comments || '').trim(),
    })
  }

  return events
}

// Month abbreviation → number mapping for parsing Guidewheel scheduled-time strings
const MONTH_MAP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

// Parse a Guidewheel scheduled-time string like "22 May 00:00-08:00" or
// "21 May 16:00 22 May 00:00" or "2026/05/22 00:00" into a YYYY-MM-DD date string.
function parseScheduledDate(raw: string, year = new Date().getFullYear()): string | null {
  if (!raw) return null
  // Already ISO dash format: "2026-05-22" or "2026-05-22T..."
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)
  // Slash-separated ISO: "2026/05/22" or "2026/05/22 00:00"
  const slashISO = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})/)
  if (slashISO) return `${slashISO[1]}-${slashISO[2]}-${slashISO[3]}`
  // "DD Mon ..." → take first day-month occurrence
  const m = raw.match(/\b(\d{1,2})\s+([A-Za-z]{3,})\b/)
  if (m) {
    const day = parseInt(m[1], 10)
    const monthName = m[2].toLowerCase().slice(0, 3)
    const month = MONTH_MAP[monthName]
    if (month && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }
  return null
}

// Parse OEE value that may be "75.2", "75.2%", or decimal "0.752"
function parseOEEValue(raw: string): number | null {
  if (!raw) return null
  const n = parseFloat(raw.replace('%', '').trim())
  if (isNaN(n)) return null
  // Normalize 0–1 range to 0–100
  if (n > 0 && n <= 1) return n * 100
  if (n >= 0 && n <= 100) return n
  return null
}

// Case-insensitive column lookup with partial-name matching
function makeGetCol(row: Record<string, string>) {
  const keys = Object.keys(row)
  return function getCol(...names: string[]): string {
    for (const name of names) {
      const lname = name.toLowerCase()
      const k = keys.find(k => k.trim().toLowerCase().includes(lname))
      if (k) return (row[k] || '').trim()
    }
    return ''
  }
}

// Detect whether a CSV is a Guidewheel Production export based on its headers
function isProductionFormat(headerRow: Record<string, string>): boolean {
  const headers = Object.keys(headerRow).map(k => k.toLowerCase().trim())
  // Classic Guidewheel production format (semicolon-delimited): Machine + From/To + OEE
  if (
    headers.some(h => h === 'machine' || h === 'device') &&
    headers.some(h => h === 'from') &&
    headers.some(h => h.includes('oee'))
  ) return true
  // Older scheduled-time format
  return (
    headers.some(h => h.includes('scheduled') || h.includes('device')) &&
    headers.some(h => h.includes('production qty') || h.includes('oee'))
  )
}

function parseSimpleOEERows(rows: Record<string, string>[], sampleIssues: string[]): OEERecord[] {
  const records: OEERecord[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const getCol = makeGetCol(row)
    const machine = getCol('machine')
    const date = getCol('date')
    const oeeStr = getCol('oee')
    if (!machine || !date || !oeeStr) {
      if (sampleIssues.length < 3)
        sampleIssues.push(`Row ${i + 2}: missing ${!machine ? '"machine"' : !date ? '"date"' : '"oee"'} column value`)
      continue
    }
    const oee = parseOEEValue(oeeStr)
    if (oee === null) {
      if (sampleIssues.length < 3)
        sampleIssues.push(`Row ${i + 2}: invalid OEE value "${oeeStr}"`)
      continue
    }
    const avail = parseFloat(getCol('availability')) || null
    const perf = parseFloat(getCol('performance')) || null
    const qual = parseFloat(getCol('quality')) || null
    records.push({ machine, date, oee, availability: avail, performance: perf, quality: qual })
  }
  return records
}

function parseProductionRows(rows: Record<string, string>[], sampleIssues: string[]): OEERecord[] {
  const records: OEERecord[] = []
  const year = new Date().getFullYear()
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const getCol = makeGetCol(row)
    const device = getCol('device', 'machine')
    if (!device) {
      if (sampleIssues.length < 3) sampleIssues.push(`Row ${i + 2}: missing device/machine value`)
      continue
    }
    const scheduledTime = getCol('scheduled time', 'scheduled', 'time range', 'from')
    const date = parseScheduledDate(scheduledTime || '', year)
    if (!date) {
      if (sampleIssues.length < 3)
        sampleIssues.push(`Row ${i + 2}: could not parse date from scheduled time "${scheduledTime}"`)
      continue
    }
    const oeeStr = getCol('oee')
    if (!oeeStr) {
      if (sampleIssues.length < 3) sampleIssues.push(`Row ${i + 2}: missing OEE value`)
      continue
    }
    const oee = parseOEEValue(oeeStr)
    if (oee === null) {
      if (sampleIssues.length < 3)
        sampleIssues.push(`Row ${i + 2}: invalid OEE value "${oeeStr}"`)
      continue
    }
    const product = getCol('product', 'sku')
    const batch = getCol('batch')
    const prodQty = getCol('production qty', 'production quantity', 'qty')
    const availStr = getCol('availability')
    const perfStr = getCol('performance')
    const qualStr = getCol('quality')
    const session_key = `${device}|${scheduledTime}|${product}|${batch}|${prodQty}|${oeeStr}`
    records.push({
      machine: device,
      date,
      oee,
      availability: parseOEEValue(availStr),
      performance: parseOEEValue(perfStr),
      quality: parseOEEValue(qualStr),
      session_key,
    })
  }
  return records
}

export function parseOEECSV(csvText: string): { records: OEERecord[]; diagnostics: OEEDiagnostics } {
  // Auto-detect delimiter: semicolon-delimited files (Guidewheel production export) vs CSV
  const firstLine = csvText.replace(/^﻿/, '').split(/\r?\n/)[0] || ''
  const delimiter = (firstLine.match(/;/g) || []).length >= 3 ? ';' : ','
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    delimiter,
  })
  const headersFound = (result.meta.fields || []).map(h => h.trim())
  const rowsRead = result.data.length

  if (rowsRead === 0) {
    return {
      records: [],
      diagnostics: { format: 'unknown', headersFound, rowsRead, sampleIssues: ['No data rows found in CSV'] },
    }
  }

  const sampleIssues: string[] = []
  let format: 'production' | 'simple'
  let records: OEERecord[]

  if (isProductionFormat(result.data[0])) {
    format = 'production'
    records = parseProductionRows(result.data, sampleIssues)
  } else {
    format = 'simple'
    records = parseSimpleOEERows(result.data, sampleIssues)
  }

  return { records, diagnostics: { format, headersFound, rowsRead, sampleIssues } }
}
