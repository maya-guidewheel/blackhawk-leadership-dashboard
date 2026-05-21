import type { DowntimeEvent } from './types'

export interface SiteTaggingRow {
  site: string
  total: number
  tagged: number
  untagged: number
  compliancePct: number
  totalDuration: number
  untaggedDuration: number
}

export interface MachineTaggingRow {
  machine: string
  site: string
  total: number
  tagged: number
  untagged: number
  compliancePct: number
  totalDuration: number
  untaggedDuration: number
}

export interface ShiftTaggingRow {
  shift: string
  total: number
  tagged: number
  untagged: number
  compliancePct: number
  totalDuration: number
  untaggedDuration: number
}

export interface TaggingComplianceResult {
  totalEvents: number
  taggedEvents: number
  untaggedEvents: number
  compliancePct: number
  totalDuration: number
  taggedDuration: number
  untaggedDuration: number
  durationCompliancePct: number
  targetPct: number
  gapToTarget: number
  bySite: SiteTaggingRow[]
  byMachine: MachineTaggingRow[]
  byShift: ShiftTaggingRow[]
}

export interface SitePlannedRow {
  site: string
  total: number
  planned: number
  plannedPct: number
  totalDuration: number
  plannedDuration: number
}

export interface MachinePlannedRow {
  machine: string
  site: string
  total: number
  planned: number
  plannedPct: number
  totalDuration: number
  plannedDuration: number
}

export interface ShiftPlannedRow {
  shift: string
  total: number
  planned: number
  plannedPct: number
  totalDuration: number
  plannedDuration: number
}

export interface TrendRow {
  date: string
  plannedPct: number
}

export interface PlannedDowntimeResult {
  totalEvents: number
  plannedEvents: number
  plannedDuration: number
  totalDuration: number
  plannedPct: number
  warningThreshold: number
  criticalThreshold: number
  status: 'ok' | 'warning' | 'critical'
  bySite: SitePlannedRow[]
  byMachine: MachinePlannedRow[]
  byShift: ShiftPlannedRow[]
  topMachines: MachinePlannedRow[]
  trend: TrendRow[]
}

export interface ReviewEvent extends DowntimeEvent {
  reasons: string[]
}

