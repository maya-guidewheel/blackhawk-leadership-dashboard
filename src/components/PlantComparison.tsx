import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { PlantSummary } from '../data/types'
import { formatDate, formatDuration } from '../utils/dates'
import { axisTick, tooltipStyle, tooltipCursorFill, gridStroke, chartColor } from '../utils/chartTheme'

interface Props {
  data: PlantSummary[]
  threshold: number
}

export default function PlantComparison({ data }: Props) {
  if (data.length === 0) return null

  const sorted = [...data].sort((a, b) => a.avg - b.avg)
  const chartData = sorted.map(d => ({
    plant: d.plant,
    avg: Math.round(d.avg * 10) / 10,
  }))

  return (
    <section className="mb-8">
      <h2 className="bh-section-title">Plant Comparison</h2>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bh-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="bh-table">
              <thead>
                <tr className="text-left">
                  <th>Plant</th>
                  <th className="text-right">Count</th>
                  <th className="text-right">Avg</th>
                  <th className="text-right">Median</th>
                  <th className="text-right">P90</th>
                  <th className="text-right">Total</th>
                  <th>Fastest</th>
                  <th>Slowest</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(d => {
                  return (
                    <tr key={d.plant}>
                      <td className="font-semibold">{d.plant}</td>
                      <td className="text-right">{d.count}</td>
                      <td className="text-right">{formatDuration(d.avg)}</td>
                      <td className="text-right">{formatDuration(d.median)}</td>
                      <td className="text-right">{formatDuration(d.p90)}</td>
                      <td className="text-right">{formatDuration(d.total)}</td>
                      <td className="text-xs">
                        {formatDuration(d.fastest)}<br />
                        <span className="text-muted-foreground">
                          {d.fastestEvent?.device} {d.fastestEvent ? formatDate(d.fastestEvent.start_dt) : ''}
                        </span>
                      </td>
                      <td className="text-xs">
                        {formatDuration(d.slowest)}<br />
                        <span className="text-muted-foreground">
                          {d.slowestEvent?.device} {d.slowestEvent ? formatDate(d.slowestEvent.start_dt) : ''}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bh-card p-4">
          <p className="bh-metric-label mb-3">
            Avg Duration by Plant (min)
          </p>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData} barCategoryGap="35%">
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
              <XAxis dataKey="plant" tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis tick={axisTick} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={tooltipStyle}
                cursor={{ fill: tooltipCursorFill }}
              />
              <Bar dataKey="avg" name="Avg (min)" fill={chartColor(0)} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  )
}
