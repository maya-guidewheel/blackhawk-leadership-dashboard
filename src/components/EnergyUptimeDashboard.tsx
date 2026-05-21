import { useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { EnergyRow, DowntimeEvent } from '../data/types'

interface Props {
  energyRows: EnergyRow[]
  downtimeEvents: DowntimeEvent[]
}

function fmt(n: number, d = 2): string {
  return n.toFixed(d)
}

const cardStyle: React.CSSProperties = {
  background: 'var(--color-card)',
  border: '1px solid var(--color-border)',
  borderRadius: '0.75rem',
  padding: '1.25rem',
}

export default function EnergyUptimeDashboard({ energyRows, downtimeEvents }: Props) {
  const machines = useMemo(
    () => Array.from(new Set(energyRows.map(r => r.machine))).sort(),
    [energyRows]
  )

  const defaultMachine = machines.includes('M3E-18') ? 'M3E-18' : (machines[0] ?? '')
  const [selectedMachine, setSelectedMachine] = useState(defaultMachine)

  // Date range of all energy data
  const dataDateRange = useMemo(() => {
    if (energyRows.length === 0) return { min: '', max: '' }
    const dates = energyRows.map(r => r.date).sort()
    return { min: dates[0], max: dates[dates.length - 1] }
  }, [energyRows])

  // Default before/after periods: split the data range in half
  const [beforeFrom, setBeforeFrom] = useState(() => dataDateRange.min)
  const [beforeTo, setBeforeTo] = useState(() => {
    if (!dataDateRange.min || !dataDateRange.max) return ''
    const from = new Date(dataDateRange.min)
    const to = new Date(dataDateRange.max)
    const mid = new Date((from.getTime() + to.getTime()) / 2)
    return mid.toISOString().slice(0, 10)
  })
  const [afterFrom, setAfterFrom] = useState(() => {
    if (!dataDateRange.min || !dataDateRange.max) return ''
    const from = new Date(dataDateRange.min)
    const to = new Date(dataDateRange.max)
    const mid = new Date((from.getTime() + to.getTime()) / 2)
    const next = new Date(mid)
    next.setDate(next.getDate() + 1)
    return next.toISOString().slice(0, 10)
  })
  const [afterTo, setAfterTo] = useState(() => dataDateRange.max)

  // Compute downtime hours per day for selected machine (or all machines)
  const downtimeByDate = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of downtimeEvents) {
      if (selectedMachine && e.device !== selectedMachine) continue
      const prev = map.get(e.calendar_date) ?? 0
      map.set(e.calendar_date, prev + e.duration / 60) // convert minutes to hours
    }
    return map
  }, [downtimeEvents, selectedMachine])

  // Energy rows for selected machine
  const machineEnergy = useMemo(
    () => energyRows.filter(r => !selectedMachine || r.machine === selectedMachine),
    [energyRows, selectedMachine]
  )

  // Compute metrics for a period
  function computePeriod(from: string, to: string) {
    if (!from || !to) return null
    const rows = machineEnergy.filter(r => r.date >= from && r.date <= to)
    if (rows.length === 0) return null

    const totalKWh = rows.reduce((s, r) => s + r.kWh, 0)
    let runtimeHours = 0
    for (const r of rows) {
      const downtimeH = downtimeByDate.get(r.date) ?? 0
      const runtime = Math.max(0, 24 - downtimeH)
      runtimeHours += runtime
    }
    const kWhPerRuntimeHour = runtimeHours > 0 ? totalKWh / runtimeHours : 0

    return {
      from,
      to,
      days: rows.length,
      totalKWh,
      runtimeHours,
      kWhPerRuntimeHour,
    }
  }

  const beforeMetrics = useMemo(() => computePeriod(beforeFrom, beforeTo), [beforeFrom, beforeTo, machineEnergy, downtimeByDate])
  const afterMetrics = useMemo(() => computePeriod(afterFrom, afterTo), [afterFrom, afterTo, machineEnergy, downtimeByDate])

  const pctChange = useMemo(() => {
    if (!beforeMetrics || !afterMetrics || beforeMetrics.kWhPerRuntimeHour === 0) return null
    return ((afterMetrics.kWhPerRuntimeHour - beforeMetrics.kWhPerRuntimeHour) / beforeMetrics.kWhPerRuntimeHour) * 100
  }, [beforeMetrics, afterMetrics])

  const chartData = useMemo(() => {
    const rows = []
    if (beforeMetrics) {
      rows.push({ period: `Before\n${beforeMetrics.from}`, kWhPerHour: beforeMetrics.kWhPerRuntimeHour })
    }
    if (afterMetrics) {
      rows.push({ period: `After\n${afterMetrics.from}`, kWhPerHour: afterMetrics.kWhPerRuntimeHour })
    }
    return rows
  }, [beforeMetrics, afterMetrics])

  if (energyRows.length === 0) {
    return (
      <div
        className="rounded-xl p-8 text-center"
        style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}
      >
        <p className="text-base font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
          Energy data not loaded in this dashboard
        </p>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          This view is ready for use once approved energy/runtime data is uploaded.
        </p>
        <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>
          Raw energy usage must be normalized by runtime to fairly compare before/after changes.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* ── Disclaimer Banner ─────────────────────────────────────────────── */}
      <div
        className="rounded-lg px-4 py-3 text-sm"
        style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af' }}
      >
        <span className="font-semibold">This tab shows energy usage only.</span>
        {' '}Cost, pricing, and labor rate data are not included.
      </div>

      {/* ── Machine & Period Filters ──────────────────────────────────────── */}
      <div style={cardStyle}>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Machine</label>
            <select
              value={selectedMachine}
              onChange={e => setSelectedMachine(e.target.value)}
              className="text-sm rounded px-3 py-1.5"
              style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            >
              {machines.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div className="flex items-end gap-2">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Before From</label>
              <input type="date" value={beforeFrom} onChange={e => setBeforeFrom(e.target.value)}
                className="text-sm rounded px-3 py-1.5"
                style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Before To</label>
              <input type="date" value={beforeTo} onChange={e => setBeforeTo(e.target.value)}
                className="text-sm rounded px-3 py-1.5"
                style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
          </div>

          <div className="flex items-end gap-2">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>After From</label>
              <input type="date" value={afterFrom} onChange={e => setAfterFrom(e.target.value)}
                className="text-sm rounded px-3 py-1.5"
                style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>After To</label>
              <input type="date" value={afterTo} onChange={e => setAfterTo(e.target.value)}
                className="text-sm rounded px-3 py-1.5"
                style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Pilot Note ────────────────────────────────────────────────────── */}
      <div
        className="rounded-lg px-4 py-3 text-xs"
        style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
      >
        <span className="font-semibold" style={{ color: 'var(--color-text)' }}>Initial focus:</span>
        {' '}M3E-18 / Mold 288 barrel insulation project.
        {beforeFrom && beforeTo && (
          <> Before: {beforeFrom} to {beforeTo}.</>
        )}
        {afterFrom && afterTo && (
          <> After: {afterFrom} to {afterTo}.</>
        )}
      </div>

      {/* ── Metrics Cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {/* Before period */}
        <div style={{ ...cardStyle, borderTop: '3px solid var(--color-muted)' }}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Before — kWh Used</div>
          <div className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            {beforeMetrics ? beforeMetrics.totalKWh.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
          </div>
          {beforeMetrics && <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{beforeMetrics.days} days</div>}
        </div>

        <div style={{ ...cardStyle, borderTop: '3px solid var(--color-muted)' }}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Before — Runtime Hours</div>
          <div className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            {beforeMetrics ? fmt(beforeMetrics.runtimeHours, 0) : '—'}
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>est. from downtime data</div>
        </div>

        <div style={{ ...cardStyle, borderTop: '3px solid var(--color-muted)' }}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Before — kWh/Runtime Hour</div>
          <div className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            {beforeMetrics ? fmt(beforeMetrics.kWhPerRuntimeHour) : '—'}
          </div>
        </div>

        {/* After period */}
        <div style={{ ...cardStyle, borderTop: '3px solid var(--color-accent)' }}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>After — kWh Used</div>
          <div className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            {afterMetrics ? afterMetrics.totalKWh.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
          </div>
          {afterMetrics && <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{afterMetrics.days} days</div>}
        </div>

        <div style={{ ...cardStyle, borderTop: '3px solid var(--color-accent)' }}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>After — Runtime Hours</div>
          <div className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            {afterMetrics ? fmt(afterMetrics.runtimeHours, 0) : '—'}
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>est. from downtime data</div>
        </div>

        <div style={{ ...cardStyle, borderTop: '3px solid var(--color-accent)' }}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>After — kWh/Runtime Hour</div>
          <div className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            {afterMetrics ? fmt(afterMetrics.kWhPerRuntimeHour) : '—'}
          </div>
        </div>
      </div>

      {/* ── Delta Card ────────────────────────────────────────────────────── */}
      {pctChange !== null && (
        <div style={{
          ...cardStyle,
          borderLeft: `4px solid ${pctChange <= 0 ? 'var(--color-accent)' : 'var(--color-danger)'}`,
        }}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Change in kWh/Runtime Hour</div>
          <div className="text-3xl font-bold" style={{ color: pctChange <= 0 ? 'var(--color-accent)' : 'var(--color-danger)' }}>
            {pctChange <= 0 ? '' : '+'}{fmt(pctChange, 1)}%
          </div>
          <div className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            {pctChange <= 0
              ? `Energy efficiency improved — ${fmt(Math.abs(pctChange), 1)}% less energy per runtime hour`
              : `Energy per runtime hour increased ${fmt(pctChange, 1)}% vs before period`}
          </div>
        </div>
      )}

      {/* ── Bar Chart ─────────────────────────────────────────────────────── */}
      {chartData.length > 0 && (
        <div style={cardStyle}>
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>
            kWh per Runtime Hour — Before vs After
          </h2>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="period" tick={{ fontSize: 11, fill: 'var(--color-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--color-muted)' }} />
                <Tooltip
                  contentStyle={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number) => [`${fmt(v)} kWh/hr`, 'kWh per Runtime Hour']}
                />
                <Bar dataKey="kWhPerHour" fill="var(--color-accent)" radius={[4, 4, 0, 0]} name="kWh/Runtime Hour" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Methodology Note ──────────────────────────────────────────────── */}
      <div
        className="rounded-lg px-4 py-3 text-xs"
        style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
      >
        <p>
          <span className="font-semibold" style={{ color: 'var(--color-text)' }}>Methodology:</span>
          {' '}kWh per runtime hour = daily energy / estimated daily runtime.
          Runtime is estimated as 24h minus recorded downtime hours for days where both energy and downtime data are present.
          Days without downtime data are treated as 24h full runtime.
        </p>
      </div>

    </div>
  )
}