export function taggingCompliance(
  events: DowntimeEvent[],
  targetPct = 99.5
): TaggingComplianceResult {
  const totalEvents = events.length
  const taggedEvents = events.filter(e => e.is_tagged).length
  const untaggedEvents = totalEvents - taggedEvents
  const compliancePct = totalEvents > 0 ? (taggedEvents / totalEvents) * 100 : 0

  const totalDuration = events.reduce((s, e) => s + e.duration, 0)
  const taggedDuration = events.filter(e => e.is_tagged).reduce((s, e) => s + e.duration, 0)
  const untaggedDuration = totalDuration - taggedDuration
  const durationCompliancePct = totalDuration > 0 ? (taggedDuration / totalDuration) * 100 : 0

  const gapToTarget = targetPct - compliancePct

  // By site
  const siteMap = new Map<string, DowntimeEvent[]>()
  for (const e of events) {
    const arr = siteMap.get(e.plant) || []
    arr.push(e)
    siteMap.set(e.plant, arr)
  }
  const bySite: SiteTaggingRow[] = Array.from(siteMap.entries()).map(([site, evts]) => {
    const total = evts.length
    const tagged = evts.filter(e => e.is_tagged).length
    const untagged = total - tagged
    const totalDur = evts.reduce((s, e) => s + e.duration, 0)
    const untaggedDur = evts.filter(e => !e.is_tagged).reduce((s, e) => s + e.duration, 0)
    return {
      site,
      total,
      tagged,
      untagged,
      compliancePct: total > 0 ? (tagged / total) * 100 : 0,
      totalDuration: totalDur,
      untaggedDuration: untaggedDur,
    }
  }).sort((a, b) => a.compliancePct - b.compliancePct)

  // By machine
  const machineMap = new Map<string, DowntimeEvent[]>()
  for (const e of events) {
    const arr = machineMap.get(e.device) || []
    arr.push(e)
    machineMap.set(e.device, arr)
  }
  const byMachine: MachineTaggingRow[] = Array.from(machineMap.entries()).map(([machine, evts]) => {
    const total = evts.length
    const tagged = evts.filter(e => e.is_tagged).length
    const untagged = total - tagged
    const totalDur = evts.reduce((s, e) => s + e.duration, 0)
    const untaggedDur = evts.filter(e => !e.is_tagged).reduce((s, e) => s + e.duration, 0)
    return {
      machine,
      site: evts[0].plant,
      total,
      tagged,
      untagged,
      compliancePct: total > 0 ? (tagged / total) * 100 : 0,
      totalDuration: totalDur,
      untaggedDuration: untaggedDur,
    }
  }).sort((a, b) => a.compliancePct - b.compliancePct)

  // By shift
  const shiftMap = new Map<string, DowntimeEvent[]>()
  for (const e of events) {
    const arr = shiftMap.get(e.shift) || []
    arr.push(e)
    shiftMap.set(e.shift, arr)
  }
  const byShift: ShiftTaggingRow[] = Array.from(shiftMap.entries()).map(([shift, evts]) => {
    const total = evts.length
    const tagged = evts.filter(e => e.is_tagged).length
    const untagged = total - tagged
    const totalDur = evts.reduce((s, e) => s + e.duration, 0)
    const untaggedDur = evts.filter(e => !e.is_tagged).reduce((s, e) => s + e.duration, 0)
    return {
      shift,
      total,
      tagged,
      untagged,
      compliancePct: total > 0 ? (tagged / total) * 100 : 0,
      totalDuration: totalDur,
      untaggedDuration: untaggedDur,
    }
  }).sort((a, b) => {
    const order = ['1st Shift', '2nd Shift', '3rd Shift']
    return order.indexOf(a.shift) - order.indexOf(b.shift)
  })

  return {
    totalEvents,
    taggedEvents,
    untaggedEvents,
    compliancePct,
    totalDuration,
    taggedDuration,
    untaggedDuration,
    durationCompliancePct,
    targetPct,
    gapToTarget,
    bySite,
    byMachine,
    byShift,
  }
}

