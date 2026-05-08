import type { ColorChangeEvent, PlantSummary, DeviceSummary, WeeklyPlantRow, WeeklyDeviceCell } from '../data/types'
import { formatDate } from './dates'

function downloadCSV(filename: string, csvContent: string) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function escapeCsv(val: string | number): string {
  const s = String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function toCsv(headers: string[], rows: (string | number)[][]): string {
  const lines = [headers.map(escapeCsv).join(',')]
  for (const row of rows) {
    lines.push(row.map(escapeCsv).join(','))
  }
  return lines.join('\n')
}

export function exportFilteredEvents(events: ColorChangeEvent[]) {
  const headers = ['Plant', 'Device', 'Start', 'End', 'Duration (min)', 'Status', 'Calendar Date', 'Week Start', 'Tags', 'Comments']
  const rows = events.map(e => [
    e.plant, e.device, formatDate(e.start_dt), formatDate(e.end_dt),
    Math.round(e.duration * 10) / 10, e.status, e.calendar_date, e.week_start, e.tags, e.comments,
  ])
  downloadCSV('filtered_color_changes.csv', toCsv(headers, rows))
}

export function exportPlantSummary(data: PlantSummary[]) {
  const headers = ['Plant', 'Count', 'Avg (min)', 'Median (min)', 'P90 (min)', 'Total (min)', 'Fastest (min)', 'Slowest (min)',
    'Fastest Device', 'Fastest Start', 'Slowest Device', 'Slowest Start']
  const rows = data.map(d => [
    d.plant, d.count, r(d.avg), r(d.median), r(d.p90), r(d.total), r(d.fastest), r(d.slowest),
    d.fastestEvent?.device || '', d.fastestEvent ? formatDate(d.fastestEvent.start_dt) : '',
    d.slowestEvent?.device || '', d.slowestEvent ? formatDate(d.slowestEvent.start_dt) : '',
  ])
  downloadCSV('plant_summary.csv', toCsv(headers, rows))
}

export function exportWeeklyPlantSummary(data: WeeklyPlantRow[]) {
  const headers = ['Plant', 'Week Start', 'Count', 'Avg (min)', 'P90 (min)', 'Fastest (min)', 'Slowest (min)', 'Total (min)',
    'Fastest Device', 'Fastest Start', 'Slowest Device', 'Slowest Start']
  const rows = data.map(d => [
    d.plant, d.week_start, d.count, r(d.avg), r(d.p90), r(d.fastest), r(d.slowest), r(d.total),
    d.fastestEvent?.device || '', d.fastestEvent ? formatDate(d.fastestEvent.start_dt) : '',
    d.slowestEvent?.device || '', d.slowestEvent ? formatDate(d.slowestEvent.start_dt) : '',
  ])
  downloadCSV('plant_weekly_summary.csv', toCsv(headers, rows))
}

export function exportDeviceSummary(data: DeviceSummary[]) {
  const headers = ['Device', 'Plant', 'Count', 'Avg (min)', 'Median (min)', 'P90 (min)', 'Total (min)', 'Fastest (min)', 'Slowest (min)']
  const rows = data.map(d => [
    d.device, d.plant, d.count, r(d.avg), r(d.median), r(d.p90), r(d.total), r(d.fastest), r(d.slowest),
  ])
  downloadCSV('device_summary.csv', toCsv(headers, rows))
}

export function exportDeviceWeeklyMatrix(data: WeeklyDeviceCell[]) {
  const headers = ['Device', 'Week Start', 'Avg (min)', 'Total (min)', 'Count']
  const rows = data.map(d => [d.device, d.week_start, r(d.avg), r(d.total), d.count])
  downloadCSV('device_weekly_matrix.csv', toCsv(headers, rows))
}

function r(n: number): number {
  return Math.round(n * 10) / 10
}
