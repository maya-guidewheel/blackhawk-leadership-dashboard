import type { OEERecord } from './types'

export interface MonthlyOEERow {
  month: string     // 'YYYY-MM'
  avgOEE: number
  count: number
  machine?: string
  site?: string
}

export interface QuarterlyOEERow {
  quarter: string   // 'YYYY-Qn'
  avgOEE: number
  count: number
  machine?: string
  site?: string
}

export interface MachineDelta {
  machine: string
  site: string
  periodAavg: number
  periodBavg: number
  delta: number
}

export interface PeriodComparisonResult {
  periodA: { label: string; avgOEE: number; count: number }
  periodB: { label: string; avgOEE: number; count: number }
  delta: number
  pctChange: number
  topImproved: MachineDelta[]
  topDeclined: MachineDelta[]
  methodology: 'weighted' | 'simple'
  methodologyNote: string
}

export interface MachineOEESummary {
  machine: string
  site: string
  avgOEE: number
  count: number
  minOEE: number
  maxOEE: number
  latestDate: string
}

function inferSite(machine: string): string {
  const first = machine.charAt(0)
  switch (first) {
    case '1': return 'Addison'
    case '2': return 'Mayflower'
    case '3': return 'Sparks'
    default: return 'Unknown'
  }
}

function filterByDateRange(
  records: OEERecord[],
  dateFrom?: string,
  dateTo?: string
): OEERecord[] {
  return records.filter(r => {
    if (dateFrom && r.date < dateFrom) return false
    if (dateTo && r.date > dateTo) return false
    return true
  })
}

function getQuarter(dateStr: string): string {
  const [year, month] = dateStr.split('-').map(Number)
  const q = Math.ceil(month / 3)
  return `${year}-Q${q}`
}

export function monthlyOEE(
  records: OEERecord[],
  machine?: string,
  site?: string
): MonthlyOEERow[] {
  let filtered = records
  if (machine) filtered = filtered.filter(r => r.machine === machine)
  if (site) filtered = filtered.filter(r => inferSite(r.machine) === site)

  const monthMap = new Map<string, number[]>()
  for (const r of filtered) {
    const month = r.date.slice(0, 7) // YYYY-MM
    const arr = monthMap.get(month) || []
    arr.push(r.oee)
    monthMap.set(month, arr)
  }

  return Array.from(monthMap.entries())
    .map(([month, values]) => ({
      month,
      avgOEE: values.reduce((s, v) => s + v, 0) / values.length,
      count: values.length,
      machine,
      site,
    }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

export function quarterlyOEE(
  records: OEERecord[],
  machine?: string,
  site?: string
): QuarterlyOEERow[] {
  let filtered = records
  if (machine) filtered = filtered.filter(r => r.machine === machine)
  if (site) filtered = filtered.filter(r => inferSite(r.machine) === site)

  const qMap = new Map<string, number[]>()
  for (const r of filtered) {
    const q = getQuarter(r.date)
    const arr = qMap.get(q) || []
    arr.push(r.oee)
    qMap.set(q, arr)
  }

  return Array.from(qMap.entries())
    .map(([quarter, values]) => ({
      quarter,
      avgOEE: values.reduce((s, v) => s + v, 0) / values.length,
      count: values.length,
      machine,
      site,
    }))
    .sort((a, b) => a.quarter.localeCompare(b.quarter))
}

export function periodComparison(
  records: OEERecord[],
  periodA: { from: string; to: string },
  periodB: { from: string; to: string }
): PeriodComparisonResult {
  const recA = filterByDateRange(records, periodA.from, periodA.to)
  const recB = filterByDateRange(records, periodB.from, periodB.to)

  const avgA = recA.length > 0 ? recA.reduce((s, r) => s + r.oee, 0) / recA.length : 0
  const avgB = recB.length > 0 ? recB.reduce((s, r) => s + r.oee, 0) / recB.length : 0

  const delta = avgA - avgB
  const pctChange = avgB > 0 ? (delta / avgB) * 100 : 0

  // Machine-level deltas
  const machinesA = new Map<string, number[]>()
  for (const r of recA) {
    const arr = machinesA.get(r.machine) || []
    arr.push(r.oee)
    machinesA.set(r.machine, arr)
  }
  const machinesB = new Map<string, number[]>()
  for (const r of recB) {
    const arr = machinesB.get(r.machine) || []
    arr.push(r.oee)
    machinesB.set(r.machine, arr)
  }

  const allMachines = new Set([...machinesA.keys(), ...machinesB.keys()])
  const machineDeltaList: MachineDelta[] = []
  for (const machine of allMachines) {
    const aVals = machinesA.get(machine) || []
    const bVals = machinesB.get(machine) || []
    if (aVals.length === 0 || bVals.length === 0) continue
    const aAvg = aVals.reduce((s, v) => s + v, 0) / aVals.length
    const bAvg = bVals.reduce((s, v) => s + v, 0) / bVals.length
    machineDeltaList.push({
      machine,
      site: inferSite(machine),
      periodAavg: aAvg,
      periodBavg: bAvg,
      delta: aAvg - bAvg,
    })
  }

  machineDeltaList.sort((a, b) => b.delta - a.delta)
  const topImproved = machineDeltaList.filter(m => m.delta > 0).slice(0, 5)
  const topDeclined = machineDeltaList.filter(m => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5)

  return {
    periodA: {
      label: `${periodA.from} to ${periodA.to}`,
      avgOEE: avgA,
      count: recA.length,
    },
    periodB: {
      label: `${periodB.from} to ${periodB.to}`,
      avgOEE: avgB,
      count: recB.length,
    },
    delta,
    pctChange,
    topImproved,
    topDeclined,
    methodology: 'simple',
    methodologyNote:
      'Simple average: each daily OEE reading is weighted equally. Weighted OEE would account for runtime behind each reading.',
  }
}

export function oeeByMachine(
  records: OEERecord[],
  dateFrom?: string,
  dateTo?: string
): MachineOEESummary[] {
  const filtered = filterByDateRange(records, dateFrom, dateTo)

  const machineMap = new Map<string, OEERecord[]>()
  for (const r of filtered) {
    const arr = machineMap.get(r.machine) || []
    arr.push(r)
    machineMap.set(r.machine, arr)
  }

  return Array.from(machineMap.entries())
    .map(([machine, recs]) => {
      const oees = recs.map(r => r.oee)
      const dates = recs.map(r => r.date).sort()
      return {
        machine,
        site: inferSite(machine),
        avgOEE: oees.reduce((s, v) => s + v, 0) / oees.length,
        count: oees.length,
        minOEE: Math.min(...oees),
        maxOEE: Math.max(...oees),
        latestDate: dates[dates.length - 1],
      }
    })
    .sort((a, b) => a.machine.localeCompare(b.machine))
}
