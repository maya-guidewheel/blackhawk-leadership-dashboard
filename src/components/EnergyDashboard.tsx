import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend, LabelList,
} from 'recharts'
import type { EnergyRow, EnergyRates, DeviceSummary, DowntimeEvent, RuntimeRecord } from '../data/types'
import { computeEnergyByMachine, computeEnergyByPlant, getPlantForMachine } from '../data/energyAggregations'
import { axisTick, tooltipStyle, tooltipCursorFill, gridStroke, chartColor } from '../utils/chartTheme'
import { apiFetch } from '../utils/api'
import { normalizeDateOnly, formatServerTimestamp, QUICK_RANGES, quickRange, type QuickRangeKey } from '../utils/dates'
import IdleOfflineReasonMapping from './IdleOfflineReasonMapping'

interface Props {
  avgRows: EnergyRow[]
  deviceData: DeviceSummary[]
  downtimeEvents?: DowntimeEvent[]
  runtimeRecords?: RuntimeRecord[]
  lastUpdated?: string | null
}

// Time-based machine-state totals (hours) for a machine in the selected range,
// summed from Guidewheel Trends data. hasIdleState is false when the imported
// Trends export contains no Idle series (Runtime-only export) — the caller then
// shows "Runtime data needed" instead of a fabricated percentage.
interface RuntimeStateTotals {
  runtimeHrs: number
  idleHrs: number
  offlineHrs: number
  plannedHrs: number
  hasIdleState: boolean
}

// Idle % of Time = idle / (runtime + idle + offline + planned). Returns null when
// idle-state data is unavailable for the machine in range (→ "Runtime data needed").
function idleTimePct(t: RuntimeStateTotals | undefined): number | null {
  if (!t || !t.hasIdleState) return null
  const denom = t.runtimeHrs + t.idleHrs + t.offlineHrs + t.plannedHrs
  if (denom <= 0) return null
  return (t.idleHrs / denom) * 100
}

const DEFAULT_RATES: EnergyRates = { Sparks: 0.09, Addison: 0.10, Mayflower: 0.08 }
const DEFAULT_IDLE_THRESHOLD = 50
const NOISE_FLOOR_KWH = 1

const MACHINE_TYPE_DEFS = [
  { key: 'M', label: 'Molding', color: chartColor(0) },
  { key: 'K', label: 'Kleen Peel', color: chartColor(1) },
  { key: 'L', label: 'Liners', color: chartColor(2) },
] as const

const PLANT_COLORS: Record<string, string> = {
  Addison: chartColor(0),
  Mayflower: chartColor(1),
  Sparks: chartColor(2),
}

const DANGER = 'var(--color-danger)'
const WARN_COLORS = [
  'var(--color-danger)',
  chartColor(4),
  chartColor(5),
  chartColor(6),
  chartColor(7),
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function getMachineType(machine: string): string {
  const u = machine.toUpperCase()
  if (u.includes('M')) return 'M'
  if (u.includes('K')) return 'K'
  if (u.includes('L')) return 'L'
  return 'other'
}

function fmtKWh(n: number) {
  return n >= 1000
    ? `${(n / 1000).toFixed(1)}k kWh`
    : `${Math.round(n).toLocaleString()} kWh`
}

function fmtCostFull(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function fmtDateFull(iso: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    })
  } catch { return iso }
}

function fmtDateShort(iso: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  } catch { return iso }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RateInput({
  label, value, onChange,
}: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="bh-metric-label">
        {label}
      </span>
      <div className="flex items-center gap-1">
        <span className="text-sm font-medium text-muted-foreground">$</span>
        <input
          type="number"
          min="0"
          step="0.001"
          value={value}
          onChange={e => {
            const v = parseFloat(e.target.value)
            if (!isNaN(v) && v >= 0) onChange(v)
          }}
          className="w-20 px-2 py-1 text-sm border border-border rounded text-right font-mono text-foreground"
        />
        <span className="text-xs text-muted-foreground">/kWh</span>
      </div>
    </label>
  )
}

