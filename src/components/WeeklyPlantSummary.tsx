import { useState } from 'react'
import type { WeeklyPlantRow, ColorChangeEvent } from '../data/types'
import { formatDate, formatShortDate } from '../utils/dates'
import { trackEvent } from '../analytics/posthog'
import DrilldownPanel from './DrilldownPanel'

interface Props {
  data: WeeklyPlantRow[]
  events: ColorChangeEvent[]
}

function r(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString()
}

export default function WeeklyPlantSummary({ data, events }: Props) {
  const [drilldown, setDrilldown] = useState<{ plant: string; week: string } | null>(null)

  if (data.length === 0) return null

  function openDrilldown(plant: string, week: string) {
    trackEvent('drilldown_plant_week', { plant, week })
    setDrilldown({ plant, week })
  }

  const drilldownEvents = drilldown
    ? events.filter(e => e.plant === drilldown.plant && e.week_start === drilldown.week)
    : []

  // Newest weeks first
  const sorted = [...data].sort(
    (a, b) => b.week_start.localeCompare(a.week_start) || a.plant.localeCompare(b.plant)
  )

  return (
    <section className="mb-8">
      <h2 className="bh-section-title">Weekly Plant Summary</h2>
      <div className="bh-card overflow-hidden">
        {/* Fixed-height scrollable body — sticky thead stays in place */}
        <div className="overflow-x-auto">
          <table className="bh-table">
            <thead>
              <tr className="text-left">
                <th>Week of</th>
                <th>Plant</th>
                <th className="text-right">Count</th>
                <th className="text-right">Avg</th>
                <th className="text-right">P90</th>
                <th className="text-right">Total</th>
                <th>Fastest</th>
                <th>Slowest</th>
              </tr>
            </thead>
          </table>
        </div>
        <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 340 }}>
          <table className="bh-table">
            <tbody>
              {sorted.map((d, i) => (
                <tr
                  key={i}
                  className="cursor-pointer"
                  onClick={() => openDrilldown(d.plant, d.week_start)}
                >
                  <td className="font-medium whitespace-nowrap">{formatShortDate(d.week_start)}</td>
                  <td className="font-semibold">{d.plant}</td>
                  <td className="text-right">{d.count}</td>
                  <td className="text-right">{r(d.avg)}</td>
                  <td className="text-right">{r(d.p90)}</td>
                  <td className="text-right">{r(d.total)}</td>
                  <td className="text-xs">
                    {r(d.fastest)} min<br />
                    <span className="text-muted-foreground">
                      {d.fastestEvent?.device} {d.fastestEvent ? formatDate(d.fastestEvent.start_dt) : ''}
                    </span>
                  </td>
                  <td className="text-xs">
                    {r(d.slowest)} min<br />
                    <span className="text-muted-foreground">
                      {d.slowestEvent?.device} {d.slowestEvent ? formatDate(d.slowestEvent.start_dt) : ''}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs mt-1.5 text-muted-foreground">
        Most recent weeks first · Click a row to see individual events
      </p>

      {drilldown && (
        <DrilldownPanel
          title={`${drilldown.plant} — Week of ${formatShortDate(drilldown.week)}`}
          events={drilldownEvents}
          onClose={() => setDrilldown(null)}
        />
      )}
    </section>
  )
}
