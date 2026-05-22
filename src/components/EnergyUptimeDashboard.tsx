import { useMemo, useState } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, BarChart
} from 'recharts'
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

const P1_COLOR = '#6366f1'  // indigo for Period 1
const P2_COLOR = 'var(--color-accent)'  // orange for Period 2

export default function EnergyUptimeDashboard({ energyRows, downtimeEvents }: Props) {
  const machines = useMemo(
    () => Array.from(new Set(energyRows.map(r => r.machine))).sort(),
    [energyRows]
  )

  const defaultMachine = machines.includes('M3E-18') ? 'M3E-18' : (machines[0] ?? '')
  const [selectedMachine, setSelectedMachine] = useState(defaultMachine)

  const m3e18Missing = energyRows.length > 0 && !machines.includes('M3E-18')

  // Date range of all energy data
  const dataDateRange = useMemo(() => {
    if (energyRows.length === 0) return { min: '', max: '' }
    const dates = energyRows.map(r => r.date).sort()
    return { min: dates[0], max: dates[dates.length - 1] }
  }, [energyRows])

  // Default periods: split the data range in half
  const [p1From, setP1From] = useState(() => dataDateRange.min)
  const [p1To, setP1To] = useState(() => {
    if (!dataDateRange.min || !dataDateRange.max) return ''
    const from = new Date(dataDateRange.min)
    const to = new Date(dataDateRange.max)
    const mid = new Date((from.getTime() + to.getTime()) / 2)
    return mid.toISOString().slice(0, 10)
  })
  const [p2From, setP2From] = useState(() => {
    if (!dataDateRange.min || !dataDateRange.max) return ''
    const from = new Date(dataDateRange.min)
    const to = new Date(dataDateRange.max)
    const mid = new Date((from.getTime() + to.getTime()) / 2)
    const next = new Date(mid)
    next.setDate(next.getDate() + 1)
    return next.toISOString().slice(0, 10)
  })
  const [p2To, setP2To] = useState(() => dataDateRange.max)

  // Downtime hours per day for selected machine
  const downtimeByDate = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of downtimeEvents) {
      if (selectedMachine && e.device !== selectedMachine) continue
      const prev = map.get(e.calendar_date) ?? 0
      map.set(e.calendar_date, prev + e.duration / 60)
    }
    return map
  }, [downtimeEvents, selectedMachine])

  // Energy rows for selected machine
  const machineEnergy = useMemo(
    () => energyRows.filter(r => !selectedMachine || r.machine === selectedMachine),
    [energyRows, selectedMachine]
  )

  function computePeriod(from: string, to: string) {
    if (!from || !to) return null
    const rows = machineEnergy.filter(r => r.date >= from && r.date <= to)
    if (rows.length === 0) return null
    const totalKWh = rows.reduce((s, r) => s + r.kWh, 0)
    let runtimeHours = 0
    for (const r of rows) {
      const downtimeH = downtimeByDate.get(r.date) ?? 0
      runtimeHours += Math.max(0, 24 - downtimeH)
    }
    const kWhPerRuntimeHour = runtimeHours > 0 ? totalKWh / runtimeHours : 0
    return { from, to, days: rows.length, totalKWh, runtimeHours, kWhPerRuntimeHour }
  }

  const p1Metrics = useMemo(() => computePeriod(p1From, p1To), [p1From, p1To, machineEnergy, downtimeByDate])
  const p2Metrics = useMemo(() => computePeriod(p2From, p2To), [p2From, p2To, machineEnergy, downtimeByDate])

  const pctChange = useMemo(() => {
    if (!p1Metrics || !p2Metrics || p1Metrics.kWhPerRuntimeHour === 0) return null
    return ((p2Metrics.kWhPerRuntimeHour - p1Metrics.kWhPerRuntimeHour) / p1Metrics.kWhPerRuntimeHour) * 100
  }, [p1Metrics, p2Metrics])

  // Summary bar chart (Period 1 vs Period 2 kWh/runtime-hour)
  const summaryChartData = useMemo(() => {
    const rows = []
    if (p1Metrics) rows.push({ period: 'Period 1', kWhPerHour: p1Metrics.kWhPerRuntimeHour })
    if (p2Metrics) rows.push({ period: 'Period 2', kWhPerHour: p2Metrics.kWhPerRuntimeHour })
    return rows
  }, [p1Metrics, p2Metrics])

  // Daily chart data — kWh + runtime hours per day for both periods combined
  const dailyChartData = useMemo(() => {
    const allDates = new Set(machineEnergy.map(r => r.date))
    return Array.from(allDates).sort().map(date => {
      const inP1 = p1From && p1To && date >= p1From && date <= p1To
      const inP2 = p2From && p2To && date >= p2From && date <= p2To
      if (!inP1 && !inP2) return null
      const row = machineEnergy.find(r => r.date === date)
      if (!row) return null
      const downtimeH = downtimeByDate.get(date) ?? 0
      const runtimeH = Math.max(0, 24 - downtimeH)
      const kWhPerHour = runtimeH > 0 ? row.kWh / runtimeH : 0
      return {
        date: date.slice(5), // MM-DD for display
        kWhP1: inP1 ? row.kWh : null,
        kWhP2: inP2 ? row.kWh : null,
        runtimeHours: runtimeH,
        kWhPerHour: kWhPerHour > 0 ? kWhPerHour : null,
      }
    }).filter(Boolean) as { date: string; kWhP1: number | null; kWhP2: number | null; runtimeHours: number; kWhPerHour: number | null }[]
  }, [machineEnergy, p1From, p1To, p2From, p2To, downtimeByDate])

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

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <h2 className="text-base font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
          Energy vs Uptime: Period-over-Period Comparison
        </h2>
        <p className="text-sm mb-3" style={{ color: 'var(--color-muted)' }}>
          Compare energy usage normalized by runtime across two selected periods. This helps evaluate whether energy efficiency changed after an operational change, such as insulation on mold 288 barrels.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs" style={{ color: 'var(--color-muted)' }}>
          <div><span className="font-semibold" style={{ color: 'var(--color-text)' }}>kWh used</span> — total energy consumed in the selected period</div>
          <div><span className="font-semibold" style={{ color: 'var(--color-text)' }}>Runtime hours</span> — estimated machine uptime during the period</div>
          <div><span className="font-semibold" style={{ color: 'var(--color-text)' }}>kWh/runtime hour</span> — normalized energy efficiency metric</div>
          <div><span className="font-semibold" style={{ color: 'var(--color-text)' }}>Change %</span> — Period 2 compared to Period 1</div>
        </div>
      </div>

      {/* ── Disclaimer ────────────────────────────────────────────────────── */}
      <div
        className="rounded-lg px-4 py-3 text-sm"
        style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af' }}
      >
        <span className="font-semibold">This tab shows energy usage only.</span>
        {' '}Cost, pricing, and labor rate data are not included.
      </div>

      {/* ── Machine & Period Filters ──────────────────────────────────────── */}
      <div style={cardStyle}>
        <div className="flex flex-wrap items-start gap-6">

          {/* Machine picker */}
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
            {m3e18Missing && (
              <p className="text-xs mt-1" style={{ color: '#f59e0b' }}>
                M3E-18 / Mold 288 not found in current energy dataset.
              </p>
            )}
          </div>

          {/* Period 1 */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: P1_COLOR }}>
              Period 1
            </div>
            <div className="flex items-end gap-2">
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>From</label>
                <input type="date" value={p1From} onChange={e => setP1From(e.target.value)}
                  className="text-sm rounded px-3 py-1.5"
                  style={{ background: 'var(--color-background)', border: `1px solid ${P1_COLOR}`, color: 'var(--color-text)' }}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>To</label>
                <input type="date" value={p1To} onChange={e => setP1To(e.target.value)}
                  className="text-sm rounded px-3 py-1.5"
                  style={{ background: 'var(--color-background)', border: `1px solid ${P1_COLOR}`, color: 'var(--color-text)' }}
                />
              </div>
            </div>
            {p1Metrics && (
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{p1Metrics.days} days of data</p>
            )}
          </div>

          {/* Period 2 */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: P2_COLOR }}>
              Period 2
            </div>
            <div className="flex items-end gap-2">
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>From</label>
                <input type="date" value={p2From} onChange={e => setP2From(e.target.value)}
                  className="text-sm rounded px-3 py-1.5"
                  style={{ background: 'var(--color-background)', border: `1px solid ${P2_COLOR}`, color: 'var(--color-text)' }}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>To</label>
                <input type="date" value={p2To} onChange={e => setP2To(e.target.value)}
                  className="text-sm rounded px-3 py-1.5"
                  style={{ background: 'var(--color-background)', border: `1px solid ${P2_COLOR}`, color: 'var(--color-text)' }}
                />
              </div>
            </div>
            {p2Metrics && (
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{p2Metrics.days} days of data</p>
            )}
          </div>

        </div>
      </div>

      {/* ── Pilot note ────────────────────────────────────────────────────── */}
      <div
        className="rounded-lg px-4 py-3 text-xs"
        style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
      >
        <span className="font-semibold" style={{ color: 'var(--color-text)' }}>Pilot focus:</span>
        {' '}M3E-18 / Mold 288 barrel insulation project. Use Period 1 and Period 2 to compare energy use before and after the insulation change.
      </div>

      {/* ── Metrics Cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {/* Period 1 */}
        <div style={{ ...cardStyle, borderTop: `3px solid ${P1_COLOR}` }}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: P1_COLOR }}>Period 1 — kWh Used</div>
          <div className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            {p1Metrics ? p1Metrics.totalKWh.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
          </div>
          {p1Metrics && <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{p1Metrics.days} days</div>}
        </div>

        <div style={{ ...cardStyle, borderTop: `3px solid ${P1_COLOR}` }}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: P1_COLOR }}>Period 1 — Runtime Hours</div>
          <div className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            {p1Metrics ? fmt(p1Metrics.runtimeHours, 0) : '—'}
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>est. from downtime data</div>
        </div>

        <div style={{ ...cardStyle, borderTop: `3px solid ${P1_COLOR}` }}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: P1_COLOR }}>Period 1 — kWh/Runtime Hour</div>
          <div className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            {p1Metrics ? fmt(p1Metrics.kWhPerRuntimeHour) : '—'}
          </div>
        </div>

        {/* Period 2 */}
        <div style={{ ...cardStyle, borderTop: `3px solid ${P2_COLOR}` }}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: P2_COLOR }}>Period 2 — kWh Used</div>
          <div className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            {p2Metrics ? p2Metrics.totalKWh.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
          </div>
          {p2Metrics && <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{p2Metrics.days} days</div>}
        </div>

        <div style={{ ...cardStyle, borderTop: `3px solid ${P2_COLOR}` }}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: P2_COLOR }}>Period 2 — Runtime Hours</div>
          <div className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            {p2Metrics ? fmt(p2Metrics.runtimeHours, 0) : '—'}
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>est. from downtime data</div>
        </div>

        <div style={{ ...cardStyle, borderTop: `3px solid ${P2_COLOR}` }}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: P2_COLOR }}>Period 2 — kWh/Runtime Hour</div>
          <div className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            {p2Metrics ? fmt(p2Metrics.kWhPerRuntimeHour) : '—'}
          </div>
        </div>
      </div>

      {/* ── Delta Card ────────────────────────────────────────────────────── */}
      {pctChange !== null && (
        <div style={{
          ...cardStyle,
          borderLeft: `4px solid ${pctChange <= 0 ? 'var(--color-accent)' : 'var(--color-danger)'}`,
        }}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>
            Change in kWh/Runtime Hour (Period 2 vs Period 1)
          </div>
          <div className="text-3xl font-bold" style={{ color: pctChange <= 0 ? 'var(--color-accent)' : 'var(--color-danger)' }}>
            {pctChange <= 0 ? '' : '+'}{fmt(pctChange, 1)}%
          </div>
          <div className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            {pctChange <= 0
              ? `Energy efficiency improved — ${fmt(Math.abs(pctChange), 1)}% less energy per runtime hour in Period 2`
              : `Energy per runtime hour increased ${fmt(pctChange, 1)}% in Period 2 vs Period 1`}
          </div>
        </div>
      )}

      {/* ── Period Summary Bar Chart ───────────────────────────────────────── */}
      {summaryChartData.length > 0 && (
        <div style={cardStyle}>
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>
            kWh per Runtime Hour — Period 1 vs Period 2
          </h2>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summaryChartData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="period" tick={{ fontSize: 11, fill: 'var(--color-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--color-muted)' }} />
                <Tooltip
                  contentStyle={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number) => [`${fmt(v)} kWh/hr`, 'kWh per Runtime Hour']}
                />
                <Bar
                  dataKey="kWhPerHour"
                  name="kWh/Runtime Hour"
                  radius={[4, 4, 0, 0]}
                  fill="var(--color-accent)"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Daily kWh + Runtime Hours Chart ───────────────────────────────── */}
      {dailyChartData.length > 0 && (
        <div style={cardStyle}>
          <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
            Daily kWh Usage vs Runtime Hours
          </h2>
          <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
            Bars show daily kWh by period. Line shows estimated runtime hours (24h − downtime). Use this to see whether higher kWh days are simply because the machine ran more.
          </p>
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dailyChartData} margin={{ top: 4, right: 30, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--color-muted)' }} interval="preserveStartEnd" />
                <YAxis yAxisId="kwh" tick={{ fontSize: 9, fill: 'var(--color-muted)' }} label={{ value: 'kWh', angle: -90, position: 'insideLeft', fontSize: 9, fill: 'var(--color-muted)', dy: 20 }} />
                <YAxis yAxisId="runtime" orientation="right" tick={{ fontSize: 9, fill: 'var(--color-muted)' }} label={{ value: 'Runtime hrs', angle: 90, position: 'insideRight', fontSize: 9, fill: 'var(--color-muted)', dy: -40 }} />
                <Tooltip
                  contentStyle={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: unknown, name: string) => {
                    const n = typeof v === 'number' ? v : null
                    if (n === null) return [null, name]
                    if (name === 'Period 1 kWh' || name === 'Period 2 kWh') return [`${n.toFixed(0)} kWh`, name]
                    if (name === 'Runtime Hours') return [`${n.toFixed(1)} hrs`, name]
                    return [`${n}`, name]
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="kwh" dataKey="kWhP1" name="Period 1 kWh" fill={P1_COLOR} opacity={0.8} radius={[2, 2, 0, 0]} />
                <Bar yAxisId="kwh" dataKey="kWhP2" name="Period 2 kWh" fill={P2_COLOR} opacity={0.8} radius={[2, 2, 0, 0]} />
                <Line yAxisId="runtime" type="monotone" dataKey="runtimeHours" name="Runtime Hours" stroke="#10b981" strokeWidth={2} dot={false} strokeDasharray="4 2" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Methodology Note ──────────────────────────────────────────────── */}
      <div
        className="rounded-lg px-4 py-3 text-xs"
        style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
      >
        <span className="font-semibold" style={{ color: 'var(--color-text)' }}>Methodology:</span>
        {' '}kWh per runtime hour = daily energy ÷ estimated daily runtime.
        Runtime is estimated as 24h minus recorded downtime hours for that day.
        Days without downtime data are treated as 24h full runtime.
        This view shows energy usage only — no cost, pricing, or labor rate data is included.
      </div>

    </div>
  )
}
