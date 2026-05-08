import Papa from 'papaparse'
import type { RawRow, ColorChangeEvent, EnergyRow } from './types'
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