export function plannedDowntimeAnalysis(
  events: DowntimeEvent[],
  warningThreshold = 30,
  criticalThreshold = 50
): PlannedDowntimeResult {
  const totalEvents = events.length
  const plannedEvents = events.filter(e => e.is_planned).length
  const totalDuration = events.reduce((s, e) => s + e.duration, 0)
  const plannedDuration = events.filter(e => e.is_planned).reduce((s, e) => s + e.duration, 0)
  const plannedPct = totalDuration > 0 ? (plannedDuration / totalDuration) * 100 : 0
  const status: 'ok' | 'warning' | 'critical' =
    plannedPct >= criticalThreshold ? 'critical' :
    plannedPct >= warningThreshold ? 'warning' : 'ok'

  // By site
  const siteMap = new Map<string, DowntimeEvent[]>()
  for (const e of events) {
    const arr = siteMap.get(e.plant) || []
    arr.push(e)
    siteMap.set(e.plant, arr)
  }
  const bySite: SitePlannedRow[] = Array.from(siteMap.entries()).map(([site, evts]) => {
    const total = evts.length
    const planned = evts.filter(e => e.is_planned).length
    const totalDur = evts.reduce((s, e) => s + e.duration, 0)
    const plannedDur = evts.filter(e => e.is_planned).reduce((s, e) => s + e.duration, 0)
    return {
      site, total, planned,
      plannedPct: totalDur > 0 ? (plannedDur / totalDur) * 100 : 0,
      totalDuration: totalDur,
      plannedDuration: plannedDur,
    }
  }).sort((a, b) => b.plannedPct - a.plannedPct)

  // By machine
  const machineMap = new Map<string, DowntimeEvent[]>()
  for (const e of events) {
    const arr = machineMap.get(e.device) || []
    arr.push(e)
    machineMap.set(e.device, arr)
  }
  const byMachine: MachinePlannedRow[] = Array.from(machineMap.entries()).map(([machine, evts]) => {
    const total = evts.length
    const planned = evts.filter(e => e.is_planned).length
    const totalDur = evts.reduce((s, e) => s + e.duration, 0)
    const plannedDur = evts.filter(e => e.is_planned).reduce((s, e) => s + e.duration, 0)
    return {
      machine,
      site: evts[0].plant,
      total, planned,
      plannedPct: totalDur > 0 ? (plannedDur / totalDur) * 100 : 0,
      totalDuration: totalDur,
      plannedDuration: plannedDur,
    }
  }).sort((a, b) => b.plannedPct - a.plannedPct)

  // By shift
  const shiftMap = new Map<string, DowntimeEvent[]>()
  for (const e of events) {
    const arr = shiftMap.get(e.shift) || []
    arr.push(e)
    shiftMap.set(e.shift, arr)
  }
  const byShift: ShiftPlannedRow[] = Array.from(shiftMap.entries()).map(([shift, evts]) => {
    const total = evts.length
    const planned = evts.filter(e => e.is_planned).length
    const totalDur = evts.reduce((s, e) => s + e.duration, 0)
    const plannedDur = evts.filter(e => e.is_planned).reduce((s, e) => s + e.duration, 0)
    return {
      shift, total, planned,
      plannedPct: totalDur > 0 ? (plannedDur / totalDur) * 100 : 0,
      totalDuration: totalDur,
      plannedDuration: plannedDur,
    }
  }).sort((a, b) => {
    const order = ['1st Shift', '2nd Shift', '3rd Shift']
    return order.indexOf(a.shift) - order.indexOf(b.shift)
  })

  const topMachines = byMachine.slice(0, 10)

  // Trend by calendar_date
  const dateMap = new Map<string, { total: number; planned: number }>()
  for (const e of events) {
    const rec = dateMap.get(e.calendar_date) || { total: 0, planned: 0 }
    rec.total += e.duration
    if (e.is_planned) rec.planned += e.duration
    dateMap.set(e.calendar_date, rec)
  }
  const trend: TrendRow[] = Array.from(dateMap.entries())
    .map(([date, rec]) => ({
      date,
      plannedPct: rec.total > 0 ? (rec.planned / rec.total) * 100 : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return {
    totalEvents,
    plannedEvents,
    plannedDuration,
    totalDuration,
    plannedPct,
    warningThreshold,
    criticalThreshold,
    status,
    bySite,
    byMachine,
    byShift,
    topMachines,
    trend,
  }
}

export function taggingReviewCandidates(events: DowntimeEvent[]): ReviewEvent[] {
  const results: ReviewEvent[] = []

  for (const e of events) {
    const reasons: string[] = []

    if (e.is_planned && e.duration > 480) {
      reasons.push('Unusually long planned downtime (> 8 hours)')
    }
    if (e.is_planned && e.shift !== '1st Shift') {
      reasons.push(`Planned downtime on off-shift (${e.shift})`)
    }
    if (!e.is_tagged && e.duration > 60) {
      reasons.push('Long untagged event (> 60 minutes)')
    }
    if (e.tags) {
      const tagParts = e.tags.split(/[,;]+/).map(t => t.trim()).filter(Boolean)
      const distinctTags = new Set(tagParts)
      if (distinctTags.size > 2) {
        reasons.push(`Multiple tags (${distinctTags.size}) — may need review`)
      }
    }

    if (reasons.length > 0) {
      results.push({ ...e, reasons })
    }
  }

  return results
}
