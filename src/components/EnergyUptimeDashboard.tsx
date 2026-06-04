import { useMemo, useState, useEffect } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, BarChart
} from 'recharts'
import type { EnergyRow, DowntimeEvent, RuntimeRecord } from '../data/types'
import { axisTick, tooltipStyle, gridStroke, chartColor } from '../utils/chartTheme'

interface Props {
  energyRows: EnergyRow[]
  downtimeEvents: DowntimeEvent[]
  runtimeRecords: RuntimeRecord[]
}

function fmt(n: number, d = 2): string { return n.toFixed(d) }

function getPlant(machine: string): string {
  const p = machine.charAt(0)
  if (p === '1') return 'Addison'
  if (p === '2') return 'Mayflower'
  if (p === '3') return 'Sparks'
  return 'Unknown'
}

const cardCls = 'bg-card border border-border rounded-xl p-5'
const P1_COLOR = chartColor(0)
const P2_COLOR = chartColor(3)

export default function EnergyUptimeDashboard({ energyRows, downtimeEvents, runtimeRecords }: Props) {
  // ── Energy data range ──────────────────────────────────────────────────────
  const energyDateRange = useMemo(() => {
    if (energyRows.length === 0) return { min: '', max: '' }
    const dates = energyRows.map(r => r.date).sort()
    return { min: dates[0], max: dates[dates.length - 1] }
  }, [energyRows])

  // ── Runtime data: aggregate daily runtime hrs per device ──────────────────
  const hasRuntime = runtimeRecords.length > 0
  const runtimeDateRange = useMemo(() => {
    if (!hasRuntime) return { min: '', max: '' }
    const dates = runtimeRecords.map(r => r.date).sort()
    return { min: dates[0], max: dates[dates.length - 1] }
  }, [runtimeRecords, hasRuntime])

  // Map: device → date → total runtime hours (sum across shifts)
  const runtimeByDeviceDate = useMemo(() => {
    const map = new Map<string, Map<string, number>>()
    for (const r of runtimeRecords) {
      if (!map.has(r.device)) map.set(r.device, new Map())
      const inner = map.get(r.device)!
      inner.set(r.date, (inner.get(r.date) ?? 0) + r.runtimeHrs)
    }
    return map
  }, [runtimeRecords])

  // ── Downtime fallback: hours per device per day ───────────────────────────
  const downtimeByDeviceDate = useMemo(() => {
    const map = new Map<string, Map<string, number>>()
    for (const e of downtimeEvents) {
      if (!map.has(e.device)) map.set(e.device, new Map())
      const inner = map.get(e.device)!
      inner.set(e.calendar_date, (inner.get(e.calendar_date) ?? 0) + e.duration / 60)
    }
    return map
  }, [downtimeEvents])

  function getRuntimeHrs(device: string, date: string): number {
    if (hasRuntime) {
      return runtimeByDeviceDate.get(device)?.get(date) ?? 0
    }
    // Fallback: 24h minus downtime
    const dt = downtimeByDeviceDate.get(device)?.get(date) ?? 0
    return Math.max(0, 24 - dt)
  }

  // ── Machine list ───────────────────────────────────────────────────────────
  const machines = useMemo(
    () => Array.from(new Set(energyRows.map(r => r.machine))).sort(),
    [energyRows]
  )

  const defaultMachine = machines.includes('M3E-18') ? 'M3E-18' : (machines[0] ?? '')
  const [selectedMachine, setSelectedMachine] = useState(defaultMachine)

  // Update selected machine when machines list loads
  useEffect(() => {
    if (!selectedMachine && machines.length > 0) {
      setSelectedMachine(machines.includes('M3E-18') ? 'M3E-18' : machines[0])
    }
  }, [machines, selectedMachine])

  // ── Period date states ─────────────────────────────────────────────────────
  const [p1From, setP1From] = useState('')
  const [p1To, setP1To] = useState('')
  const [p2From, setP2From] = useState('')
  const [p2To, setP2To] = useState('')
  const [periodsInitialized, setPeriodsInitialized] = useState(false)

  useEffect(() => {
    if (periodsInitialized || !energyDateRange.min || !energyDateRange.max) return
    const from = new Date(energyDateRange.min)
    const to = new Date(energyDateRange.max)
    const mid = new Date((from.getTime() + to.getTime()) / 2)
    const midStr = mid.toISOString().slice(0, 10)
    const nextDay = new Date(mid); nextDay.setDate(nextDay.getDate() + 1)
    setP1From(energyDateRange.min)
    setP1To(midStr)
    setP2From(nextDay.toISOString().slice(0, 10))
    setP2To(energyDateRange.max)
    setPeriodsInitialized(true)
  }, [energyDateRange, periodsInitialized])

  // ── Per-machine energy rows ────────────────────────────────────────────────
  const machineEnergy = useMemo(
    () => energyRows.filter(r => !selectedMachine || r.machine === selectedMachine),
    [energyRows, selectedMachine]
  )

  // ── Period computation ────────────────────────────────────────────────────
  function computePeriod(rows: EnergyRow[], from: string, to: string) {
    if (!from || !to) return null
    const periodRows = rows.filter(r => r.date >= from && r.date <= to)
    if (periodRows.length === 0) return null
    const totalKWh = periodRows.reduce((s, r) => s + r.kWh, 0)
    let runtimeHours = 0
    for (const r of periodRows) {
      runtimeHours += getRuntimeHrs(r.machine, r.date)
    }
    const kWhPerRuntimeHour = runtimeHours > 0 ? totalKWh / runtimeHours : 0
    const avgUptimePct = runtimeHours / (periodRows.length * 24) * 100
    return { from, to, days: periodRows.length, totalKWh, runtimeHours, kWhPerRuntimeHour, avgUptimePct }
  }

  const p1Metrics = useMemo(
    () => computePeriod(machineEnergy, p1From, p1To),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p1From, p1To, machineEnergy, runtimeByDeviceDate, downtimeByDeviceDate, hasRuntime]
  )
  const p2Metrics = useMemo(
    () => computePeriod(machineEnergy, p2From, p2To),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p2From, p2To, machineEnergy, runtimeByDeviceDate, downtimeByDeviceDate, hasRuntime]
  )

  const pctChange = useMemo(() => {
    if (!p1Metrics || !p2Metrics || p1Metrics.kWhPerRuntimeHour === 0) return null
    return ((p2Metrics.kWhPerRuntimeHour - p1Metrics.kWhPerRuntimeHour) / p1Metrics.kWhPerRuntimeHour) * 100
  }, [p1Metrics, p2Metrics])

  // ── Summary bar chart ─────────────────────────────────────────────────────
  const summaryChartData = useMemo(() => {
    const rows = []
    if (p1Metrics) rows.push({ period: 'Period 1', kWhPerHour: p1Metrics.kWhPerRuntimeHour })
    if (p2Metrics) rows.push({ period: 'Period 2', kWhPerHour: p2Metrics.kWhPerRuntimeHour })
    return rows
  }, [p1Metrics, p2Metrics])

  // ── Daily chart data ──────────────────────────────────────────────────────
  const dailyChartData = useMemo(() => {
    const allDates = new Set(machineEnergy.map(r => r.date))
    return Array.from(allDates).sort().map(date => {
      const inP1 = p1From && p1To && date >= p1From && date <= p1To
      const inP2 = p2From && p2To && date >= p2From && date <= p2To
      if (!inP1 && !inP2) return null
      const row = machineEnergy.find(r => r.date === date)
      if (!row) return null
      const runtimeH = getRuntimeHrs(row.machine, date)
      const kWhPerHour = runtimeH > 0 ? row.kWh / runtimeH : 0
      return {
        date: date.slice(5),
        kWhP1: inP1 ? row.kWh : null,
        kWhP2: inP2 ? row.kWh : null,
        runtimeHours: runtimeH,
        kWhPerHour: kWhPerHour > 0 ? kWhPerHour : null,
      }
    }).filter(Boolean) as { date: string; kWhP1: number | null; kWhP2: number | null; runtimeHours: number; kWhPerHour: number | null }[]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineEnergy, p1From, p1To, p2From, p2To, runtimeByDeviceDate, downtimeByDeviceDate, hasRuntime])

  // ── Fleet-level metrics by machine (all machines, both periods combined) ──
  const machineMetrics = useMemo(() => {
    if (energyRows.length === 0) return []
    const from = p1From || energyDateRange.min
    const to = p2To || energyDateRange.max
    if (!from || !to) return []

    return machines.map(machine => {
      const rows = energyRows.filter(r => r.machine === machine && r.date >= from && r.date <= to)
      if (rows.length === 0) return null
      const totalKWh = rows.reduce((s, r) => s + r.kWh, 0)
      let runtimeHrs = 0
      let uptimePctSum = 0
      for (const r of rows) {
        const h = getRuntimeHrs(r.machine, r.date)
        runtimeHrs += h
        uptimePctSum += (h / 24) * 100
      }
      const kWhPerHr = runtimeHrs > 0 ? totalKWh / runtimeHrs : 0
      const avgUptimePct = rows.length > 0 ? uptimePctSum / rows.length : 0

      // Period 1 vs Period 2
      const p1 = computePeriod(rows, p1From, p1To)
      const p2 = computePeriod(rows, p2From, p2To)
      const change = (p1 && p2 && p1.kWhPerRuntimeHour > 0)
        ? ((p2.kWhPerRuntimeHour - p1.kWhPerRuntimeHour) / p1.kWhPerRuntimeHour) * 100
        : null

      return {
        machine,
        plant: getPlant(machine),
        runtimeHrs: Math.round(runtimeHrs * 10) / 10,
        avgUptimePct: Math.round(avgUptimePct * 10) / 10,
        totalKWh: Math.round(totalKWh * 10) / 10,
        kWhPerHr: Math.round(kWhPerHr * 100) / 100,
        p1KWhPerHr: p1?.kWhPerRuntimeHour ?? null,
        p2KWhPerHr: p2?.kWhPerRuntimeHour ?? null,
        changePct: change,
      }
    }).filter(Boolean) as {
      machine: string; plant: string; runtimeHrs: number; avgUptimePct: number;
      totalKWh: number; kWhPerHr: number;
      p1KWhPerHr: number | null; p2KWhPerHr: number | null; changePct: number | null
    }[]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [energyRows, machines, p1From, p1To, p2From, p2To, energyDateRange, runtimeByDeviceDate, downtimeByDeviceDate, hasRuntime])

  // ── Plant summary ─────────────────────────────────────────────────────────
  const plantMetrics = useMemo(() => {
    const plants = ['Addison', 'Mayflower', 'Sparks']
    return plants.map(plant => {
      const rows = machineMetrics.filter(m => m.plant === plant)
      if (rows.length === 0) return null
      const totalKWh = rows.reduce((s, m) => s + m.totalKWh, 0)
      const totalHrs = rows.reduce((s, m) => s + m.runtimeHrs, 0)
      const kWhPerHr = totalHrs > 0 ? totalKWh / totalHrs : 0
      const avgUptime = rows.length > 0 ? rows.reduce((s, m) => s + m.avgUptimePct, 0) / rows.length : 0
      return { plant, totalKWh, totalHrs, kWhPerHr, avgUptimePct: avgUptime, machineCount: rows.length }
    }).filter(Boolean) as { plant: string; totalKWh: number; totalHrs: number; kWhPerHr: number; avgUptimePct: number; machineCount: number }[]
  }, [machineMetrics])

  // ── kWh/runtime hour ranked chart ─────────────────────────────────────────
  const kwhPerHourRanked = useMemo(() => {
    return [...machineMetrics]
      .filter(m => m.kWhPerHr > 0)
      .sort((a, b) => b.kWhPerHr - a.kWhPerHr)
      .slice(0, 20)
      .map(m => ({ machine: m.machine, kWhPerHr: m.kWhPerHr, plant: m.plant }))
  }, [machineMetrics])

  // ── Date range warning for selected periods ───────────────────────────────
  const selectedMinDate = [p1From, p2From].filter(Boolean).sort()[0] ?? ''
  const selectedMaxDate = [p1To, p2To].filter(Boolean).sort().reverse()[0] ?? ''
  const energyRangeWarning = energyDateRange.min && energyDateRange.max && selectedMinDate && selectedMaxDate
    && (selectedMinDate < energyDateRange.min || selectedMaxDate > energyDateRange.max)
  const runtimeRangeWarning = hasRuntime && runtimeDateRange.min && runtimeDateRange.max
    && selectedMinDate && selectedMaxDate
    && (selectedMinDate < runtimeDateRange.min || selectedMaxDate > runtimeDateRange.max)
  const noOverlap = hasRuntime && energyDateRange.min && runtimeDateRange.max
    && (energyDateRange.min > runtimeDateRange.max || runtimeDateRange.min > energyDateRange.max)

  // ── Empty states ──────────────────────────────────────────────────────────
  if (energyRows.length === 0) {
    return (
      <div className={`${cardCls} text-center py-12`}>
        <div className="text-base font-semibold mb-2 text-foreground">Energy data not loaded</div>
        <div className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
          Upload an energy CSV (semicolon-delimited, <code className="text-xs bg-background-accent px-1 rounded">Machine;Date;Energy kWh</code> format) to enable this tab.
        </div>
        <div className="text-xs text-muted-foreground">
          If the Executive Energy &amp; Cost tab is working, navigate to it first — that unlocks the energy dataset used here.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className={cardCls}>
        <h2 className="text-base font-semibold mb-1 text-foreground">
          Energy vs Uptime — Period-over-Period Comparison
        </h2>
        <p className="text-sm mb-3 text-muted-foreground">
          Compare energy usage normalized by runtime across two periods. Use this to evaluate whether equipment changes, maintenance work, or process improvements reduced energy per runtime hour.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-muted-foreground">
          <div><span className="font-semibold text-foreground">kWh used</span> — total energy in the period</div>
          <div><span className="font-semibold text-foreground">Runtime hours</span> — actual or estimated machine uptime</div>
          <div><span className="font-semibold text-foreground">kWh/runtime hour</span> — normalized efficiency metric</div>
          <div><span className="font-semibold text-foreground">Change %</span> — Period 2 vs Period 1</div>
        </div>
      </div>

      {/* ── No-cost disclaimer ───────────────────────────────────────────── */}
      <div className="rounded-lg px-4 py-3 text-sm bg-btn-primary/5 border border-btn-primary/20 text-btn-primary">
        <span className="font-semibold">This tab shows energy usage only.</span>
        {' '}Cost, pricing, and labor rate data are not included.
      </div>

      {/* ── Data coverage ────────────────────────────────────────────────── */}
      <div className={cardCls}>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Data Coverage</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className={`rounded-lg px-4 py-3 border ${energyRows.length > 0 ? 'bg-success/5 border-success/30' : 'bg-warning/5 border-warning/30'}`}>
            <div className="font-semibold text-foreground mb-1">Energy data</div>
            {energyRows.length > 0 ? (
              <div className="text-muted-foreground">
                {energyDateRange.min} to {energyDateRange.max}
                <span className="ml-2 text-foreground font-medium">{energyRows.length.toLocaleString()} rows · {machines.length} machines</span>
              </div>
            ) : (
              <div className="text-warning">Not loaded — upload an energy CSV</div>
            )}
          </div>
          <div className={`rounded-lg px-4 py-3 border ${hasRuntime ? 'bg-success/5 border-success/30' : 'bg-background border-border'}`}>
            <div className="font-semibold text-foreground mb-1">Runtime data</div>
            {hasRuntime ? (
              <div className="text-muted-foreground">
                {runtimeDateRange.min} to {runtimeDateRange.max}
                <span className="ml-2 text-foreground font-medium">{runtimeRecords.length.toLocaleString()} records</span>
              </div>
            ) : (
              <div className="text-muted-foreground">
                Not uploaded — runtime estimated from downtime data (24h − downtime).
                Upload a Guidewheel Trends XLSX to use actual runtime hours.
              </div>
            )}
          </div>
        </div>

        {noOverlap && (
          <div className="mt-3 rounded px-3 py-2 text-xs bg-danger/5 border border-danger/30 text-danger">
            Energy and runtime datasets do not overlap. Check that the date ranges match before comparing.
          </div>
        )}
        {energyRangeWarning && !noOverlap && (
          <div className="mt-3 rounded px-3 py-2 text-xs bg-warning/5 border border-warning/30 text-warning">
            Selected date range extends beyond available energy data ({energyDateRange.min} to {energyDateRange.max}). Results only reflect available data.
          </div>
        )}
        {runtimeRangeWarning && !noOverlap && (
          <div className="mt-3 rounded px-3 py-2 text-xs bg-warning/5 border border-warning/30 text-warning">
            Selected date range extends beyond available runtime data ({runtimeDateRange.min} to {runtimeDateRange.max}).
          </div>
        )}
      </div>

      {/* ── Machine & Period Filters ──────────────────────────────────────── */}
      <div className={cardCls}>
        <div className="flex flex-wrap items-start gap-6">

          <div>
            <label className="bh-metric-label mb-1 block">Machine (period comparison)</label>
            <select
              value={selectedMachine}
              onChange={e => setSelectedMachine(e.target.value)}
              className="text-sm rounded px-3 py-1.5 bg-background border border-border text-foreground"
            >
              {machines.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            {energyRows.length > 0 && !machines.includes('M3E-18') && (
              <p className="text-xs mt-1 text-warning">M3E-18 / Mold 288 not found in energy dataset.</p>
            )}
          </div>

          {/* Period 1 */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: P1_COLOR }}>Period 1</div>
            <div className="flex items-end gap-2">
              <div>
                <label className="block text-xs mb-1 text-muted-foreground">From</label>
                <input type="date" value={p1From} onChange={e => setP1From(e.target.value)}
                  className="text-sm rounded px-3 py-1.5 bg-background text-foreground"
                  style={{ border: `1px solid ${P1_COLOR}` }}
                  min={energyDateRange.min || undefined} max={energyDateRange.max || undefined}
                />
              </div>
              <div>
                <label className="block text-xs mb-1 text-muted-foreground">To</label>
                <input type="date" value={p1To} onChange={e => setP1To(e.target.value)}
                  className="text-sm rounded px-3 py-1.5 bg-background text-foreground"
                  style={{ border: `1px solid ${P1_COLOR}` }}
                  min={energyDateRange.min || undefined} max={energyDateRange.max || undefined}
                />
              </div>
            </div>
            {p1Metrics && <p className="text-xs mt-1 text-muted-foreground">{p1Metrics.days} days of data</p>}
            {!p1Metrics && p1From && p1To && (
              <p className="text-xs mt-1 text-danger">No data in selected period.</p>
            )}
          </div>

          {/* Period 2 */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: P2_COLOR }}>Period 2</div>
            <div className="flex items-end gap-2">
              <div>
                <label className="block text-xs mb-1 text-muted-foreground">From</label>
                <input type="date" value={p2From} onChange={e => setP2From(e.target.value)}
                  className="text-sm rounded px-3 py-1.5 bg-background text-foreground"
                  style={{ border: `1px solid ${P2_COLOR}` }}
                  min={energyDateRange.min || undefined} max={energyDateRange.max || undefined}
                />
              </div>
              <div>
                <label className="block text-xs mb-1 text-muted-foreground">To</label>
                <input type="date" value={p2To} onChange={e => setP2To(e.target.value)}
                  className="text-sm rounded px-3 py-1.5 bg-background text-foreground"
                  style={{ border: `1px solid ${P2_COLOR}` }}
                  min={energyDateRange.min || undefined} max={energyDateRange.max || undefined}
                />
              </div>
            </div>
            {p2Metrics && <p className="text-xs mt-1 text-muted-foreground">{p2Metrics.days} days of data</p>}
            {!p2Metrics && p2From && p2To && (
              <p className="text-xs mt-1 text-danger">No data in selected period.</p>
            )}
          </div>

        </div>
      </div>

      {/* ── Summary Cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[
          { label: 'Period 1 — kWh Used', value: p1Metrics ? p1Metrics.totalKWh.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—', sub: p1Metrics ? `${p1Metrics.days} days` : null, color: P1_COLOR },
          { label: 'Period 1 — Runtime Hours', value: p1Metrics ? fmt(p1Metrics.runtimeHours, 0) : '—', sub: hasRuntime ? 'from uploaded runtime data' : 'est. from downtime', color: P1_COLOR },
          { label: 'Period 1 — kWh/Runtime Hour', value: p1Metrics ? fmt(p1Metrics.kWhPerRuntimeHour) : '—', sub: null, color: P1_COLOR },
          { label: 'Period 2 — kWh Used', value: p2Metrics ? p2Metrics.totalKWh.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—', sub: p2Metrics ? `${p2Metrics.days} days` : null, color: P2_COLOR },
          { label: 'Period 2 — Runtime Hours', value: p2Metrics ? fmt(p2Metrics.runtimeHours, 0) : '—', sub: hasRuntime ? 'from uploaded runtime data' : 'est. from downtime', color: P2_COLOR },
          { label: 'Period 2 — kWh/Runtime Hour', value: p2Metrics ? fmt(p2Metrics.kWhPerRuntimeHour) : '—', sub: null, color: P2_COLOR },
        ].map(card => (
          <div key={card.label} className={cardCls} style={{ borderTop: `3px solid ${card.color}` }}>
            <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: card.color }}>{card.label}</div>
            <div className="text-2xl font-bold text-foreground">{card.value}</div>
            {card.sub && <div className="text-xs mt-0.5 text-muted-foreground">{card.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── Change card ───────────────────────────────────────────────────── */}
      {pctChange !== null && (
        <div className={`${cardCls} border-l-4 ${pctChange <= 0 ? 'border-l-success' : 'border-l-danger'}`}>
          <div className="bh-metric-label mb-1">Change in kWh/Runtime Hour (Period 2 vs Period 1) — {selectedMachine}</div>
          <div className={`text-3xl font-bold ${pctChange <= 0 ? 'text-success' : 'text-danger'}`}>
            {pctChange <= 0 ? '' : '+'}{fmt(pctChange, 1)}%
          </div>
          <div className="text-sm mt-1 text-muted-foreground">
            {pctChange <= 0
              ? `Energy efficiency improved — ${fmt(Math.abs(pctChange), 1)}% less energy per runtime hour in Period 2`
              : `Energy per runtime hour increased ${fmt(pctChange, 1)}% in Period 2 vs Period 1`}
          </div>
        </div>
      )}

      {/* ── Period Summary Bar Chart ───────────────────────────────────────── */}
      {summaryChartData.length > 0 && (
        <div className={cardCls}>
          <h2 className="text-sm font-semibold mb-3 text-foreground">
            kWh per Runtime Hour — Period 1 vs Period 2 ({selectedMachine})
          </h2>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summaryChartData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="period" tick={axisTick} />
                <YAxis tick={axisTick} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${fmt(v)} kWh/hr`, 'kWh per Runtime Hour']} />
                <Bar dataKey="kWhPerHour" name="kWh/Runtime Hour" radius={[4, 4, 0, 0]} fill={chartColor(0)} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Daily kWh + Runtime Hours Chart ───────────────────────────────── */}
      {dailyChartData.length > 0 && (
        <div className={cardCls}>
          <h2 className="text-sm font-semibold mb-1 text-foreground">Daily kWh Usage vs Runtime Hours — {selectedMachine}</h2>
          <p className="text-xs mb-3 text-muted-foreground">
            Bars show daily kWh by period. Line shows runtime hours
            {hasRuntime ? ' (from uploaded data)' : ' (estimated: 24h − downtime)'}.
            Higher kWh on high-runtime days is expected — compare kWh/hr to see true efficiency.
          </p>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dailyChartData} margin={{ top: 4, right: 30, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="date" tick={axisTick} interval="preserveStartEnd" />
                <YAxis yAxisId="kwh" tick={axisTick} label={{ value: 'kWh', angle: -90, position: 'insideLeft', fontSize: 9, fill: 'var(--chart-axis-label)', dy: 20 }} />
                <YAxis yAxisId="runtime" orientation="right" tick={axisTick} label={{ value: 'Runtime hrs', angle: 90, position: 'insideRight', fontSize: 9, fill: 'var(--chart-axis-label)', dy: -40 }} />
                <Tooltip
                  contentStyle={tooltipStyle}
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
                <Line yAxisId="runtime" type="monotone" dataKey="runtimeHours" name="Runtime Hours" stroke="var(--color-success)" strokeWidth={2} dot={false} strokeDasharray="4 2" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Plant Comparison ──────────────────────────────────────────────── */}
      {plantMetrics.length > 0 && (
        <div className={cardCls}>
          <h2 className="text-sm font-semibold mb-3 text-foreground">Plant Comparison</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {['Plant', 'Machines', 'Total kWh', 'Runtime Hours', 'kWh/Runtime Hour', 'Avg Uptime %'].map(h => (
                    <th key={h} className="text-[0.7rem] font-bold uppercase tracking-[0.06em] text-muted-foreground px-3 py-2 border-b border-border text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plantMetrics.map(pm => (
                  <tr key={pm.plant}>
                    <td className="px-3 py-2 text-[0.8rem] text-foreground border-b border-border font-medium">{pm.plant}</td>
                    <td className="px-3 py-2 text-[0.8rem] text-foreground border-b border-border">{pm.machineCount}</td>
                    <td className="px-3 py-2 text-[0.8rem] text-foreground border-b border-border">{pm.totalKWh.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="px-3 py-2 text-[0.8rem] text-foreground border-b border-border">{fmt(pm.totalHrs, 0)}</td>
                    <td className="px-3 py-2 text-[0.8rem] text-foreground border-b border-border font-semibold">{fmt(pm.kWhPerHr)}</td>
                    <td className="px-3 py-2 text-[0.8rem] text-foreground border-b border-border">{fmt(pm.avgUptimePct, 1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── kWh/Runtime Hour by Machine (ranked) ─────────────────────────── */}
      {kwhPerHourRanked.length > 0 && (
        <div className={cardCls}>
          <h2 className="text-sm font-semibold mb-1 text-foreground">kWh per Runtime Hour by Machine (top 20, highest first)</h2>
          <p className="text-xs mb-3 text-muted-foreground">Machines at the top use the most energy relative to their runtime. Review whether high values indicate inefficiency or high-duty operation.</p>
          <div style={{ height: Math.max(180, kwhPerHourRanked.length * 22 + 40) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={kwhPerHourRanked}
                layout="vertical"
                margin={{ top: 4, right: 40, left: 60, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
                <XAxis type="number" tick={axisTick} />
                <YAxis dataKey="machine" type="category" tick={{ ...axisTick, fontSize: 10 }} width={58} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number) => [`${fmt(v)} kWh/hr`, 'kWh per Runtime Hour']}
                />
                <Bar dataKey="kWhPerHr" name="kWh/Runtime Hour" fill={chartColor(2)} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Machine Detail Table ──────────────────────────────────────────── */}
      {machineMetrics.length > 0 && (
        <div className={cardCls}>
          <h2 className="text-sm font-semibold mb-3 text-foreground">Machine Detail</h2>
          <div className="overflow-x-auto" style={{ maxHeight: 480, overflowY: 'auto' }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card z-10">
                <tr>
                  {['Machine', 'Plant', 'Runtime Hrs', 'Uptime %', 'Total kWh', 'kWh/Hr', 'P1 kWh/Hr', 'P2 kWh/Hr', 'Change %'].map(h => (
                    <th key={h} className="text-[0.7rem] font-bold uppercase tracking-[0.06em] text-muted-foreground px-3 py-2 border-b border-border text-left whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {machineMetrics.sort((a, b) => b.kWhPerHr - a.kWhPerHr).map(m => (
                  <tr key={m.machine}>
                    <td className="px-3 py-2 text-[0.8rem] text-foreground border-b border-border font-mono text-xs">{m.machine}</td>
                    <td className="px-3 py-2 text-[0.8rem] text-foreground border-b border-border">{m.plant}</td>
                    <td className="px-3 py-2 text-[0.8rem] text-foreground border-b border-border">{fmt(m.runtimeHrs, 0)}</td>
                    <td className="px-3 py-2 text-[0.8rem] text-foreground border-b border-border">{fmt(m.avgUptimePct, 1)}%</td>
                    <td className="px-3 py-2 text-[0.8rem] text-foreground border-b border-border">{m.totalKWh.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="px-3 py-2 text-[0.8rem] text-foreground border-b border-border font-semibold">{fmt(m.kWhPerHr)}</td>
                    <td className="px-3 py-2 text-[0.8rem] text-muted-foreground border-b border-border">{m.p1KWhPerHr !== null ? fmt(m.p1KWhPerHr) : '—'}</td>
                    <td className="px-3 py-2 text-[0.8rem] text-muted-foreground border-b border-border">{m.p2KWhPerHr !== null ? fmt(m.p2KWhPerHr) : '—'}</td>
                    <td className={`px-3 py-2 text-[0.8rem] border-b border-border font-semibold ${
                      m.changePct === null ? 'text-muted-foreground' :
                      m.changePct <= 0 ? 'text-success' : 'text-danger'
                    }`}>
                      {m.changePct !== null ? `${m.changePct <= 0 ? '' : '+'}${fmt(m.changePct, 1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Methodology note ─────────────────────────────────────────────── */}
      <div className="rounded-lg px-4 py-3 text-xs bg-card border border-border text-muted-foreground">
        <span className="font-semibold text-foreground">Methodology:</span>
        {' '}kWh per runtime hour = daily energy ÷ daily runtime.
        {hasRuntime
          ? ' Runtime from uploaded Guidewheel Trends data (sum of shift runtime hours per device per day).'
          : ' Runtime estimated as 24h minus recorded downtime hours. Upload a runtime XLSX for actual values.'}
        {' '}This view shows energy usage only — no cost, pricing, or labor rates.
      </div>

    </div>
  )
}
