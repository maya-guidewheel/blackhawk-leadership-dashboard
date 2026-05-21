import Papa from 'papaparse'
import type { RawRow, ColorChangeEvent, EnergyRow, DowntimeEvent, OEERecord } from './types'
import { parseTimestamp, getCalendarDate, getWeekStart } from '../utils/dates'

const CHANGEOVER_TAG = 'change-color/foam/label'

function getPlant(device: string): string {
  const first = device.charAt(0)
  switch (first) {
    case '1': return 'Addison'
    case '2': return 'Mayflower'
    case '3': return 'Sparks'
    default: return 'Unknown'
  }
}

function hasChangeoverTag(tags: string): boolean {
  if (!tags) return false
  // Split on commas, semicolons, newlines, and trim
  const parts = tags.split(/[,;\n\r]+/).map(t => t.trim().toLowerCase())
  return parts.some(t => t === CHANGEOVER_TAG)
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
    // Skip if no tags or no changeover tag
    if (!hasChangeoverTag(row.Tags)) continue

    // Accept M (Color Change), K (Roll Change), L (Foam Change) devices
    const device = (row.Devices || '').trim()
    if (!device) continue
    const d = device.toUpperCase()
    if (!d.includes('M') && !d.includes('K') && !d.includes('L')) continue
    const changeoverType = getChangeoverType(device)

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
      changeover_type: changeoverType,
      status: (row.Status || '').trim(),
      calendar_date: getCalendarDate(start_dt),
      week_start: getWeekStart(start_dt),
      tags: (row.Tags || '').trim(),
      comments: (row.Comments || '').trim(),
    })
  }

  return events
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
    const date = parts[1].replace(/"/g, '').trim()
    const kWh = parseFloat(parts[2].replace(/"/g, '').trim())
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
    const is_tagged = !!(tags && tags.trim() !== '')
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

export function parseOEECSV(csvText: string): OEERecord[] {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  })

  const records: OEERecord[] = []

  for (const row of result.data) {
    // Find columns case-insensitively
    const keys = Object.keys(row)
    const getCol = (name: string): string => {
      const k = keys.find(k => k.trim().toLowerCase() === name.toLowerCase())
      return k ? (row[k] || '').trim() : ''
    }

    const machine = getCol('machine') || getCol('Machine')
    const date = getCol('date') || getCol('Date')
    const oeeStr = getCol('oee') || getCol('OEE')

    if (!machine || !date || !oeeStr) continue

    const oee = parseFloat(oeeStr)
    if (isNaN(oee) || oee < 0 || oee > 100) continue

    const availStr = getCol('availability') || getCol('Availability')
    const perfStr = getCol('performance') || getCol('Performance')
    const qualStr = getCol('quality') || getCol('Quality')

    const availability = availStr ? (isNaN(parseFloat(availStr)) ? null : parseFloat(availStr)) : null
    const performance = perfStr ? (isNaN(parseFloat(perfStr)) ? null : parseFloat(perfStr)) : null
    const quality = qualStr ? (isNaN(parseFloat(qualStr)) ? null : parseFloat(qualStr)) : null

    records.push({ machine, date, oee, availability, performance, quality })
  }

  return records
}
