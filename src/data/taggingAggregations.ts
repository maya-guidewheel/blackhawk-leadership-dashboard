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
      const tagParts = e.tags.split(/[,;]+/).map(t => t.trim()).filter(t => t.length > 0)
      const tagCounts = new Map<string, number>()
      for (const t of tagParts) {
        const key = t.toLowerCase()
        tagCounts.set(key, (tagCounts.get(key) ?? 0) + 1)
      }
      const doubled = Array.from(tagCounts.entries()).filter(([, n]) => n > 1)
      if (doubled.length > 0) {
        reasons.push(`Double-tagged: "${doubled.map(([t]) => t).join('", "')}" appears multiple times`)
      }
      const distinctTags = new Set(tagParts.map(t => t.toLowerCase()))
      if (distinctTags.size > 2 && doubled.length === 0) {
        reasons.push(`Multiple tags (${distinctTags.size}) — may need review`)
      }
    }

    if (reasons.length > 0) {
      results.push({ ...e, reasons })
    }
  }

  return results
}

export const REVIEW_REASON_CATEGORIES = [
  { key: 'all', label: 'All reasons' },
  { key: 'double-tagged', label: 'Double-tagged issue' },
  { key: 'long-untagged', label: 'Long untagged event' },
  { key: 'planned-offshift', label: 'Planned on off-shift' },
  { key: 'long-planned', label: 'Unusually long planned' },
  { key: 'multiple-tags', label: 'Multiple tags' },
] as const

export function matchesReasonCategory(reasons: string[], category: string): boolean {
  if (category === 'all') return true
  const lower = reasons.map(r => r.toLowerCase())
  if (category === 'double-tagged') return lower.some(r => r.startsWith('double-tagged'))
  if (category === 'long-untagged') return lower.some(r => r.startsWith('long untagged'))
  if (category === 'planned-offshift') return lower.some(r => r.startsWith('planned downtime on off-shift'))
  if (category === 'long-planned') return lower.some(r => r.startsWith('unusually long planned'))
  if (category === 'multiple-tags') return lower.some(r => r.startsWith('multiple tags'))
  return true
}

export interface ReviewHighlight {
  text: string
  pct?: number
}

export function computeReviewHighlights(candidates: ReviewEvent[]): ReviewHighlight[] {
  if (candidates.length < 3) return []
  const highlights: ReviewHighlight[] = []
  const n = candidates.length

  // Top shift
  const shiftCounts = new Map<string, number>()
  for (const e of candidates) shiftCounts.set(e.shift, (shiftCounts.get(e.shift) ?? 0) + 1)
  const topShift = Array.from(shiftCounts.entries()).sort((a, b) => b[1] - a[1])[0]
  if (topShift && topShift[1] / n >= 0.25) {
    highlights.push({ text: `${topShift[0]} accounts for ${Math.round(topShift[1] / n * 100)}% of review candidates.`, pct: topShift[1] / n * 100 })
  }

  // Top plant
  const plantCounts = new Map<string, number>()
  for (const e of candidates) plantCounts.set(e.plant, (plantCounts.get(e.plant) ?? 0) + 1)
  const topPlant = Array.from(plantCounts.entries()).sort((a, b) => b[1] - a[1])[0]
  if (topPlant) {
    highlights.push({ text: `${topPlant[0]} has the most review candidates (${topPlant[1]}, ${Math.round(topPlant[1] / n * 100)}% of total).`, pct: topPlant[1] / n * 100 })
  }

  // Top machine
  const machineCounts = new Map<string, number>()
  for (const e of candidates) machineCounts.set(e.device, (machineCounts.get(e.device) ?? 0) + 1)
  const topMachine = Array.from(machineCounts.entries()).sort((a, b) => b[1] - a[1])[0]
  if (topMachine && topMachine[1] >= 3) {
    highlights.push({ text: `${topMachine[0]} has the highest review volume (${topMachine[1]} events, ${Math.round(topMachine[1] / n * 100)}% of candidates).` })
  }

  // Top reason category
  const reasonCats = new Map<string, number>()
  for (const e of candidates) {
    for (const r of e.reasons) {
      const lower = r.toLowerCase()
      const cat =
        lower.startsWith('double-tagged') ? 'Double-tagged issue' :
        lower.startsWith('long untagged') ? 'Long untagged event' :
        lower.startsWith('planned downtime on off-shift') ? 'Planned on off-shift' :
        lower.startsWith('unusually long planned') ? 'Unusually long planned' :
        lower.startsWith('multiple tags') ? 'Multiple tags' : 'Other'
      reasonCats.set(cat, (reasonCats.get(cat) ?? 0) + 1)
    }
  }
  const topReason = Array.from(reasonCats.entries()).sort((a, b) => b[1] - a[1])[0]
  if (topReason) {
    highlights.push({ text: `"${topReason[0]}" is the most common review reason (${topReason[1]} flags across ${n} candidates).` })
  }

  // Double-tagging concentration
  const doubleTagged = candidates.filter(e => e.reasons.some(r => r.toLowerCase().startsWith('double-tagged')))
  if (doubleTagged.length > 0) {
    const dPlants = new Map<string, number>()
    for (const e of doubleTagged) dPlants.set(e.plant, (dPlants.get(e.plant) ?? 0) + 1)
    const topDP = Array.from(dPlants.entries()).sort((a, b) => b[1] - a[1])[0]
    highlights.push({ text: `${doubleTagged.length} double-tagged event${doubleTagged.length > 1 ? 's' : ''} found across ${dPlants.size} plant${dPlants.size > 1 ? 's' : ''}. Most concentrated at ${topDP[0]} (${topDP[1]}).` })
  }

  // Day-of-week pattern
  const dowCounts = new Map<string, number>()
  for (const e of candidates) {
    if (!e.calendar_date) continue
    const dow = new Date(e.calendar_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })
    dowCounts.set(dow, (dowCounts.get(dow) ?? 0) + 1)
  }
  const topDow = Array.from(dowCounts.entries()).sort((a, b) => b[1] - a[1])[0]
  if (topDow && topDow[1] / n >= 0.20) {
    highlights.push({ text: `${topDow[0]} has the highest review-candidate rate (${topDow[1]} events, ${Math.round(topDow[1] / n * 100)}% of candidates).` })
  }

  return highlights.slice(0, 6)
}
