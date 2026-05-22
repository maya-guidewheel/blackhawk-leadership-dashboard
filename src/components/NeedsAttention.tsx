import type { ColorChangeEvent, DeviceSummary, WeeklyPlantRow, PlantSummary } from '../data/types'
import { formatDate, formatShortDate, formatDuration } from '../utils/dates'

interface Props {
  events: ColorChangeEvent[]
  deviceData: DeviceSummary[]
  plantData: PlantSummary[]
  weeklyPlantData: WeeklyPlantRow[]
  threshold: number
}

function statusDot(p90: number, threshold: number) {
  if (p90 <= threshold) return { badgeClass: 'bg-success/10 text-success', label: 'On target' }
  if (p90 <= threshold * 1.25) return { badgeClass: 'bg-warning/10 text-warning', label: 'Needs watch' }
  return { badgeClass: 'bg-danger/10 text-danger', label: 'Off target' }
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
            <div className="bh-card p-4 border-l-4 border-l-success">
              <div className="bh-metric-label text-success mb-1">
                Fastest Plant
              </div>
              <div className="text-lg font-bold text-foreground">
                {fastestPlant.plant}
              </div>
              <div className="text-sm mt-0.5 text-muted-foreground">
                {formatDuration(fastestPlant.avg)} avg · {fastestPlant.count} changeovers
              </div>
            </div>
          )}

          {/* Slowest plant */}
          {slowestPlant && slowestPlant.plant !== fastestPlant?.plant && (
            <div className="bh-card p-4 border-l-4 border-l-danger">
              <div className="bh-metric-label text-danger mb-1">
                Slowest Plant
              </div>
              <div className="text-lg font-bold text-foreground">
                {slowestPlant.plant}
              </div>
              <div className="text-sm mt-0.5 text-muted-foreground">
                {formatDuration(slowestPlant.avg)} avg · P90: {formatDuration(slowestPlant.p90)}
              </div>
            </div>
          )}

          {/* Highest opportunity machine */}
          {topOpportunity ? (
            <div className="bh-card p-4 border-l-4 border-l-warning">
              <div className="bh-metric-label text-warning mb-1">
                Highest Opportunity Machine
              </div>
              <div className="text-lg font-bold font-mono text-foreground">
                {topOpportunity.device}
              </div>
              <div className="text-sm mt-0.5 text-muted-foreground">
                P90: {formatDuration(topOpportunity.p90)} · {formatDuration(topOpportunity.gap)} above target
              </div>
            </div>
          ) : (
            <div className="bh-card p-4 border-l-4 border-l-success">
              <div className="bh-metric-label text-success mb-1">
                Machine Status
              </div>
              <div className="text-lg font-bold text-success">All On Target</div>
              <div className="text-sm mt-0.5 text-muted-foreground">
                All machines P90 ≤ {formatDuration(threshold)}
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
                    <td className="text-right font-semibold text-danger">{formatDuration(e.duration)}</td>
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
            <h3>Off-Target Machines (P90 &gt; {formatDuration(threshold)})</h3>
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
                    <td colSpan={6} className="text-center py-6 text-muted-foreground">
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
                        <td className="text-right font-semibold text-danger">{formatDuration(d.p90)}</td>
                        <td className="text-right">{formatDuration(d.avg)}</td>
                        <td className="text-right">{d.count}</td>
                        <td>
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${s.badgeClass}`}>
                            {s.label}
                          </span>
                        </td>
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
                <th className="text-right">Duration</th>
                <th>Start</th>
              </tr>
            </thead>
            <tbody>
              {worstOffenders.map((w, i) => (
                <tr key={i}>
                  <td>{w.plant}</td>
                  <td>{formatShortDate(w.week_start)}</td>
                  <td className="font-mono text-xs">{w.device}</td>
                  <td className="text-right font-semibold text-danger">{formatDuration(w.duration)}</td>
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
