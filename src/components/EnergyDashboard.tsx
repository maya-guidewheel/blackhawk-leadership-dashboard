import { useState, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from 'recharts'
import type { EnergyRow, EnergyRates, DeviceSummary } from '../data/types'
import { computeEnergyByMachine, computeEnergyByPlant, getPlantForMachine } from '../data/energyAggregations'
import { axisTick, tooltipStyle, tooltipCursorFill, gridStroke, chartColor } from '../utils/chartTheme'

interface Props {
  avgRows: EnergyRow[]
  deviceData: DeviceSummary[]
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

// ── Main Component ────────────────────────────────────────────────────────────

export default function EnergyDashboard({ avgRows, deviceData }: Props) {
  const [rates, setRates] = useState<EnergyRates>(DEFAULT_RATES)
  const [idleThreshold, setIdleThreshold] = useState(DEFAULT_IDLE_THRESHOLD)

  // Compute actual data date range once from loaded rows
  const { dataMinDate, dataMaxDate } = useMemo(() => {
    const sorted = avgRows.map(r => r.date).filter(Boolean).sort()
    return { dataMinDate: sorted[0] ?? '', dataMaxDate: sorted[sorted.length - 1] ?? '' }
  }, [avgRows])

  // Filter state — initialize from actual data range via lazy initializers
  const [dateFrom, setDateFrom] = useState(() => {
    const sorted = avgRows.map(r => r.date).filter(Boolean).sort()
    return sorted[0] ?? ''
  })
  const [dateTo, setDateTo] = useState(() => {
    const sorted = avgRows.map(r => r.date).filter(Boolean).sort()
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
  const dateExceedsData = Boolean(dataMaxDate && dateTo > dataMaxDate)
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

  const idleChartData = top10Idle.map(m => ({
    machine: m.machine,
    'Idle Cost': parseFloat(m.idleCost.toFixed(2)),
    plant: m.plant,
  }))

  // Idle vs productive stacked breakdown (top 20 by cost)
  const breakdownChartData = machineSummaries
    .filter(m => m.totalKWh > 0)
    .slice(0, 20)
    .map(m => ({
      machine: m.machine,
      Productive: Math.round(m.totalCost - m.idleCost),
      Idle: Math.round(m.idleCost),
      plant: m.plant,
    }))

  // Dynamic chart heights
  const machineChartHeight = Math.max(400, allMachineChartData.length * 26)
  const breakdownChartHeight = Math.max(400, breakdownChartData.length * 28)

  const inputClass = 'border border-border rounded px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 bg-card'
  const labelClass = 'bh-metric-label mb-1 block'

  return (
    <section className="mb-10">

      {/* ── Section header ── */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-bold tracking-wide flex items-center gap-2 text-foreground">
          <span
            className="bg-btn-primary"
            style={{
              display: 'inline-block', width: 4, height: '1.2em',
              borderRadius: 2,
            }}
          />
          Executive Energy + Cost Analysis
          {(dateFrom || dateTo) && (
            <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-btn-primary/10 text-btn-primary">
              {fmtDateShort(dateFrom)} – {fmtDateShort(dateTo)}
            </span>
          )}
        </h2>
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

        {/* Filter inputs */}
        <div className="px-4 py-3 flex flex-wrap gap-5 items-end">
          <div>
            <label className={labelClass}>From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>To</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className={inputClass}
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
            Data current through: {fmtDateFull(dataMaxDate)}
          </div>
          <div className="text-xs mt-0.5 text-muted-foreground">
            Displaying {filteredRows.length.toLocaleString()} of {avgRows.length.toLocaleString()} energy readings
            across {machineSummaries.length} machine{machineSummaries.length !== 1 ? 's' : ''}
          </div>
          {dateExceedsData && (
            <div className="mt-2 text-xs font-semibold px-2.5 py-1.5 rounded bg-warning/10 text-warning">
              ⚠ Selected end date extends beyond available data. Displayed values only reflect
              data loaded through {fmtDateFull(dataMaxDate)}.
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
        <h3 className="bh-section-title">Energy Cost by Plant</h3>
        <div className="grid lg:grid-cols-2 gap-4">
          {/* Chart */}
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

          {/* Table — with idle % column */}
          <div className="bh-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="bh-table">
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
        </div>
      </section>

      {/* ── C. Energy Cost by Machine — All machines labeled ── */}
      <section className="mb-6">
        <h3 className="bh-section-title">
          Energy Cost by Machine
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            ({allMachineChartData.length} machines)
          </span>
        </h3>
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
          <h3 className="bh-section-title">
            Idle vs. Productive Energy Cost by Machine
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              top {breakdownChartData.length} by cost
            </span>
          </h3>
          <div className="bh-card p-4">
            <p className="text-xs mb-4 text-muted-foreground">
              Stacked view of productive (blue) vs. idle (red) energy cost per machine.
              Machines with significant idle portions represent energy recovery opportunities.
            </p>
            <ResponsiveContainer width="100%" height={breakdownChartHeight}>
              <BarChart
                data={breakdownChartData}
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
                  formatter={(v: number, name: string) => [fmtCostFull(v), name]}
                  contentStyle={tooltipStyle}
                  cursor={{ fill: tooltipCursorFill }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Productive" stackId="a" fill={chartColor(0)} />
                <Bar dataKey="Idle" stackId="a" fill={DANGER} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* ── E. Idle Energy Waste ── */}
      <section className="mb-6">
        <h3 className="bh-section-title">Idle Energy Waste</h3>
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
                    formatter={(v: number) => [fmtCostFull(v), 'Idle Cost']}
                    contentStyle={tooltipStyle}
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
                    <th className="text-right">Idle Days</th>
                    <th className="text-right">% of Total</th>
                  </tr>
                </thead>
                <tbody>
                  {top10Idle.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center text-muted-foreground">
                        No idle waste at current threshold
                      </td>
                    </tr>
                  ) : top10Idle.map((m, idx) => (
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
                        {m.totalKWh > 0
                          ? `${((m.idleKWh / m.totalKWh) * 100).toFixed(1)}%`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* ── F. Energy vs. Production Efficiency ── */}
      {efficiencyData.length > 0 && (
        <section className="mb-6">
          <h3 className="bh-section-title">Energy vs. Production Efficiency — Color Change Machines</h3>

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
    </section>
  )
}
