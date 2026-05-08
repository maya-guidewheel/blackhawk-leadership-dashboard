import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { PlantSummary } from '../data/types'
import { formatDate } from '../utils/dates'

interface Props {
  data: PlantSummary[]
  threshold: number
}

function r(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString()
}

function plantStatus(p90: number, threshold: number) {
  if (p90 <= threshold) return { dot: '●', color: '#16a34a' }
  if (p90 <= threshold * 1.25) return { dot: '●', color: '#d97706' }
  return { dot: '●', color: '#dc2626' }
}

export default function PlantComparison({ data, threshold }: Props) {
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
                  const s = plantStatus(d.p90, threshold)
                  return (
                    <tr key={d.plant}>
                      <td>
                        <span className="flex items-center gap-1.5">
                          <span style={{ color: s.color }}>{s.dot}</span>
                          <span className="font-semibold">{d.plant}</span>
                        </span>
                      </td>
                      <td className="text-right">{d.count}</td>
                      <td className="text-right">{r(d.avg)}</td>
                      <td className="text-right">{r(d.median)}</td>
                      <td className="text-right">{r(d.p90)}</td>
                      <td className="text-right">{r(d.total)}</td>
                      <td className="text-xs">
                        {r(d.fastest)} min<br />
                        <span style={{ color: 'var(--color-muted)' }}>
                          {d.fastestEvent?.device} {d.fastestEvent ? formatDate(d.fastestEvent.start_dt) : ''}
                        </span>
                      </td>
                      <td className="text-xs">
                        {r(d.slowest)} min<br />
                        <span style={{ color: 'var(--color-muted)' }}>
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
          <p className="text-[0.65rem] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--color-muted)' }}>
            Avg Duration by Plant (min)
          </p>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData} barCategoryGap="35%">
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e4e9" vertical={false} />
              <XAxis dataKey="plant" tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderColor: '#e2e4e9', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                cursor={{ fill: 'rgba(6,147,227,0.07)' }}
              />
              <Bar dataKey="avg" name="Avg (min)" fill="#0693e3" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  )
}
