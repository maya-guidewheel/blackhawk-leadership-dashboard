import { useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'
import type { ColorChangeEvent } from '../data/types'
import { weeklyTrend, weeklyTrendByPlant } from '../data/aggregations'
import { formatShortDate } from '../utils/dates'
import { axisTick, tooltipStyle, gridStroke, chartColor } from '../utils/chartTheme'

interface Props {
  events: ColorChangeEvent[]
  threshold?: number
}

export default function TrendView({ events, threshold }: Props) {
  const [mode, setMode] = useState<'all' | 'byPlant'>('all')
  const [showCount, setShowCount] = useState(false)

  if (events.length === 0) return null

  const plants = [...new Set(events.map(e => e.plant))].sort()

  if (mode === 'byPlant') {
    const byPlant = weeklyTrendByPlant(events)
    const weeksSet = new Set<string>()
    byPlant.forEach(rows => rows.forEach(r => weeksSet.add(r.week_start)))
    const weeks = [...weeksSet].sort()

    const chartData = weeks.map(w => {
      const row: Record<string, unknown> = { week: formatShortDate(w) }
      plants.forEach(p => {
        const entry = byPlant.get(p)?.find(r => r.week_start === w)
        row[`${p}_avg`] = entry ? Math.round(entry.avg * 10) / 10 : null
        row[`${p}_p90`] = entry ? Math.round(entry.p90 * 10) / 10 : null
        if (showCount) row[`${p}_count`] = entry?.count ?? null
      })
      return row
    })

    return (
      <section className="mb-8">
        <div className="flex items-center gap-4 mb-3">
          <h2 className="bh-section-title" style={{ marginBottom: 0 }}>Weekly Trends</h2>
          <TrendControls mode={mode} setMode={setMode} showCount={showCount} setShowCount={setShowCount} />
        </div>
        <div className="bh-card p-4">
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
              <XAxis dataKey="week" tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis tick={axisTick} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {threshold && (
                <ReferenceLine
                  y={threshold}
                  stroke="var(--color-warning)"
                  strokeDasharray="5 4"
                  strokeWidth={1.5}
                  label={{ value: `${threshold}m target`, position: 'insideTopRight', fontSize: 10, fill: 'var(--color-warning)' }}
                />
              )}
              {plants.map((p, i) => (
                <Line key={`${p}_avg`} type="monotone" dataKey={`${p}_avg`} name={`${p} Avg`}
                  stroke={chartColor(i)} strokeWidth={2} dot={{ r: 3 }} connectNulls />
              ))}
              {plants.map((p, i) => (
                <Line key={`${p}_p90`} type="monotone" dataKey={`${p}_p90`} name={`${p} P90`}
                  stroke={chartColor(i)} strokeWidth={1.5} strokeDasharray="5 5" dot={false} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    )
  }

  // "All" mode
  const trend = weeklyTrend(events)
  const chartData = trend.map(t => ({
    week: formatShortDate(t.week_start),
    avg: Math.round(t.avg * 10) / 10,
    p90: Math.round(t.p90 * 10) / 10,
    count: t.count,
  }))

  return (
    <section className="mb-8">
      <div className="flex items-center gap-4 mb-3">
        <h2 className="bh-section-title" style={{ marginBottom: 0 }}>Weekly Trends</h2>
        <TrendControls mode={mode} setMode={setMode} showCount={showCount} setShowCount={setShowCount} />
      </div>
      <div className="bh-card p-4">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
            <XAxis dataKey="week" tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis tick={axisTick} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {threshold && (
              <ReferenceLine
                y={threshold}
                stroke="var(--color-warning)"
                strokeDasharray="5 4"
                strokeWidth={1.5}
                label={{ value: `${threshold}m target`, position: 'insideTopRight', fontSize: 10, fill: 'var(--color-warning)' }}
              />
            )}
            <Line type="monotone" dataKey="avg" name="Avg Duration" stroke={chartColor(0)} strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="p90" name="P90 Duration" stroke={chartColor(1)} strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 5" />
            {showCount && (
              <Line type="monotone" dataKey="count" name="Count" stroke={chartColor(2)} strokeWidth={2} dot={{ r: 3 }} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

function TrendControls({ mode, setMode, showCount, setShowCount }: {
  mode: 'all' | 'byPlant'; setMode: (m: 'all' | 'byPlant') => void
  showCount: boolean; setShowCount: (b: boolean) => void
}) {
  const baseBtn = 'px-2.5 py-1 text-xs rounded font-medium transition-colors border'
  const activeCls = 'bg-btn-primary text-btn-primary-foreground border-btn-primary'
  const inactiveCls = 'bg-background-accent text-muted-foreground border-border'

  return (
    <div className="flex gap-2 items-center">
      <button
        onClick={() => setMode('all')}
        className={`${baseBtn} ${mode === 'all' ? activeCls : inactiveCls}`}
      >All Plants</button>
      <button
        onClick={() => setMode('byPlant')}
        className={`${baseBtn} ${mode === 'byPlant' ? activeCls : inactiveCls}`}
      >By Plant</button>
      <label className="flex items-center gap-1 text-xs cursor-pointer text-muted-foreground">
        <input type="checkbox" checked={showCount} onChange={e => setShowCount(e.target.checked)} />
        Count
      </label>
    </div>
  )
}