function FilterChip({
  label, active = false, onClear,
}: { label: string; active?: boolean; onClear?: () => void }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[0.7rem] font-semibold ${
        active
          ? 'bg-btn-primary text-btn-primary-foreground'
          : 'bg-btn-primary/10 text-btn-primary'
      }`}
    >
      {label}
      {onClear && (
        <button
          onClick={onClear}
          className="ml-0.5 opacity-70 hover:opacity-100 font-bold leading-none"
          style={{ fontSize: '0.75rem' }}
        >
          ×
        </button>
      )}
    </span>
  )
}

function FilterContext({
  dateFrom, dateTo, plantFilter, selectedMachineTypes, idleThreshold,
}: {
  dateFrom: string
  dateTo: string
  plantFilter: string
  selectedMachineTypes: Set<string>
  idleThreshold?: number
}) {
  const allTypes =
    selectedMachineTypes.has('M') &&
    selectedMachineTypes.has('K') &&
    selectedMachineTypes.has('L')
  const typeLabel = allTypes
    ? 'All Machine Types'
    : MACHINE_TYPE_DEFS.filter(t => selectedMachineTypes.has(t.key)).map(t => t.label).join(', ') || 'None'
  const parts: string[] = [
    dateFrom && dateTo ? `${fmtDateShort(dateFrom)} – ${fmtDateShort(dateTo)}` : '',
    plantFilter === 'All' ? 'All Plants' : plantFilter,
    typeLabel,
    idleThreshold !== undefined ? `Idle threshold: ${idleThreshold} kWh/day` : '',
  ].filter(Boolean)
  return (
    <p className="text-[0.7rem] text-muted-foreground font-normal -mt-2 mb-3">
      {parts.join(' · ')}
    </p>
  )
}

// Rich tooltip for the Idle vs Productive chart — shows machine, plant,
// productive/idle cost & kWh, and the % split, plus the active date range.
function IdleProductiveTooltip({ active, payload, dateRangeLabel }: {
  active?: boolean
  payload?: { payload: { machine: string; plant: string; Productive: number; Idle: number; productivePct: number; idlePct: number; productiveKWh: number; idleKWh: number } }[]
  dateRangeLabel: string
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={tooltipStyle} className="text-xs">
      <div className="font-semibold mb-1">{d.machine} · {d.plant}</div>
      <div>Productive: {fmtCostFull(d.Productive)} ({d.productiveKWh.toLocaleString()} kWh) · <span className="font-semibold">{d.productivePct.toFixed(0)}%</span></div>
      <div>Idle: {fmtCostFull(d.Idle)} ({d.idleKWh.toLocaleString()} kWh) · <span className="font-semibold">{d.idlePct.toFixed(0)}%</span></div>
      <div className="mt-1 opacity-70">Estimated energy cost · {dateRangeLabel}</div>
    </div>
  )
}

// Rich tooltip for the Idle Waste chart. Idle % of Time is TIME-based from
// Guidewheel Trends; kWh/cost come from the energy export. The two data sources
// are labeled so it's clear the % is not derived from energy.
function IdleWasteTooltip({ active, payload, dateRangeLabel }: {
  active?: boolean
  payload?: { payload: { machine: string; plant: string; idleKWh: number; 'Idle Cost': number; idleDays: number; idlePctTime: number | null; runtimeHrs: number | null; idleHrs: number | null; offlineHrs: number | null; plannedHrs: number | null } }[]
  dateRangeLabel: string
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const hasState = d.idlePctTime !== null
  return (
    <div style={tooltipStyle} className="text-xs">
      <div className="font-semibold mb-1">{d.machine} · {d.plant}</div>
      <div className="opacity-70 mb-1">{dateRangeLabel}</div>
      <div>Idle: {d.idleKWh.toLocaleString()} kWh · {fmtCostFull(d['Idle Cost'])} est. · Idle days: {d.idleDays}</div>
      {hasState ? (
        <>
          <div className="mt-1">Runtime: {d.runtimeHrs}h · Idle: {d.idleHrs}h · Offline: {d.offlineHrs}h{d.plannedHrs ? ` · Planned: ${d.plannedHrs}h` : ''}</div>
          <div className="mt-0.5">Idle % of Time (idle ÷ total state time): <span className="font-semibold">{d.idlePctTime!.toFixed(1)}%</span></div>
        </>
      ) : (
        <div className="mt-1 text-warning">Idle % of Time: Runtime state data needed (Trends export has no Idle series)</div>
      )}
      <div className="mt-1 opacity-70">Sources: energy export → kWh/cost · Trends export → runtime/idle/offline %</div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function EnergyDashboard({ avgRows, deviceData, downtimeEvents = [], runtimeRecords = [], lastUpdated = null }: Props) {
  const [rates, setRates] = useState<EnergyRates>(DEFAULT_RATES)
  const [idleThreshold, setIdleThreshold] = useState(DEFAULT_IDLE_THRESHOLD)
  const [showSaveConfirm, setShowSaveConfirm] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')

  // Load persisted assumptions from server on mount; fall back to defaults if none saved.
  useEffect(() => {
    apiFetch('/api/settings/energy')
      .then(r => r.ok ? r.json() : null)
      .then((data: { rates?: EnergyRates; idleThreshold?: number } | null) => {
        if (!data) return
        if (data.rates) setRates(data.rates)
        if (typeof data.idleThreshold === 'number') setIdleThreshold(data.idleThreshold)
      })
      .catch(() => { /* keep defaults */ })
  }, [])

  const handleSaveAssumptions = useCallback(async () => {
    setSaveStatus('saving')
    try {
      const res = await apiFetch('/api/settings/energy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rates, idleThreshold }),
      })
      if (res.ok) {
        setSaveStatus('success')
        setTimeout(() => setSaveStatus('idle'), 4000)
      } else {
        setSaveStatus('error')
      }
    } catch {
      setSaveStatus('error')
    }
    setShowSaveConfirm(false)
  }, [rates, idleThreshold])

  // Compute actual data date range from loaded rows. normalizeDateOnly rejects
  // Excel-epoch garbage (e.g. "1899-12-31") so the range can never start at 1899.
  const validDates = useMemo(
    () => avgRows.map(r => normalizeDateOnly(r.date)).filter((d): d is string => !!d).sort(),
    [avgRows]
  )
  const dataMinDate = validDates[0] ?? ''
  const dataMaxDate = validDates[validDates.length - 1] ?? ''

  // Filter state — initialize to the full VALID data range (never 1899).
  const [dateFrom, setDateFrom] = useState(() => {
    const sorted = avgRows.map(r => normalizeDateOnly(r.date)).filter((d): d is string => !!d).sort()
    return sorted[0] ?? ''
  })
  const [dateTo, setDateTo] = useState(() => {
    const sorted = avgRows.map(r => normalizeDateOnly(r.date)).filter((d): d is string => !!d).sort()
    return sorted[sorted.length - 1] ?? ''
  })
  const [plantFilter, setPlantFilter] = useState('All')
  const [selectedMachineTypes, setSelectedMachineTypes] = useState<Set<string>>(
    () => new Set(['M', 'K', 'L'])
  )

  // Available plants derived from data
  const allPlants = useMemo(() => {
    const plants = new Set(
      avgRows.map(r => getPlantForMachine(r.machine)).filter(p => p !== 'Unknown')
    )
    return ['All', ...Array.from(plants).sort()]
  }, [avgRows])

  // Per-machine Guidewheel Trends state totals (hours) within the selected date
  // range, summed across shifts. This is the SOLE source for Idle % of Time —
  // energy/kWh is never used for the percentage. hasIdleState reflects whether
  // the imported Trends export actually carried an Idle series for that machine.
  const runtimeStateByMachine = useMemo(() => {
    const map = new Map<string, RuntimeStateTotals>()
    for (const r of runtimeRecords) {
      if (!r?.device || !r?.date) continue
      if (dateFrom && r.date < dateFrom) continue
      if (dateTo && r.date > dateTo) continue
      let t = map.get(r.device)
      if (!t) { t = { runtimeHrs: 0, idleHrs: 0, offlineHrs: 0, plannedHrs: 0, hasIdleState: false }; map.set(r.device, t) }
      t.runtimeHrs += r.runtimeHrs ?? 0
      if (r.idleHrs != null) { t.idleHrs += r.idleHrs; t.hasIdleState = true }
      if (r.offlineHrs != null) t.offlineHrs += r.offlineHrs
      if (r.plannedHrs != null) t.plannedHrs += r.plannedHrs
    }
    return map
  }, [runtimeRecords, dateFrom, dateTo])

  // Local validation/debug for the known case: 1K2-01, Jun 1–26. Logs the
  // time-based idle % computed from Trends so it can be compared to the table.
  useEffect(() => {
    if (dateFrom !== '2026-06-01' || dateTo !== '2026-06-26') return
    const t = runtimeStateByMachine.get('1K2-01')
    if (!t) { console.log('[idle-validate] 1K2-01 Jun1–26: no Trends rows imported → "Runtime data needed"'); return }
    const pct = idleTimePct(t)
    console.log('[idle-validate] 1K2-01 Jun1–26:', JSON.stringify({
      runtimeHrs: t.runtimeHrs, idleHrs: t.idleHrs, offlineHrs: t.offlineHrs, plannedHrs: t.plannedHrs,
      hasIdleState: t.hasIdleState, idlePctOfTime: pct === null ? 'Runtime data needed' : pct.toFixed(1) + '%',
    }))
  }, [runtimeStateByMachine, dateFrom, dateTo])

  // Filter rows by date, plant, machine type
  const filteredRows = useMemo(() => {
    const allTypesSelected =
      selectedMachineTypes.has('M') && selectedMachineTypes.has('K') && selectedMachineTypes.has('L')
    return avgRows.filter(row => {
      if (dateFrom && row.date < dateFrom) return false
      if (dateTo && row.date > dateTo) return false
      if (plantFilter !== 'All' && getPlantForMachine(row.machine) !== plantFilter) return false
      if (!allTypesSelected && !selectedMachineTypes.has(getMachineType(row.machine))) return false
      return true
    })
  }, [avgRows, dateFrom, dateTo, plantFilter, selectedMachineTypes])

  // Aggregations using filtered data
  const machineSummaries = useMemo(
    () => computeEnergyByMachine(filteredRows, rates, idleThreshold),
    [filteredRows, rates, idleThreshold]
  )
  const plantSummaries = useMemo(
    () => computeEnergyByPlant(machineSummaries),
    [machineSummaries]
  )

  // Top-level KPIs
  const totalKWh = plantSummaries.reduce((s, p) => s + p.totalKWh, 0)
  const totalCost = plantSummaries.reduce((s, p) => s + p.totalCost, 0)
  const totalIdleCost = plantSummaries.reduce((s, p) => s + p.idleCost, 0)
  const highestCostPlant = plantSummaries[0]
  const mostIdleMachine = [...machineSummaries].sort((a, b) => b.idleCost - a.idleCost)[0]

  // Cross-reference energy with color change data for efficiency section
  const deviceMap = useMemo(() => {
    const m = new Map<string, DeviceSummary>()
    for (const d of deviceData) m.set(d.device, d)
    return m
  }, [deviceData])

  const efficiencyData = useMemo(() => {
    return machineSummaries
      .filter(m => m.totalKWh > 0)
      .map(m => {
        const dev = deviceMap.get(m.machine)
        const changeoverCount = dev?.count ?? 0
        const kWhPerChangeover = changeoverCount > 0 ? m.totalKWh / changeoverCount : null
        const costPerChangeover = changeoverCount > 0 ? m.totalCost / changeoverCount : null
        return { ...m, changeoverCount, kWhPerChangeover, costPerChangeover }
      })
      .filter(m => m.kWhPerChangeover !== null)
      .sort((a, b) => (b.kWhPerChangeover ?? 0) - (a.kWhPerChangeover ?? 0))
      .slice(0, 10)
  }, [machineSummaries, deviceMap])

  const totalColorChangeCost = efficiencyData.reduce((s, m) => s + m.totalCost, 0)
  const totalColorChangeCount = efficiencyData.reduce((s, m) => s + m.changeoverCount, 0)
  const totalColorChangeKWh = efficiencyData.reduce((s, m) => s + m.totalKWh, 0)

  // Filter state flags
  const allTypesSelected =
    selectedMachineTypes.has('M') && selectedMachineTypes.has('K') && selectedMachineTypes.has('L')
  const noDataInDateRange = Boolean(
    dataMinDate && dataMaxDate && avgRows.length > 0 &&
    (dateTo < dataMinDate || dateFrom > dataMaxDate)
  )
  const dateBeforeData = !noDataInDateRange && Boolean(dataMinDate && dateFrom && dateFrom < dataMinDate)
  const dateExceedsData = !noDataInDateRange && Boolean(dataMaxDate && dateTo > dataMaxDate)
  const isFiltered =
    plantFilter !== 'All' ||
    !allTypesSelected ||
    (dataMinDate !== '' && dateFrom !== dataMinDate) ||
    (dataMaxDate !== '' && dateTo !== dataMaxDate)

  function toggleMachineType(type: string) {
    setSelectedMachineTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  function resetFilters() {
    setPlantFilter('All')
    setSelectedMachineTypes(new Set(['M', 'K', 'L']))
    setDateFrom(dataMinDate)
    setDateTo(dataMaxDate)
  }

  function applyQuickRange(key: QuickRangeKey) {
    const { from, to } = quickRange(key, dataMinDate, dataMaxDate)
    setDateFrom(from)
    setDateTo(to)
  }

  if (avgRows.length === 0) return null

  // Chart data preparation
  const top10Idle = [...machineSummaries]
    .sort((a, b) => b.idleCost - a.idleCost)
    .filter(m => m.idleCost > 0)
    .slice(0, 10)

  const plantChartData = plantSummaries.map(p => ({
    plant: p.plant,
    'Total Cost': Math.round(p.totalCost),
    'Idle Waste': Math.round(p.idleCost),
  }))

  // All machines (not capped at 15) for full labeling
  const allMachineChartData = machineSummaries.map(m => ({
    machine: m.machine,
    cost: Math.round(m.totalCost),
    plant: m.plant,
  }))

  const idleChartData = top10Idle.map(m => {
    const t = runtimeStateByMachine.get(m.machine)
    return {
      machine: m.machine,
      'Idle Cost': parseFloat(m.idleCost.toFixed(2)),
      plant: m.plant,
      idleKWh: Math.round(m.idleKWh),
      idleDays: m.idleDays,
      // Time-based metric from Trends (null → "Runtime data needed").
      idlePctTime: idleTimePct(t),
      runtimeHrs: t ? Math.round(t.runtimeHrs) : null,
      idleHrs: t && t.hasIdleState ? Math.round(t.idleHrs) : null,
      offlineHrs: t && t.hasIdleState ? Math.round(t.offlineHrs) : null,
      plannedHrs: t && t.hasIdleState ? Math.round(t.plannedHrs) : null,
    }
  })

  // Idle vs productive stacked breakdown (top 20 by cost), with % split per machine
  const breakdownChartData = machineSummaries
    .filter(m => m.totalKWh > 0)
    .slice(0, 20)
    .map(m => {
      const productive = Math.round(m.totalCost - m.idleCost)
      const idle = Math.round(m.idleCost)
      // Percentages come from UNROUNDED kWh (idle kWh / total kWh) so the chart
      // labels are exact and match the Idle Energy Waste table below 1:1.
      const idlePct = m.totalKWh > 0 ? (m.idleKWh / m.totalKWh) * 100 : 0
      const productivePct = m.totalKWh > 0 ? (m.productionKWh / m.totalKWh) * 100 : 0
      return {
        machine: m.machine,
        Productive: productive,
        Idle: idle,
        plant: m.plant,
        productivePct,
        idlePct,
        productiveKWh: Math.round(m.totalKWh - m.idleKWh),
        idleKWh: Math.round(m.idleKWh),
      }
    })

  // Dynamic chart heights
  const machineChartHeight = Math.max(400, allMachineChartData.length * 26)
  const breakdownChartHeight = Math.max(400, breakdownChartData.length * 28)

  const inputClass = 'border border-border rounded px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 bg-card'
  const labelClass = 'bh-metric-label mb-1 block'

  return (
    <section className="mb-10">

      {/* ── Section header ── */}
      <div className="mb-5">
        <h2 className="text-lg font-bold tracking-wide flex items-center gap-2 text-foreground mb-1">
          <span
            className="bg-btn-primary"
            style={{
              display: 'inline-block', width: 4, height: '1.2em',
              borderRadius: 2,
            }}
          />
          Executive Energy + Cost Analysis
        </h2>
        <FilterContext
          dateFrom={dateFrom}
          dateTo={dateTo}
          plantFilter={plantFilter}
          selectedMachineTypes={selectedMachineTypes}
          idleThreshold={idleThreshold}
        />
      </div>

      {/* ── Filter Bar ── */}
      <div className="bh-card mb-5 overflow-hidden border-l-[3px] border-l-btn-primary">
        {/* Active filter summary row */}
        <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 bg-btn-primary/5 border-b border-btn-primary/15">
          <div className="flex items-center gap-2">
            <span className="bh-metric-label text-btn-primary">
              Active Filters
            </span>
            {isFiltered && (
              <button
                onClick={resetFilters}
                className="text-[0.65rem] font-semibold underline ml-1 text-muted-foreground"
              >
                Reset all
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterChip label={`${fmtDateShort(dateFrom)} – ${fmtDateShort(dateTo)}`} />
            <FilterChip
              label={plantFilter === 'All' ? 'All Plants' : plantFilter}
              active={plantFilter !== 'All'}
              onClear={plantFilter !== 'All' ? () => setPlantFilter('All') : undefined}
            />
            {MACHINE_TYPE_DEFS.map(t => (
              <FilterChip
                key={t.key}
                label={t.label}
                active={selectedMachineTypes.has(t.key)}
                onClear={selectedMachineTypes.has(t.key) ? () => toggleMachineType(t.key) : undefined}
              />
            ))}
          </div>
        </div>

        {/* Quick ranges */}
        <div className="px-4 pt-3 flex flex-wrap items-center gap-1.5">
          <span className="bh-metric-label mr-1">Quick range</span>
          {QUICK_RANGES.map(q => (
            <button
              key={q.key}
              onClick={() => applyQuickRange(q.key)}
              className="text-[0.7rem] font-semibold px-2.5 py-1 rounded-md border border-border bg-card text-muted-foreground hover:bg-background-accent hover:text-foreground transition-colors"
            >
              {q.label}
            </button>
          ))}
          {dataMinDate && (
            <span className="text-[0.7rem] text-muted-foreground ml-auto">
              Available data: {dataMinDate} to {dataMaxDate}
            </span>
          )}
        </div>

        {/* Filter inputs */}
        <div className="px-4 py-3 flex flex-wrap gap-5 items-end">
          <div>
            <label className={labelClass}>From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className={inputClass}
              min={dataMinDate || undefined}
              max={dataMaxDate || undefined}
            />
          </div>
          <div>
            <label className={labelClass}>To</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className={inputClass}
              min={dataMinDate || undefined}
              max={dataMaxDate || undefined}
            />
          </div>
          <div>
            <label className={labelClass}>Plant</label>
            <select
              value={plantFilter}
              onChange={e => setPlantFilter(e.target.value)}
              className={inputClass}
            >
              {allPlants.map(p => (
                <option key={p} value={p}>{p === 'All' ? 'All Plants' : p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Machine Type</label>
            <div className="flex gap-4 py-1">
              {MACHINE_TYPE_DEFS.map(t => (
                <label
                  key={t.key}
                  className="flex items-center gap-1.5 cursor-pointer text-sm select-none text-foreground"
                >
                  <input
                    type="checkbox"
                    checked={selectedMachineTypes.has(t.key)}
                    onChange={() => toggleMachineType(t.key)}
                    className="rounded"
                  />
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ background: t.color }}
                  />
                  <span>{t.label} <span className="font-mono text-xs opacity-60">({t.key})</span></span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Data Coverage Banner ── */}
      <div className="bh-card mb-5 p-3 flex items-start gap-3 border-l-4 border-l-btn-primary bg-btn-primary/5">
        <svg className="shrink-0 mt-0.5 text-btn-primary" width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">
            Available data: {fmtDateFull(dataMinDate)} – {fmtDateFull(dataMaxDate)}
          </div>
          <div className="text-xs mt-0.5 text-muted-foreground">
            Displaying {filteredRows.length.toLocaleString()} of {avgRows.length.toLocaleString()} energy readings
            across {machineSummaries.length} machine{machineSummaries.length !== 1 ? 's' : ''}
          </div>
          <div className="text-[0.7rem] mt-1 text-muted-foreground">
            Data current through <span className="font-medium text-foreground">{fmtDateShort(dataMaxDate)}</span>
            {lastUpdated && <> · Last sync {formatServerTimestamp(lastUpdated)}</>}
            {' '}· Manual weekly updates until automated integration is live
          </div>
          {noDataInDateRange && (
            <div className="mt-2 text-xs font-semibold px-2.5 py-1.5 rounded bg-danger/10 text-danger">
              No energy data available for the selected date range. Available energy data is {fmtDateFull(dataMinDate)} to {fmtDateFull(dataMaxDate)}.
            </div>
          )}
          {dateBeforeData && (
            <div className="mt-2 text-xs px-2.5 py-1.5 rounded bg-warning/10 text-warning">
              ⚠ Selected start date is before available energy data. Displayed values begin on {fmtDateFull(dataMinDate)}.
            </div>
          )}
          {dateExceedsData && (
            <div className="mt-2 text-xs px-2.5 py-1.5 rounded bg-warning/10 text-warning">
              ⚠ Selected end date is after latest uploaded energy data. Displayed values only reflect data through {fmtDateFull(dataMaxDate)}.
            </div>
          )}
        </div>
      </div>

      {/* ── Rate Inputs + Idle Threshold ── */}
      <div className="bh-card p-4 mb-5">
        <p className="bh-metric-label mb-3">
          Estimated industrial energy rates (editable)
        </p>
        <div className="flex flex-wrap gap-6 items-end">
          <RateInput
            label="Sparks, Nevada"
            value={rates.Sparks}
            onChange={v => setRates(r => ({ ...r, Sparks: v }))}
          />
          <RateInput
            label="Addison, Illinois"
            value={rates.Addison}
            onChange={v => setRates(r => ({ ...r, Addison: v }))}
          />
          <RateInput
            label="Mayflower, Arkansas"
            value={rates.Mayflower}
            onChange={v => setRates(r => ({ ...r, Mayflower: v }))}
          />
          <label className="flex flex-col gap-1">
            <span className="bh-metric-label">
              Idle Threshold
            </span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="1"
                step="10"
                value={idleThreshold}
                onChange={e => {
                  const v = parseFloat(e.target.value)
                  if (!isNaN(v) && v > 0) setIdleThreshold(v)
                }}
                className="w-20 px-2 py-1 text-sm border border-border rounded text-right font-mono text-foreground"
              />
              <span className="text-xs text-muted-foreground">kWh/day</span>
            </div>
          </label>
        </div>

        {/* Save button */}
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={() => { setSaveStatus('idle'); setShowSaveConfirm(true) }}
            className="px-4 py-1.5 text-sm rounded bg-btn-primary text-btn-primary-foreground hover:bg-btn-primary-accent font-medium"
          >
            Save for everyone
          </button>
          {saveStatus === 'success' && (
            <span className="text-xs font-semibold text-success">Energy assumptions saved for all users.</span>
          )}
          {saveStatus === 'error' && (
            <span className="text-xs font-semibold text-danger">Unable to save energy assumptions. Please try again.</span>
          )}
        </div>

        {/* Idle threshold explainer */}
        <div className="mt-4 p-3 rounded-lg text-xs bg-background-accent border border-border">
          <p className="font-semibold mb-2 text-foreground">
            How the idle threshold works — current setting: {idleThreshold} kWh/day
          </p>
          <div className="space-y-1 text-muted-foreground">
            <div className="flex items-start gap-2">
              <span className="font-bold mt-0.5 text-success">●</span>
              <span>
                <strong className="text-foreground">Productive / Online:</strong>{' '}
                ≥ {idleThreshold} kWh/day — machine is running active production
              </span>
            </div>
            <div className="flex items-start gap-2">
              <span className="font-bold mt-0.5 text-danger">●</span>
              <span>
                <strong className="text-foreground">Idle:</strong>{' '}
                {NOISE_FLOOR_KWH}–{idleThreshold} kWh/day — machine is powered on but not producing
                (counted as idle waste)
              </span>
            </div>
            <div className="flex items-start gap-2">
              <span className="font-bold mt-0.5 opacity-40">○</span>
              <span>
                <strong className="text-foreground">Offline / Excluded:</strong>{' '}
                &lt; {NOISE_FLOOR_KWH} kWh/day — below noise floor, excluded from analysis
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── A. Executive Summary KPIs ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <div className="bh-card p-4">
          <div className="bh-metric-label mb-2">
            Total Energy Consumed
          </div>
          <div className="text-2xl font-bold leading-none text-foreground">
            {fmtKWh(totalKWh)}
          </div>
          <div className="text-xs mt-1 text-muted-foreground">
            {machineSummaries.length} machines
          </div>
        </div>

        <div className="bh-card p-4">
          <div className="bh-metric-label mb-2">
            Total Estimated Cost
          </div>
          <div className="text-2xl font-bold leading-none text-btn-primary">
            {fmtCostFull(totalCost)}
          </div>
          <div className="text-xs mt-1 text-muted-foreground">all plants</div>
        </div>

        <div className="bh-card p-4 border-l-[3px] border-l-danger">
          <div className="bh-metric-label mb-2">
            Est. Idle Energy Waste
          </div>
          <div className="text-2xl font-bold leading-none text-danger">
            {fmtCostFull(totalIdleCost)}
          </div>
          <div className="text-xs mt-1 text-muted-foreground">
            {totalCost > 0 ? `${((totalIdleCost / totalCost) * 100).toFixed(1)}% of total cost` : '—'}
          </div>
        </div>

        <div className="bh-card p-4">
          <div className="bh-metric-label mb-2">
            Highest Cost Plant
          </div>
          {highestCostPlant ? (
            <>
              <div className="text-xl font-bold leading-none text-foreground">
                {highestCostPlant.plant}
              </div>
              <div className="text-xs mt-1 font-semibold text-btn-primary">
                {fmtCostFull(highestCostPlant.totalCost)}
              </div>
            </>
          ) : <div className="text-xl font-bold">—</div>}
        </div>

        <div className="bh-card p-4">
          <div className="bh-metric-label mb-2">
            Most Idle Waste
          </div>
          {mostIdleMachine ? (
            <>
              <div className="text-base font-bold leading-none text-foreground">
                {mostIdleMachine.machine}
              </div>
              <div className="text-xs mt-1 font-semibold text-danger">
                {fmtCostFull(mostIdleMachine.idleCost)} idle
              </div>
              <div className="text-xs text-muted-foreground">
                {mostIdleMachine.plant}
              </div>
            </>
          ) : <div className="text-xl font-bold">—</div>}
        </div>
      </div>

      {/* ── B. Energy Cost by Plant ── */}
      <section className="mb-6">
        <h3 className="bh-section-title mb-1">Energy Cost by Plant</h3>
        <FilterContext
          dateFrom={dateFrom}
          dateTo={dateTo}
          plantFilter={plantFilter}
          selectedMachineTypes={selectedMachineTypes}
        />
        <div className="grid lg:grid-cols-2 gap-4">
          {/* Table — left; table is the primary executive view */}
          <div className="bh-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="bh-table" style={{ fontSize: '0.875rem' }}>
                <thead>
                  <tr className="text-left">
                    <th>Plant</th>
                    <th className="text-right">Machines</th>
                    <th className="text-right">Total kWh</th>
                    <th className="text-right">Total Cost</th>
                    <th className="text-right">Idle Waste</th>
                    <th className="text-right">Idle %</th>
                    <th className="text-right">Avg / Machine</th>
                  </tr>
                </thead>
                <tbody>
                  {plantSummaries.map(p => (
                    <tr key={p.plant}>
                      <td>
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full mr-2"
                          style={{ background: PLANT_COLORS[p.plant] ?? 'var(--color-muted-foreground)' }}
                        />
                        <span className="font-semibold">{p.plant}</span>
                      </td>
                      <td className="text-right">{p.machineCount}</td>
                      <td className="text-right">{Math.round(p.totalKWh).toLocaleString()}</td>
                      <td className="text-right font-semibold text-btn-primary">
                        {fmtCostFull(p.totalCost)}
                      </td>
                      <td className={`text-right ${p.idleCost > 0 ? 'text-danger' : ''}`}>
                        {fmtCostFull(p.idleCost)}
                      </td>
                      <td className={`text-right font-semibold ${p.idleCost > 0 ? 'text-danger' : 'text-muted-foreground'}`}>
                        {p.totalCost > 0
                          ? `${((p.idleCost / p.totalCost) * 100).toFixed(1)}%`
                          : '—'}
                      </td>
                      <td className="text-right">{fmtCostFull(p.avgCostPerMachine)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Chart — right */}
          <div className="bh-card p-4">
            <p className="bh-metric-label mb-3">
              Cost Breakdown by Plant ($)
            </p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={plantChartData} barCategoryGap="35%">
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                <XAxis
                  dataKey="plant"
                  tick={axisTick}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={axisTick}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(v: number) => fmtCostFull(v)}
                  contentStyle={tooltipStyle}
                  cursor={{ fill: tooltipCursorFill }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Total Cost" fill={chartColor(0)} radius={[4, 4, 0, 0]} />
                <Bar dataKey="Idle Waste" fill="var(--color-danger)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* ── C. Energy Cost by Machine — All machines labeled ── */}
      <section className="mb-6">
        <h3 className="bh-section-title mb-1">
          Energy Cost by Machine
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            ({allMachineChartData.length} machines)
          </span>
        </h3>
        <FilterContext
          dateFrom={dateFrom}
          dateTo={dateTo}
          plantFilter={plantFilter}
          selectedMachineTypes={selectedMachineTypes}
        />
        <div className="bh-card p-4">
          <ResponsiveContainer width="100%" height={machineChartHeight}>
            <BarChart
              data={allMachineChartData}
              layout="vertical"
              margin={{ left: 20, right: 30, top: 4, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
              <XAxis
                type="number"
                tick={axisTick}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => `$${(v / 1000).toFixed(1)}k`}
              />
              <YAxis
                type="category"
                dataKey="machine"
                tick={{ ...axisTick, fill: 'var(--color-foreground)' }}
                axisLine={false}
                tickLine={false}
                width={80}
              />
              <Tooltip
                formatter={(v: number) => [fmtCostFull(v), 'Est. Cost']}
                contentStyle={tooltipStyle}
                cursor={{ fill: tooltipCursorFill }}
              />
              <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
                {allMachineChartData.map((entry, idx) => (
                  <Cell
                    key={entry.machine}
                    fill={idx < 5 ? WARN_COLORS[idx] : chartColor(0)}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[0.65rem] mt-2 text-muted-foreground">
            Top 5 highlighted in red-orange. Based on average active power × days in selected period.
          </p>
        </div>
      </section>

      {/* ── D. Idle vs. Productive Energy Cost by Machine ── */}
      {breakdownChartData.length > 0 && (
        <section className="mb-6">
          <h3 className="bh-section-title mb-1">
            Idle vs. Productive Energy Cost by Machine
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              top {breakdownChartData.length} by cost
            </span>
          </h3>
          <FilterContext
            dateFrom={dateFrom}
            dateTo={dateTo}
            plantFilter={plantFilter}
            selectedMachineTypes={selectedMachineTypes}
          />
          <div className="bh-card p-4">
            <p className="text-xs mb-4 text-muted-foreground">
              Stacked view of productive (blue) vs. idle (red) estimated energy cost per machine.
              Each bar is labeled with its % productive / % idle split; hover for kWh and cost detail.
              Machines with significant idle portions represent energy recovery opportunities.
            </p>
            <ResponsiveContainer width="100%" height={breakdownChartHeight}>
              <BarChart
                data={breakdownChartData}
                layout="vertical"
                margin={{ left: 20, right: 56, top: 4, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
                <XAxis
                  type="number"
                  tick={axisTick}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => `$${(v / 1000).toFixed(1)}k`}
                />
                <YAxis
                  type="category"
                  dataKey="machine"
                  tick={{ ...axisTick, fill: 'var(--color-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                  width={80}
                />
                <Tooltip
                  content={<IdleProductiveTooltip dateRangeLabel={`${fmtDateShort(dateFrom)} – ${fmtDateShort(dateTo)}`} />}
                  cursor={{ fill: tooltipCursorFill }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Productive" stackId="a" fill={chartColor(0)}>
                  {/* % productive inside the segment when it's wide enough to be legible */}
                  <LabelList
                    dataKey="productivePct"
                    position="center"
                    content={(props: { x?: string | number; y?: string | number; width?: string | number; height?: string | number; value?: string | number }) => {
                      const { x, y, width, height, value } = props
                      const w = Number(width)
                      const pct = Number(value)
                      if (!Number.isFinite(pct) || pct <= 0 || w < 34) return null
                      return (
                        <text x={Number(x) + w / 2} y={Number(y) + Number(height) / 2} fill="#fff" fontSize={10} fontWeight={600} textAnchor="middle" dominantBaseline="central">
                          {pct.toFixed(0)}%
                        </text>
                      )
                    }}
                  />
                </Bar>
                <Bar dataKey="Idle" stackId="a" fill={DANGER} radius={[0, 4, 4, 0]}>
                  {/* % idle: inside if wide enough, otherwise just outside the bar end */}
                  <LabelList
                    dataKey="idlePct"
                    content={(props: { x?: string | number; y?: string | number; width?: string | number; height?: string | number; value?: string | number }) => {
                      const { x, y, width, height, value } = props
                      const w = Number(width)
                      const pct = Number(value)
                      if (!Number.isFinite(pct) || pct <= 0) return null
                      const inside = w >= 34
                      const cx = inside ? Number(x) + w / 2 : Number(x) + w + 4
                      return (
                        <text x={cx} y={Number(y) + Number(height) / 2} fill={inside ? '#fff' : 'var(--color-danger)'} fontSize={10} fontWeight={600} textAnchor={inside ? 'middle' : 'start'} dominantBaseline="central">
                          {pct.toFixed(0)}%
                        </text>
                      )
                    }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* ── E. Idle Energy Waste ── */}
      <section className="mb-6">
        <h3 className="bh-section-title mb-1">Idle Energy Waste</h3>
        <FilterContext
          dateFrom={dateFrom}
          dateTo={dateTo}
          plantFilter={plantFilter}
          selectedMachineTypes={selectedMachineTypes}
          idleThreshold={idleThreshold}
        />
        <div className="bh-card p-3 mb-4 flex items-center gap-3 border-l-4 border-l-danger bg-danger/5">
          <span className="text-2xl font-bold text-danger">
            {fmtCostFull(totalIdleCost)}
          </span>
          <div>
            <div className="text-sm font-semibold text-danger">
              Estimated Idle Energy Waste
            </div>
            <div className="text-xs text-muted-foreground">
              Machines drawing {NOISE_FLOOR_KWH}–{idleThreshold} kWh/day without active
              production · idle threshold: {idleThreshold} kWh/day
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          {/* Chart */}
          <div className="bh-card p-4">
            <p className="bh-metric-label mb-3">
              Idle Waste by Machine — Top 10 ($)
            </p>
            {top10Idle.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={idleChartData}
                  layout="vertical"
                  margin={{ left: 20, right: 20, top: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
                  <XAxis
                    type="number"
                    tick={axisTick}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={v => `$${v.toFixed(0)}`}
                  />
                  <YAxis
                    type="category"
                    dataKey="machine"
                    tick={{ ...axisTick, fill: 'var(--color-foreground)' }}
                    axisLine={false}
                    tickLine={false}
                    width={80}
                  />
                  <Tooltip
                    content={<IdleWasteTooltip dateRangeLabel={`${fmtDateShort(dateFrom)} – ${fmtDateShort(dateTo)}`} />}
                    cursor={{ fill: tooltipCursorFill }}
                  />
                  <Bar dataKey="Idle Cost" fill={DANGER} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-center py-10 text-muted-foreground">
                No idle waste detected at current threshold ({idleThreshold} kWh/day).
              </p>
            )}
          </div>

          {/* Table */}
          <div className="bh-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="bh-table">
                <thead>
                  <tr className="text-left">
                    <th>Machine</th>
                    <th>Plant</th>
                    <th className="text-right">Idle kWh</th>
                    <th className="text-right">Idle Cost</th>
                    <th className="text-right" title="Number of days this machine drew idle-level power (at least one idle period). Not 24-hour idle blocks.">Idle Days ⓘ</th>
                    <th className="text-right" title="Idle time divided by total classified machine state time for the selected date range, using the same Runtime / Idle / Offline state logic shown in Guidewheel Trends. This is time-based, not kWh-based.">Idle % of Time ⓘ</th>
                  </tr>
                </thead>
                <tbody>
                  {top10Idle.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center text-muted-foreground">
                        No idle waste at current threshold
                      </td>
                    </tr>
                  ) : top10Idle.map((m, idx) => {
                    // Time-based, from Guidewheel Trends state hours (NOT kWh).
                    // null → the Trends export carried no Idle series for this machine.
                    const pct = idleTimePct(runtimeStateByMachine.get(m.machine))
                    return (
                    <tr key={m.machine}>
                      <td>
                        <span className={`font-semibold ${idx < 3 ? 'text-danger' : ''}`}>
                          {m.machine}
                        </span>
                      </td>
                      <td className="text-muted-foreground">{m.plant}</td>
                      <td className="text-right">{Math.round(m.idleKWh).toLocaleString()}</td>
                      <td className={`text-right font-semibold ${idx < 3 ? 'text-danger' : ''}`}>
                        {fmtCostFull(m.idleCost)}
                      </td>
                      <td className="text-right">{m.idleDays}</td>
                      <td className="text-right">
                        {pct === null ? (
                          <span className="text-muted-foreground" title="Guidewheel Trends runtime/idle/offline state data is not available for this machine and range.">Runtime data needed</span>
                        ) : (
                          `${pct.toFixed(1)}%`
                        )}
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <p className="text-xs mt-3 text-muted-foreground">
          <span className="font-semibold text-foreground">Methodology:</span> Idle kWh and idle cost are estimated from energy readings
          using the configured idle threshold. Idle % of Time is calculated separately from Guidewheel Trends runtime data as idle time
          divided by total classified machine state time (Runtime + Idle + Offline{' '}
          + Planned when present) in the selected range. It is not calculated from kWh. Idle Days = days with at least one idle-level
          energy period, not full-day idle blocks. If the imported Trends export has no Idle/Offline state series for a machine, its
          Idle % of Time shows “Runtime data needed”.
        </p>
      </section>

      {/* ── F. Energy vs. Production Efficiency ── */}
      {efficiencyData.length > 0 && (
        <section className="mb-6">
          <h3 className="bh-section-title mb-1">Energy vs. Production Efficiency — Color Change Machines</h3>
          <FilterContext
            dateFrom={dateFrom}
            dateTo={dateTo}
            plantFilter={plantFilter}
            selectedMachineTypes={selectedMachineTypes}
          />

          {/* Executive insight card */}
          {totalColorChangeCount > 0 && (
            <div className="bh-card p-4 mb-4 border-l-4 border-l-btn-primary bg-btn-primary/5">
              <div className="text-sm font-semibold mb-2 text-btn-primary">
                Color Change Energy Impact
              </div>
              <div className="flex flex-wrap items-baseline gap-3 mb-2">
                <span className="text-3xl font-bold text-foreground">
                  {totalColorChangeCount.toLocaleString()}
                </span>
                <span className="text-base text-muted-foreground">
                  color changes consumed approximately
                </span>
                <span className="text-2xl font-bold text-btn-primary">
                  {fmtCostFull(totalColorChangeCost)}
                </span>
                <span className="text-base text-muted-foreground">
                  in energy ({fmtKWh(totalColorChangeKWh)})
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                Across {efficiencyData.length} color-change machines in the selected period.
                Cost reflects total machine energy consumption (not changeover time only).
                Changeover counts use the Changeover tab's current date filter.
              </div>
            </div>
          )}

          <div className="bh-card p-4">
            <p className="text-xs mb-4 text-muted-foreground">
              kWh consumed per color change event — machines with high values use more energy
              relative to production output. Only color-change machines with recorded events shown.
            </p>
            <ResponsiveContainer width="100%" height={Math.max(260, efficiencyData.length * 30)}>
              <BarChart
                data={efficiencyData.map(m => ({
                  machine: m.machine,
                  'kWh / Change': Math.round(m.kWhPerChangeover ?? 0),
                  plant: m.plant,
                }))}
                layout="vertical"
                margin={{ left: 20, right: 30, top: 4, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
                <XAxis
                  type="number"
                  tick={axisTick}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="machine"
                  tick={{ ...axisTick, fill: 'var(--color-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                  width={80}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  cursor={{ fill: tooltipCursorFill }}
                />
                <Bar dataKey="kWh / Change" fill={chartColor(0)} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>

            {/* Efficiency detail table with cost per changeover */}
            <div className="mt-5 overflow-x-auto">
              <p className="bh-metric-label mb-2">
                Machine Efficiency Detail
              </p>
              <table className="bh-table">
                <thead>
                  <tr className="text-left">
                    <th>Machine</th>
                    <th>Plant</th>
                    <th className="text-right">Changes</th>
                    <th className="text-right">Total kWh</th>
                    <th className="text-right">Total Cost</th>
                    <th className="text-right">kWh / Change</th>
                    <th className="text-right">$ / Change</th>
                  </tr>
                </thead>
                <tbody>
                  {efficiencyData.map(m => (
                    <tr key={m.machine}>
                      <td className="font-semibold">{m.machine}</td>
                      <td className="text-muted-foreground">{m.plant}</td>
                      <td className="text-right">{m.changeoverCount}</td>
                      <td className="text-right">{Math.round(m.totalKWh).toLocaleString()}</td>
                      <td className="text-right font-semibold text-btn-primary">
                        {fmtCostFull(m.totalCost)}
                      </td>
                      <td className="text-right">
                        {Math.round(m.kWhPerChangeover ?? 0).toLocaleString()}
                      </td>
                      <td className="text-right font-semibold text-btn-primary">
                        {m.costPerChangeover ? fmtCostFull(m.costPerChangeover) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ── G. Idle vs Offline Reason-Code Mapping (bottom of tab) ── */}
      <IdleOfflineReasonMapping
        downtimeEvents={downtimeEvents}
        energyRows={avgRows}
        idleThreshold={idleThreshold}
        noiseFloor={NOISE_FLOOR_KWH}
        dateFrom={dateFrom}
        dateTo={dateTo}
        plantFilter={plantFilter}
        selectedMachineTypes={selectedMachineTypes}
      />

      {/* ── Save Confirmation Dialog ── */}
      {showSaveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bh-card p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-base font-semibold mb-2 text-foreground">
              Save updated energy assumptions?
            </h3>
            <p className="text-sm text-muted-foreground mb-5">
              These rates and idle threshold will be used for everyone viewing this dashboard.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowSaveConfirm(false)}
                className="px-4 py-2 text-sm border border-border rounded text-foreground hover:bg-background-accent"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAssumptions}
                disabled={saveStatus === 'saving'}
                className="px-4 py-2 text-sm rounded bg-btn-primary text-btn-primary-foreground hover:bg-btn-primary-accent disabled:opacity-60 font-medium"
              >
                {saveStatus === 'saving' ? 'Saving…' : 'Save for everyone'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
