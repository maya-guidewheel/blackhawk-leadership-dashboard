import type {
  ColorChangeEvent,
  StatsSummary,
  PlantSummary,
  DeviceSummary,
  WeeklyPlantRow,
  WeeklyDeviceCell,
} from './types'

function computeStats(events: ColorChangeEvent[]): StatsSummary {
  if (events.length === 0) {
    return { count: 0, avg: 0, median: 0, p90: 0, total: 0, fastest: 0, slowest: 0 }
  }
  const durations = events.map(e => e.duration).sort((a, b) => a - b)
  const count = durations.length
  const total = durations.reduce((s, d) => s + d, 0)
  const avg = total / count
  const median = percentile(durations, 0.5)
  const p90 = percentile(durations, 0.9)
  const fastest = durations[0]
  const slowest = durations[count - 1]

  const fastestEvent = events.reduce((a, b) => a.duration <= b.duration ? a : b)
  const slowestEvent = events.reduce((a, b) => a.duration >= b.duration ? a : b)

  return { count, avg, median, p90, total, fastest, slowest, fastestEvent, slowestEvent }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = keyFn(item)
    const arr = map.get(key) || []
    arr.push(item)
    map.set(key, arr)
  }
  return map
}

export function overallStats(events: ColorChangeEvent[]): StatsSummary {
  return computeStats(events)
}

export function plantSummaries(events: ColorChangeEvent[]): PlantSummary[] {
  const grouped = groupBy(events, e => e.plant)
  return Array.from(grouped.entries())
    .map(([plant, evts]) => ({ plant, ...computeStats(evts) }))
    .sort((a, b) => a.plant.localeCompare(b.plant))
}

export function deviceSummaries(events: ColorChangeEvent[]): DeviceSummary[] {
  const grouped = groupBy(events, e => e.device)
  return Array.from(grouped.entries())
    .map(([device, evts]) => ({
      device,
      plant: evts[0].plant,
      changeover_type: evts[0].changeover_type,
      ...computeStats(evts),
    }))
    .sort((a, b) => a.device.localeCompare(b.device))
}

export function weeklyPlantSummaries(events: ColorChangeEvent[]): WeeklyPlantRow[] {
  const grouped = groupBy(events, e => `${e.plant}||${e.week_start}`)
  return Array.from(grouped.entries())
    .map(([key, evts]) => {
      const [plant, week_start] = key.split('||')
      return { plant, week_start, ...computeStats(evts) }
    })
    .sort((a, b) => a.week_start.localeCompare(b.week_start) || a.plant.localeCompare(b.plant))
}

export function weeklyDeviceMatrix(events: ColorChangeEvent[]): WeeklyDeviceCell[] {
  const grouped = groupBy(events, e => `${e.device}||${e.week_start}`)
  return Array.from(grouped.entries())
    .map(([key, evts]) => {
      const [device, week_start] = key.split('||')
      const durations = evts.map(e => e.duration)
      const total = durations.reduce((s, d) => s + d, 0)
      return {
        device,
        week_start,
        avg: total / durations.length,
        total,
        count: durations.length,
      }
    })
    .sort((a, b) => a.device.localeCompare(b.device) || a.week_start.localeCompare(b.week_start))
}

export function weeklyTrend(
  events: ColorChangeEvent[],
  plantFilter?: string
): { week_start: string; avg: number; p90: number; count: number; plant?: string }[] {
  const filtered = plantFilter && plantFilter !== 'All'
    ? events.filter(e => e.plant === plantFilter)
    : events
  const grouped = groupBy(filtered, e => e.week_start)
  return Array.from(grouped.entries())
    .map(([week_start, evts]) => {
      const stats = computeStats(evts)
      return { week_start, avg: stats.avg, p90: stats.p90, count: stats.count }
    })
    .sort((a, b) => a.week_start.localeCompare(b.week_start))
}

export function weeklyTrendByPlant(
  events: ColorChangeEvent[]
): Map<string, { week_start: string; avg: number; p90: number; count: number }[]> {
  const plants = [...new Set(events.map(e => e.plant))].sort()
  const result = new Map<string, { week_start: string; avg: number; p90: number; count: number }[]>()
  for (const plant of plants) {
    result.set(plant, weeklyTrend(events, plant))
  }
  return result
}
