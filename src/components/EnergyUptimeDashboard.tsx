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

function fmt(n: number, d = 2): string {
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(d)
}

function safeArr<T>(x: T[] | null | undefined): T[] {
  return Array.isArray(x) ? x : []
}

function getPlant(machine: string): string {
  const p = (machine ?? '').charAt(0)
  if (p === '1') return 'Addison'
  if (p === '2') return 'Mayflower'
  if (p === '3') return 'Sparks'
  return 'Unknown'
}

const cardCls = 'bg-card border border-border rounded-xl p-5'
const P1_COLOR = chartColor(0)
const P2_COLOR = chartColor(3)

export default function EnergyUptimeDashboard(rawProps: Props) {
  // Defensive: guarantee props are arrays even if undefined passed from parent
  const energyRows = safeArr(rawProps.energyRows)
  const downtimeEvents = safeArr(rawProps.downtimeEvents)
  const runtimeRecords = safeArr(rawProps.runtimeRecords)

  // ── Energy date range ──────────────────────────────────────────────────────
  const energyDateRange = useMemo(() => {
    if (energyRows.length === 0) return { min: '', max: '' }
    const dates = energyRows.map(r => r?.date ?? '').filter(Boolean).sort()
    if (dates.length === 0) return { min: '', max: '' }
    return { min: dates[0], max: dates[dates.length - 1] }
  }, [energyRows])

  // ── Runtime ────────────────────────────────────────────────────────────────
  const hasRuntime = runtimeRecords.length > 0

  const runtimeDateRange = useMemo(() => {
    if (!hasRuntime) return { min: '', max: '' }
    const dates = runtimeRecords.map(r => r?.date ?? '').filter(Boolean).sort()
    if (dates.length === 0) return { min: '', max: '' }
    return { min: dates[0], max: dates[dates.length - 1] }
  }, [runtimeRecords, hasRuntime])

  // Map: device → date → total runtime hours (summed across shifts)
  const runtimeByDeviceDate = useMemo(() => {
    const map = new Map<string, Map<string, number>>()
    for (const r of runtimeRecords) {
      if (!r?.device || !r?.date) continue
      if (!map.has(r.device)) map.set(r.device, new Map())
      const inner = map.get(r.device)!
      const prev = inner.get(r.date) ?? 0
      inner.set(r.date, prev + (r.runtimeHrs ?? 0))
    }
    return map
  }, [runtimeRecords])

  // ── Downtime fallback: hours per device per day ───────────────────────────
  const downtimeByDeviceDate = useMemo(() => {
    const map = new Map<string, Map<string, number>>()
    for (const e of downtimeEvents) {
      if (!e?.device || !e?.calendar_date) continue
      if (!map.has(e.device)) map.set(e.device, new Map())
      const inner = map.get(e.device)!
      const prev = inner.get(e.calendar_date) ?? 0
      inner.set(e.calendar_date, prev + (e.duration ?? 0) / 60)
    }
    return map
  }, [downtimeEvents])

  // ── Machine list ───────────────────────────────────────────────────────────
  const machines = useMemo(
    () => Array.from(new Set(energyRows.map(r => r?.machine).filter(Boolean) as string[])).sort(),
    [energyRows]
  )

  const [selectedMachine, setSelectedMachine] = useState('')

  useEffect(() => {
    if (selectedMachine) return
    if (machines.length === 0) return
    const pilot = machines.find(m => m === '1M3E-18') ?? machines[0]
    setSelectedMachine(pilot)
  }, [machines, selectedMachine])

  // ── Period date states ─────────────────────────────────────────────────────
  const [p1From, setP1From] = useState('')
  const [p1To, setP1To] = useState('')
  const [p2From, setP2From] = useState('')
  const [p2To, setP2To] = useState('')
  const [periodsInitialized, setPeriodsInitialized] = useState(false)

  useEffect(() => {
    if (periodsInitialized) return
    if (!energyDateRange.min || !energyDateRange.max) return
    try {
      const fromMs = new Date(energyDateRange.min).getTime()
      const toMs = new Date(energyDateRange.max).getTime()
      if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return
      const midMs = (fromMs + toMs) / 2
      const midStr = new Date(midMs).toISOString().slice(0, 10)
      const nextDayStr = new Date(midMs + 86400000).toISOString().slice(0, 10)
      setP1From(energyDateRange.min)
      setP1To(midStr)
      setP2From(nextDayStr)
      setP2To(energyDateRange.max)
      setPeriodsInitialized(true)
    } catch (err) {
      console.error('[EnergyUptimeDashboard] period init failed:', err)
    }
  }, [energyDateRange, periodsInitialized])

  // ── Runtime hours lookup ───────────────────────────────────────────────────
  function getRuntimeHrs(device: string, date: string): number {
    if (!device || !date) return 0
    if (hasRuntime) {
      const h = runtimeByDeviceDate.get(device)?.get(date)
      return (Number.isFinite(h) ? h : 0) as number
    }
    const dt = downtimeByDeviceDate.get(device)?.get(date) ?? 0
    return Math.max(0, 24 - (Number.isFinite(dt) ? dt : 0))
  }

  // ── Per-machine energy rows ────────────────────────────────────────────────
  const machineEnergy = useMemo(
    () => energyRows.filter(r => r?.machine && (!selectedMachine || r.machine === selectedMachine)),
    [energyRows, selectedMachine]
  )

  // ── Period computation ─────────────────────────────────────────────────────
  const computePeriod = (rows: EnergyRow[], from: string, to: string) => {
    if (!from || !to || rows.length === 0) return null
    const periodRows = rows.filter(r => r?.date && r.date >= from && r.date <= to)
    if (periodRows.length === 0) return null
    let totalKWh = 0
    let runtimeHours = 0
    for (const r of periodRows) {
      totalKWh += Number.isFinite(r.kWh) ? r.kWh : 0
      runtimeHours += getRuntimeHrs(r.machine, r.date)
    }
    const kWhPerRuntimeHour = runtimeHours > 0 ? totalKWh / runtimeHours : 0
    const avgUptimePct = periodRows.length > 0 ? (runtimeHours / (periodRows.length * 24)) * 100 : 0
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
    if (!p1Metrics || !p2Metrics || !Number.isFinite(p1Metrics.kWhPerRuntimeHour) || p1Metrics.kWhPerRuntimeHour === 0) return null
    const change = ((p2Metrics.kWhPerRuntimeHour - p1Metrics.kWhPerRuntimeHour) / p1Metrics.kWhPerRuntimeHour) * 100
    return Number.isFinite(change) ? change : null
  }, [p1Metrics, p2Metrics])

  // ── Summary bar chart ─────────────────────────────────────────────────────
  const summaryChartData = useMemo(() => {
    const rows: { period: string; kWhPerHour: number }[] = []
    if (p1Metrics && Number.isFinite(p1Metrics.kWhPerRuntimeHour)) rows.push({ period: 'Period 1', kWhPerHour: p1Metrics.kWhPerRuntimeHour })
    if (p2Metrics && Number.isFinite(p2Metrics.kWhPerRuntimeHour)) rows.push({ period: 'Period 2', kWhPerHour: p2Metrics.kWhPerRuntimeHour })
    return rows
  }, [p1Metrics, p2Metrics])

  // ── Daily chart ───────────────────────────────────────────────────────────
  const dailyChartData = useMemo(() => {
    const allDates = Array.from(new Set(machineEnergy.map(r => r?.date).filter(Boolean) as string[])).sort()
    return allDates.map(date => {
      const inP1 = p1From && p1To && date >= p1From && date <= p1To
      const inP2 = p2From && p2To && date >= p2From && date <= p2To
      if (!inP1 && !inP2) return null
      const row = machineEnergy.find(r => r?.date === date)
      if (!row) return null
      const runtimeH = getRuntimeHrs(row.machine, date)
      const kWh = Number.isFinite(row.kWh) ? row.kWh : 0
      return {
        date: date.slice(5),
        kWhP1: inP1 ? kWh : null,
        kWhP2: inP2 ? kWh : null,
        runtimeHours: Number.isFinite(runtimeH) ? runtimeH : 0,
      }
    }).filter(Boolean) as { date: string; kWhP1: number | null; kWhP2: number | null; runtimeHours: number }[]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineEnergy, p1From, p1To, p2From, p2To, runtimeByDeviceDate, downtimeByDeviceDate, hasRuntime])

  // ── Fleet metrics by machine ───────────────────────────────────────────────
  const machineMetrics = useMemo(() => {
    if (energyRows.length === 0 || machines.length === 0) return []
    const from = p1From || energyDateRange.min
    const to = p2To || energyDateRange.max
    if (!from || !to) return []

    const result = []
    for (const machine of machines) {
      try {
        const rows = energyRows.filter(r => r?.machine === machine && r?.date && r.date >= from && r.date <= to)
        if (rows.length === 0) continue
        let totalKWh = 0
        let runtimeHrs = 0
        for (const r of rows) {
          totalKWh += Number.isFinite(r.kWh) ? r.kWh : 0
          runtimeHrs += getRuntimeHrs(r.machine, r.date)
        }
        const kWhPerHr = runtimeHrs > 0 ? totalKWh / runtimeHrs : 0
        const avgUptimePct = rows.length > 0 ? (runtimeHrs / (rows.length * 24)) * 100 : 0
        const p1 = computePeriod(rows, p1From, p1To)
        const p2c = computePeriod(rows, p2From, p2To)
        const changePct = (p1 && p2c && p1.kWhPerRuntimeHour > 0)
          ? ((p2c.kWhPerRuntimeHour - p1.kWhPerRuntimeHour) / p1.kWhPerRuntimeHour) * 100
          : null
        result.push({
          machine,
          plant: getPlant(machine),
          runtimeHrs: Number.isFinite(runtimeHrs) ? Math.round(runtimeHrs * 10) / 10 : 0,
          avgUptimePct: Number.isFinite(avgUptimePct) ? Math.round(avgUptimePct * 10) / 10 : 0,
          totalKWh: Number.isFinite(totalKWh) ? Math.round(totalKWh * 10) / 10 : 0,
          kWhPerHr: Number.isFinite(kWhPerHr) ? Math.round(kWhPerHr * 100) / 100 : 0,
          p1KWhPerHr: (p1 && Number.isFinite(p1.kWhPerRuntimeHour)) ? p1.kWhPerRuntimeHour : null,
          p2KWhPerHr: (p2c && Number.isFinite(p2c.kWhPerRuntimeHour)) ? p2c.kWhPerRuntimeHour : null,
          changePct: (Number.isFinite(changePct as number)) ? changePct : null,
        })
      } catch (err) {
        console.error('[EnergyUptimeDashboard] machineMetrics error for', machine, err)
      }
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [energyRows, machines, p1From, p1To, p2From, p2To, energyDateRange, runtimeByDeviceDate, downtimeByDeviceDate, hasRuntime])

  // ── Plant summary ─────────────────────────────────────────────────────────
  const plantMetrics = useMemo(() => {
    return ['Addison', 'Mayflower', 'Sparks'].map(plant => {
      const rows = machineMetrics.filter(m => m.plant === plant)
      if (rows.length === 0) return null
      const totalKWh = rows.reduce((s, m) => s + m.totalKWh, 0)
      const totalHrs = rows.reduce((s, m) => s + m.runtimeHrs, 0)
      const kWhPerHr = totalHrs > 0 ? totalKWh / totalHrs : 0
      const avgUptime = rows.reduce((s, m) => s + m.avgUptimePct, 0) / rows.length
      return { plant, totalKWh, totalHrs, kWhPerHr: Number.isFinite(kWhPerHr) ? kWhPerHr : 0, avgUptimePct: Number.isFinite(avgUptime) ? avgUptime : 0, machineCount: rows.length }
    }).filter((x): x is NonNullable<typeof x> => x !== null)
  }, [machineMetrics])

  // ── Ranked kWh/hr chart ───────────────────────────────────────────────────
  const kwhPerHourRanked = useMemo(() =>
    [...machineMetrics]
      .filter(m => m.kWhPerHr > 0)
      .sort((a, b) => b.kWhPerHr - a.kWhPerHr)
      .slice(0, 20)
      .map(m => ({ machine: m.machine, kWhPerHr: m.kWhPerHr, plant: m.plant })),
    [machineMetrics]
  )

  // ── Overlap & warnings ────────────────────────────────────────────────────
  const selMin = [p1From, p2From].filter(Boolean).sort()[0] ?? ''
  const selMax = [p1To, p2To].filter(Boolean).sort().reverse()[0] ?? ''
  const noOverlap = hasRuntime && energyDateRange.min && runtimeDateRange.max &&
    (energyDateRange.min > runtimeDateRange.max || runtimeDateRange.min > energyDateRange.max)

  // ── Empty state ───────────────────────────────────────────────────────────
  if (energyRows.length === 0) {
    return (
      <div className={`${cardCls} text-center py-12`}>
        <div className="text-base font-semibold mb-2 text-foreground">Energy data not loaded</div>
        <div className="text-sm text-muted-foreground mb-3 max-w-md mx-auto">
          Upload an energy CSV (semicolon-delimited, <code className="text-xs bg-background-accent px-1 rounded">Machine;Date;Energy kWh</code>) or go to the Executive Energy &amp; Cost tab to load energy data.
        </div>
        {hasRuntime && (
          <div className="text-xs text-muted-foreground mt-2 max-w-md mx-auto rounded-lg px-3 py-2 bg-card border border-border">
            Runtime data is loaded ({runtimeRecords.length.toLocaleString()} records). Energy data is also required for Energy vs Uptime analysis.
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className={cardCls}>
        <h2 className="text-base font-semibold mb-1 text-foreground">Energy vs Uptime — Period-over-Period Comparison</h2>
        <p className="text-sm mb-3 text-muted-foreground">
          Compare energy usage normalized by runtime across two periods. Evaluate whether operational changes reduced energy per runtime hour.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-muted-foreground">
          <div><span className="font-semibold text-foreground">kWh used</span> — total energy in the period</div>
          <div><span className="font-semibold text-foreground">Runtime hours</span> — {hasRuntime ? 'from uploaded Trends data' : 'estimated from downtime'}</div>
          <div><span className="font-semibold text-foreground">kWh/runtime hour</span> — normalized efficiency</div>
          <div><span className="font-semibold text-foreground">Change %</span> — Period 2 vs Period 1</div>
        </div>
      </div>

      {/* No-cost disclaimer */}
      <div className="rounded-lg px-4 py-3 text-sm bg-btn-primary/5 border border-btn-primary/20 text-btn-primary">
        <span className="font-semibold">This tab shows energy usage only.</span>{' '}Cost, pricing, and labor rates are not included.
      </div>

      {/* Data coverage */}
      <div className={cardCls}>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Data Coverage</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg px-4 py-3 border bg-success/5 border-success/30">
            <div className="font-semibold text-foreground mb-1">Energy data</div>
            <div className="text-muted-foreground">
              {energyDateRange.min} to {energyDateRange.max}
              <span className="ml-2 font-medium text-foreground">{energyRows.length.toLocaleString()} rows · {machines.length} machines</span>
            </div>
            <div className="mt-1 text-muted-foreground">
              Endpoint: <code className="text-xs">/api/data/energy/usage</code> (same table as Executive Energy &amp; Cost)
            </div>
          </div>
          <div className={`rounded-lg px-4 py-3 border ${hasRuntime ? 'bg-success/5 border-success/30' : 'bg-background border-border'}`}>
            <div className="font-semibold text-foreground mb-1">Runtime data</div>
            {hasRuntime ? (
              <>
                <div className="text-muted-foreground">
                  {runtimeDateRange.min} to {runtimeDateRange.max}
                  <span className="ml-2 font-medium text-foreground">{runtimeRecords.length.toLocaleString()} records</span>
                </div>
                <div className="mt-1 text-muted-foreground">Endpoint: <code className="text-xs">/api/data/runtime</code> (runtime_data table)</div>
              </>
            ) : (
              <div className="text-muted-foreground">
                Not uploaded — runtime estimated as 24h minus downtime. Upload a Guidewheel Trends XLSX for actual values.
              </div>
            )}
          </div>
        </div>
        {noOverlap && (
          <div className="mt-3 rounded px-3 py-2 text-xs bg-danger/5 border border-danger/30 text-danger">
            Energy and runtime datasets do not overlap. Check that both cover the same date range.
          </div>
        )}
        {selMin && selMax && energyDateRange.min && (selMin < energyDateRange.min || selMax > energyDateRange.max) && !noOverlap && (
          <div className="mt-3 rounded px-3 py-2 text-xs bg-warning/5 border border-warning/30 text-warning">
            Selected range extends beyond available energy data ({energyDateRange.min} to {energyDateRange.max}).
          </div>
        )}
      </div>

      {/* Filters */}
      <div className={cardCls}>
        <div className="flex flex-wrap items-start gap-6">
          <div>
            <label className="bh-metric-label mb-1 block">Machine (period comparison)</label>
            <select value={selectedMachine} onChange={e => setSelectedMachine(e.target.value)}
              className="text-sm rounded px-3 py-1.5 bg-background border border-border text-foreground">
              {machines.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          {/* Period 1 */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: P1_COLOR }}>Period 1</div>
            <div className="flex items-end gap-2">
              <div>
                <label className="block text-xs mb-1 text-muted-foreground">From</label>
                <input type="date" value={p1From} onChange={e => setP1From(e.target.value)}
                  className="text-sm rounded px-3 py-1.5 bg-background text-foreground" style={{ border: `1px solid ${P1_COLOR}` }}
                  min={energyDateRange.min || undefined} max={energyDateRange.max || undefined} />
              </div>
              <div>
                <label className="block text-xs mb-1 text-muted-foreground">To</label>
                <input type="date" value={p1To} onChange={e => setP1To(e.target.value)}
                  className="text-sm rounded px-3 py-1.5 bg-background text-foreground" style={{ border: `1px solid ${P1_COLOR}` }}
                  min={energyDateRange.min || undefined} max={energyDateRange.max || undefined} />
              </div>
            </div>
            {p1Metrics && <p className="text-xs mt-1 text-muted-foreground">{p1Metrics.days} days of data</p>}
            {!p1Metrics && p1From && p1To && <p className="text-xs mt-1 text-danger">No data in selected period.</p>}
          </div>
          {/* Period 2 */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: P2_COLOR }}>Period 2</div>
            <div className="flex items-end gap-2">
              <div>
                <label className="block text-xs mb-1 text-muted-foreground">From</label>
                <input type="date" value={p2From} onChange={e => setP2From(e.target.value)}
                  className="text-sm rounded px-3 py-1.5 bg-background text-foreground" style={{ border: `1px solid ${P2_COLOR}` }}
                  min={energyDateRange.min || undefined} max={energyDateRange.max || undefined} />
              </div>
              <div>
                <label className="block text-xs mb-1 text-muted-foreground">To</label>
                <input type="date" value={p2To} onChange={e => setP2To(e.target.value)}
                  className="text-sm rounded px-3 py-1.5 bg-background text-foreground" style={{ border: `1px solid ${P2_COLOR}` }}
                  min={energyDateRange.min || undefined} max={energyDateRange.max || undefined} />
              </div>
            </div>
            {p2Metrics && <p className="text-xs mt-1 text-muted-foreground">{p2Metrics.days} days of data</p>}
            {!p2Metrics && p2From && p2To && <p className="text-xs mt-1 text-danger">No data in selected period.</p>}
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[
          { label: 'Period 1 — kWh Used', value: p1Metrics ? p1Metrics.totalKWh.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—', sub: p1Metrics ? `${p1Metrics.days} days` : 'Select Period 1 dates', color: P1_COLOR },
          { label: 'Period 1 — Runtime Hours', value: p1Metrics ? fmt(p1Metrics.runtimeHours, 0) : '—', sub: hasRuntime ? 'from Trends XLSX' : 'estimated from downtime', color: P1_COLOR },
          { label: 'Period 1 — kWh/Runtime Hour', value: p1Metrics ? fmt(p1Metrics.kWhPerRuntimeHour) : '—', sub: null, color: P1_COLOR },
          { label: 'Period 2 — kWh Used', value: p2Metrics ? p2Metrics.totalKWh.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—', sub: p2Metrics ? `${p2Metrics.days} days` : 'Select Period 2 dates', color: P2_COLOR },
          { label: 'Period 2 — Runtime Hours', value: p2Metrics ? fmt(p2Metrics.runtimeHours, 0) : '—', sub: hasRuntime ? 'from Trends XLSX' : 'estimated from downtime', color: P2_COLOR },
          { label: 'Period 2 — kWh/Runtime Hour', value: p2Metrics ? fmt(p2Metrics.kWhPerRuntimeHour) : '—', sub: null, color: P2_COLOR },
        ].map(card => (
          <div key={card.label} className={cardCls} style={{ borderTop: `3px solid ${card.color}` }}>
            <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: card.color }}>{card.label}</div>
            <div className="text-2xl font-bold text-foreground">{card.value}</div>
            {card.sub && <div className="text-xs mt-0.5 text-muted-foreground">{card.sub}</div>}
          </div>
        ))}
      </div>

      {/* Change card */}
      {pctChange !== null && (
        <div className={`${cardCls} border-l-4 ${pctChange <= 0 ? 'border-l-success' : 'border-l-danger'}`}>
          <div className="bh-metric-label mb-1">Change in kWh/Runtime Hour — {selectedMachine} (Period 2 vs Period 1)</div>
          <div className={`text-3xl font-bold ${pctChange <= 0 ? 'text-success' : 'text-danger'}`}>
            {pctChange <= 0 ? '' : '+'}{fmt(pctChange, 1)}%
          </div>
          <div className="text-sm mt-1 text-muted-foreground">
            {pctChange <= 0
              ? `Energy efficiency improved — ${fmt(Math.abs(pctChange), 1)}% less energy per runtime hour in Period 2`
              : `Energy per runtime hour increased ${fmt(pctChange, 1)}% in Period 2`}
          </div>
        </div>
      )}

      {/* Period bar chart */}
      {summaryChartData.length > 0 && (
        <div className={cardCls}>
          <h2 className="text-sm font-semibold mb-3 text-foreground">kWh per Runtime Hour — Period 1 vs Period 2 ({selectedMachine})</h2>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summaryChartData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="period" tick={axisTick} />
                <YAxis tick={axisTick} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${fmt(v)} kWh/hr`, 'kWh/Runtime Hour']} />
                <Bar dataKey="kWhPerHour" name="kWh/Runtime Hour" radius={[4, 4, 0, 0]} fill={chartColor(0)} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Daily kWh + runtime chart */}
      {dailyChartData.length > 0 && (
        <div className={cardCls}>
          <h2 className="text-sm font-semibold mb-1 text-foreground">Daily kWh vs Runtime Hours — {selectedMachine}</h2>
          <p className="text-xs mb-3 text-muted-foreground">
            Bars = daily kWh by period. Line = runtime hours ({hasRuntime ? 'from Trends data' : 'est. 24h − downtime'}).
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
                    const n = typeof v === 'number' && Number.isFinite(v) ? v : null
                    if (n === null) return [null, name]
                    if (name === 'Period 1 kWh' || name === 'Period 2 kWh') return [`${n.toFixed(0)} kWh`, name]
                    if (name === 'Runtime Hours') return [`${n.toFixed(1)} hrs`, name]
                    return [String(n), name]
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

      {/* Plant comparison */}
      {plantMetrics.length > 0 && (
        <div className={cardCls}>
          <h2 className="text-sm font-semibold mb-3 text-foreground">Plant Comparison</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>{['Plant', 'Machines', 'Total kWh', 'Runtime Hrs', 'kWh/Runtime Hr', 'Avg Uptime %'].map(h =>
                  <th key={h} className="text-[0.7rem] font-bold uppercase tracking-[0.06em] text-muted-foreground px-3 py-2 border-b border-border text-left">{h}</th>
                )}</tr>
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

      {/* kWh/hr ranked */}
      {kwhPerHourRanked.length > 0 && (
        <div className={cardCls}>
          <h2 className="text-sm font-semibold mb-1 text-foreground">kWh per Runtime Hour by Machine — top 20, highest first</h2>
          <p className="text-xs mb-3 text-muted-foreground">Machines at top use most energy per runtime hour. Review whether this reflects high-duty operation or inefficiency.</p>
          <div style={{ height: Math.max(180, kwhPerHourRanked.length * 24 + 40) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={kwhPerHourRanked} layout="vertical" margin={{ top: 4, right: 40, left: 60, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
                <XAxis type="number" tick={axisTick} />
                <YAxis dataKey="machine" type="category" tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }} width={60} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${fmt(v)} kWh/hr`, 'kWh/Runtime Hour']} />
                <Bar dataKey="kWhPerHr" name="kWh/Runtime Hour" fill={chartColor(2)} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Machine detail table */}
      {machineMetrics.length > 0 && (
        <div className={cardCls}>
          <h2 className="text-sm font-semibold mb-3 text-foreground">Machine Detail</h2>
          <div className="overflow-x-auto" style={{ maxHeight: 500, overflowY: 'auto' }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card z-10">
                <tr>
                  {['Machine', 'Plant', 'Runtime Hrs', 'Uptime %', 'Total kWh', 'kWh/Hr', 'P1 kWh/Hr', 'P2 kWh/Hr', 'Change %'].map(h =>
                    <th key={h} className="text-[0.7rem] font-bold uppercase tracking-[0.06em] text-muted-foreground px-3 py-2 border-b border-border text-left whitespace-nowrap">{h}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {[...machineMetrics].sort((a, b) => b.kWhPerHr - a.kWhPerHr).map(m => (
                  <tr key={m.machine}>
                    <td className="px-3 py-2 text-[0.8rem] text-foreground border-b border-border font-mono text-xs">{m.machine}</td>
                    <td className="px-3 py-2 text-[0.8rem] text-foreground border-b border-border">{m.plant}</td>
                    <td className="px-3 py-2 text-[0.8rem] text-foreground border-b border-border">{fmt(m.runtimeHrs, 0)}</td>
                    <td className="px-3 py-2 text-[0.8rem] text-foreground border-b border-border">{fmt(m.avgUptimePct, 1)}%</td>
                    <td className="px-3 py-2 text-[0.8rem] text-foreground border-b border-border">{m.totalKWh.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="px-3 py-2 text-[0.8rem] text-foreground border-b border-border font-semibold">{fmt(m.kWhPerHr)}</td>
                    <td className="px-3 py-2 text-[0.8rem] text-muted-foreground border-b border-border">{m.p1KWhPerHr !== null ? fmt(m.p1KWhPerHr) : '—'}</td>
                    <td className="px-3 py-2 text-[0.8rem] text-muted-foreground border-b border-border">{m.p2KWhPerHr !== null ? fmt(m.p2KWhPerHr) : '—'}</td>
                    <td className={`px-3 py-2 text-[0.8rem] border-b border-border font-semibold ${m.changePct === null ? 'text-muted-foreground' : m.changePct <= 0 ? 'text-success' : 'text-danger'}`}>
                      {m.changePct !== null ? `${m.changePct <= 0 ? '' : '+'}${fmt(m.changePct, 1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Methodology */}
      <div className="rounded-lg px-4 py-3 text-xs bg-card border border-border text-muted-foreground">
        <span className="font-semibold text-foreground">Methodology:</span>{' '}
        kWh per runtime hour = daily energy ÷ daily runtime.
        {hasRuntime
          ? ' Runtime from uploaded Guidewheel Trends XLSX (sum of shift runtime hours per device per day). Endpoint: /api/data/runtime.'
          : ' Runtime estimated as 24h minus recorded downtime hours. Upload Guidewheel Trends XLSX to /api/upload for actual values.'}
        {' '}Energy endpoint: /api/data/energy/usage (reads energy_average table — same data as Executive Energy tab). No cost/pricing shown.
      </div>

    </div>
  )
}
