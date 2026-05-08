import type { ColorChangeEvent, DeviceSummary, WeeklyPlantRow, PlantSummary } from '../data/types'
import { formatDate, formatShortDate } from '../utils/dates'

interface Props {
  events: ColorChangeEvent[]
  deviceData: DeviceSummary[]
  plantData: PlantSummary[]
  weeklyPlantData: WeeklyPlantRow[]
  threshold: number
}

function r(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString()
}

function statusDot(p90: number, threshold: number) {
  if (p90 <= threshold) return { dot: '●', color: '#16a34a', label: 'On target' }
  if (p90 <= threshold * 1.25) return { dot: '●', color: '#d97706', label: 'Needs watch' }
  return { dot: '●', color: '#dc2626', label: 'Off target' }
}

export default function NeedsAttention({ events, deviceData, plantData, weeklyPlantData, threshold }: Props) {
  // Plant health summary
  const plantHealth = [...plantData].sort((a, b) => a.avg - b.avg)
  const fastestPlant = plantHealth[0]
  const slowestPlant = plantHealth[plantHealth.length - 1]

  // Highest opportunity: off-target machines sorted by gap above threshold
  const offTarget = deviceData
    .filter(d => d.p90 > threshold)
    .map(d => ({ ...d, gap: d.p90 - threshold }))
    .sort((a, b) => b.gap - a.gap)

  const topOpportunity = offTarget[0]

  // Top 10 slowest events
  const top10 = [...events]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 10)

  // Weekly worst offenders
  const worstOffenders = weeklyPlantData
    .filter(d => d.slowestEvent)
    .map(d => ({
      plant: d.plant,
      week_start: d.week_start,
      device: d.slowestEvent!.device,
      duration: d.slowest,
      start: d.slowestEvent!.start_dt,
    }))
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 15)

  return (
    <section className="mb-8">
      <h2 className="bh-section-title">Plant Manager Snapshot</h2>

      {/* Plant health + opportunity callouts */}
      {plantHealth.length > 0 && (
        <div className="grid sm:grid-cols-3 gap-3 mb-4">
          {/* Fastest plant */}
          {fastestPlant && (
            <div className="bh-card p-4 border-l-4" style={{ borderLeftColor: '#16a34a' }}>
              <div className="text-[0.6rem] font-bold uppercase tracking-wider mb-1" style={{ color: '#16a34a' }}>
                Fastest Plant
              </div>
              <div className="text-lg font-bold" style={{ color: 'var(--color-primary)' }}>
                {fastestPlant.plant}
              </div>
              <div className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
                {r(fastestPlant.avg)} min avg · {fastestPlant.count} changeovers
              </div>
            </div>
          )}

          {/* Slowest plant */}
          {slowestPlant && slowestPlant.plant !== fastestPlant?.plant && (
            <div className="bh-card p-4 border-l-4" style={{ borderLeftColor: '#dc2626' }}>
              <div className="text-[0.6rem] font-bold uppercase tracking-wider mb-1" style={{ color: '#dc2626' }}>
                Slowest Plant
              </div>
              <div className="text-lg font-bold" style={{ color: 'var(--color-primary)' }}>
                {slowestPlant.plant}
              </div>
              <div className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
                {r(slowestPlant.avg)} min avg · P90: {r(slowestPlant.p90)} min
              </div>
            </div>
          )}

          {/* Highest opportunity machine */}
          {topOpportunity ? (
            <div className="bh-card p-4 border-l-4" style={{ borderLeftColor: '#d97706' }}>
              <div className="text-[0.6rem] font-bold uppercase tracking-wider mb-1" style={{ color: '#d97706' }}>
                Highest Opportunity Machine
              </div>
              <div className="text-lg font-bold font-mono" style={{ color: 'var(--color-primary)' }}>
                {topOpportunity.device}
              </div>
              <div className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
                P90: {r(topOpportunity.p90)} min · {r(topOpportunity.gap)} min above target
              </div>
            </div>
          ) : (
            <div className="bh-card p-4 border-l-4" style={{ borderLeftColor: '#16a34a' }}>
              <div className="text-[0.6rem] font-bold uppercase tracking-wider mb-1" style={{ color: '#16a34a' }}>
                Machine Status
              </div>
              <div className="text-lg font-bold" style={{ color: '#16a34a' }}>All On Target</div>
              <div className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
                All machines P90 ≤ {threshold} min
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        {/* Top 10 slowest */}
        <div className="bh-card overflow-hidden">
          <div className="bh-sub-header"><h3>Top 10 Slowest Changeovers</h3></div>
          <div className="overflow-x-auto">
            <table className="bh-table">
              <thead>
                <tr className="text-left">
                  <th>Plant</th>
                  <th>Device</th>
                  <th>Start</th>
                  <th>End</th>
                  <th className="text-right">Duration</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {top10.map((e, i) => (
                  <tr key={i}>
                    <td>{e.plant}</td>
                    <td className="font-mono text-xs">{e.device}</td>
                    <td className="text-xs">{formatDate(e.start_dt)}</td>
                    <td className="text-xs">{formatDate(e.end_dt)}</td>
                    <td className="text-right font-semibold" style={{ color: 'var(--color-danger)' }}>{r(e.duration)}</td>
                    <td className="text-xs">{e.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Off-target machines */}
        <div className="bh-card overflow-hidden">
          <div className="bh-sub-header">
            <h3>Off-Target Machines (P90 &gt; {threshold} min)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="bh-table">
              <thead>
                <tr className="text-left">
                  <th>Device</th>
                  <th>Plant</th>
                  <th className="text-right">P90</th>
                  <th className="text-right">Avg</th>
                  <th className="text-right">Count</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {offTarget.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-6" style={{ color: 'var(--color-muted)' }}>
                      All machines within threshold
                    </td>
                  </tr>
                ) : (
                  offTarget.map(d => {
                    const s = statusDot(d.p90, threshold)
                    return (
                      <tr key={d.device}>
                        <td className="font-mono text-xs font-semibold">{d.device}</td>
                        <td>{d.plant}</td>
                        <td className="text-right font-semibold" style={{ color: 'var(--color-danger)' }}>{r(d.p90)}</td>
                        <td className="text-right">{r(d.avg)}</td>
                        <td className="text-right">{d.count}</td>
                        <td className="text-xs font-semibold" style={{ color: s.color }}>{s.dot} {s.label}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Weekly worst offenders */}
      <div className="bh-card overflow-hidden">
        <div className="bh-sub-header"><h3>Weekly Worst Offenders by Plant</h3></div>
        <div className="overflow-x-auto">
          <table className="bh-table">
            <thead>
              <tr className="text-left">
                <th>Plant</th>
                <th>Week</th>
                <th>Device</th>
                <th className="text-right">Duration (min)</th>
                <th>Start</th>
              </tr>
            </thead>
            <tbody>
              {worstOffenders.map((w, i) => (
                <tr key={i}>
                  <td>{w.plant}</td>
                  <td>{formatShortDate(w.week_start)}</td>
                  <td className="font-mono text-xs">{w.device}</td>
                  <td className="text-right font-semibold" style={{ color: 'var(--color-danger)' }}>{r(w.duration)}</td>
                  <td className="text-xs">{formatDate(w.start)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
