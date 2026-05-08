import { useState, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from 'recharts'
import type { EnergyRow, EnergyRates, DeviceSummary } from '../data/types'
import { computeEnergyByMachine, computeEnergyByPlant, getPlantForMachine } from '../data/energyAggregations'

interface Props {
  avgRows: EnergyRow[]
  deviceData: DeviceSummary[]
}

const DEFAULT_RATES: EnergyRates = { Sparks: 0.09, Addison: 0.10, Mayflower: 0.08 }
const DEFAULT_IDLE_THRESHOLD = 50
const NOISE_FLOOR_KWH = 1

const MACHINE_TYPE_DEFS = [
  { key: 'M', label: 'Molding', color: '#0693e3' },
  { key: 'K', label: 'Kleen Peel', color: '#ff6900' },
  { key: 'L', label: 'Liners', color: '#22c55e' },
] as const

const PLANT_COLORS: Record<string, string> = {
  Addison: '#0693e3',
  Mayflower: '#ff6900',
  Sparks: '#22c55e',
}

const DANGER = '#cf2e2e'
const WARN_COLORS = ['#cf2e2e', '#e05c2e', '#e8823a', '#eba94a', '#edba55']

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
      <span className="text-[0.65rem] font-bold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
        {label}
      </span>
      <div className="flex items-center gap-1">
        <span className="text-sm font-medium" style={{ color: 'var(--color-muted)' }}>$</span>
        <input
          type="number"
          min="0"
          step="0.001"
          value={value}
          onChange={e => {
            const v = parseFloat(e.target.value)
            if (!isNaN(v) && v >= 0) onChange(v)
          }}
          className="w-20 px-2 py-1 text-sm border rounded text-right font-mono"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        />
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>/kWh</span>
      </div>
    </label>
  )
}

function FilterChip({
  label, active = false, onClear,
}: { label: string; active?: boolean; onClear?: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[0.7rem] font-semibold"
      style={
        active
          ? { background: 'var(--color-secondary)', color: '#fff' }
          : { background: 'rgba(6,147,227,0.1)', color: 'var(--color-secondary)' }
      }
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

  const inputClass = 'border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 bg-white'
  const inputStyle = { borderColor: 'var(--color-border)', color: 'var(--color-text)' }
  const labelClass = 'block text-[0.65rem] font-bold uppercase tracking-wider mb-1'

  return (
    <section className="mb-10">

      {/* ── Section header ── */}
      <div className="flex items-center justify-between mb-5">
        <h2
          className="text-lg font-bold tracking-wide flex items-center gap-2"
          style={{ color: 'var(--color-primary)' }}
        >
          <span
            style={{
              display: 'inline-block', width: 4, height: '1.2em',
              background: 'var(--color-secondary)', borderRadius: 2,
            }}
          />
          Executive Energy + Cost Analysis
          {(dateFrom || dateTo) && (
            <span
              className="text-xs font-normal px-2 py-0.5 rounded-full"
              style={{ background: '#dbeafe', color: '#1d4ed8' }}
            >
              {fmtDateShort(dateFrom)} – {fmtDateShort(dateTo)}
            </span>
          )}
        </h2>
      </div>

      {/* ── Filter Bar ── */}
      <div
        className="bh-card mb-5 overflow-hidden"
        style={{ borderLeft: '3px solid var(--color-secondary)' }}
      >
        {/* Active filter summary row */}
        <div
          className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3"
          style={{ background: '#eef5fd', borderBottom: '1px solid #d0e4f7' }}
        >
          <div className="flex items-center gap-2">
            <span
              className="text-[0.65rem] font-bold uppercase tracking-wider"
              style={{ color: 'var(--color-secondary)' }}
            >
              Active Filters
            </span>
            {isFiltered && (
              <button
                onClick={resetFilters}
                className="text-[0.65rem] font-semibold underline ml-1"
                style={{ color: 'var(--color-muted)' }}
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
            <label className={labelClass} style={{ color: 'var(--color-muted)' }}>From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <div>
            <label className={labelClass} style={{ color: 'var(--color-muted)' }}>To</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <div>
            <label className={labelClass} style={{ color: 'var(--color-muted)' }}>Plant</label>
            <select
              value={plantFilter}
              onChange={e => setPlantFilter(e.target.value)}
              className={inputClass}
              style={inputStyle}
            >
              {allPlants.map(p => (
                <option key={p} value={p}>{p === 'All' ? 'All Plants' : p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} style={{ color: 'var(--color-muted)' }}>Machine Type</label>
            <div className="flex gap-4 py-1">
              {MACHINE_TYPE_DEFS.map(t => (
                <label
                  key={t.key}
                  className="flex items-center gap-1.5 cursor-pointer text-sm select-none"
                  style={{ color: 'var(--color-text)' }}
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
      <div
        className="bh-card mb-5 p-3 flex items-start gap-3"
        style={{ borderLeft: '4px solid #0693e3', background: '#eff6ff' }}
      >
        <svg className="shrink-0 mt-0.5" width="16" height="16" viewBox="0 0 20 20" fill="#1d4ed8">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold" style={{ color: '#1e3a5f' }}>
            Data current through: {fmtDateFull(dataMaxDate)}
          </div>
          <div className="text-xs mt-0.5" style={{ color: '#3b5f8a' }}>
            Displaying {filteredRows.length.toLocaleString()} of {avgRows.length.toLocaleString()} energy readings
            across {machineSummaries.length} machine{machineSummaries.length !== 1 ? 's' : ''}
          </div>
          {dateExceedsData && (
            <div
              className="mt-2 text-xs font-semibold px-2.5 py-1.5 rounded"
              style={{ background: '#fef3c7', color: '#92400e' }}
            >
              ⚠ Selected end date extends beyond available data. Displayed values only reflect
              data loaded through {fmtDateFull(dataMaxDate)}.
            </div>
          )}
        </div>
      </div>

      {/* ── Rate Inputs + Idle Threshold ── */}
      <div className="bh-card p-4 mb-5">
        <p
          className="text-[0.65rem] font-bold uppercase tracking-wider mb-3"
          style={{ color: 'var(--color-muted)' }}
        >
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
            <span
              className="text-[0.65rem] font-bold uppercase tracking-wider"
              style={{ color: 'var(--color-muted)' }}
            >
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
                className="w-20 px-2 py-1 text-sm border rounded text-right font-mono"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>kWh/day</span>
            </div>
          </label>
        </div>

        {/* Idle threshold explainer */}
        <div
          className="mt-4 p-3 rounded-lg text-xs"
          style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}
        >
          <p className="font-semibold mb-2" style={{ color: 'var(--color-primary)' }}>
            How the idle threshold works — current setting: {idleThreshold} kWh/day
          </p>
          <div className="space-y-1" style={{ color: 'var(--color-muted)' }}>
            <div className="flex items-start gap-2">
              <span className="font-bold mt-0.5" style={{ color: '#16a34a' }}>●</span>
              <span>
                <strong style={{ color: 'var(--color-text)' }}>Productive / Online:</strong>{' '}
                ≥ {idleThreshold} kWh/day — machine is running active production
              </span>
            </div>
            <div className="flex items-start gap-2">
              <span className="font-bold mt-0.5" style={{ color: DANGER }}>●</span>
              <span>
                <strong style={{ color: 'var(--color-text)' }}>Idle:</strong>{' '}
                {NOISE_FLOOR_KWH}–{idleThreshold} kWh/day — machine is powered on but not producing
                (counted as idle waste)
              </span>
            </div>
            <div className="flex items-start gap-2">
              <span className="font-bold mt-0.5 opacity-40">○</span>
              <span>
                <strong style={{ color: 'var(--color-text)' }}>Offline / Excluded:</strong>{' '}
                &lt; {NOISE_FLOOR_KWH} kWh/day — below noise floor, excluded from analysis
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── A. Executive Summary KPIs ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <div className="bh-card p-4">
          <div
            className="text-[0.65rem] font-bold uppercase tracking-wider mb-2"
            style={{ color: 'var(--color-muted)' }}
          >
            Total Energy Consumed
          </div>
          <div className="text-2xl font-bold leading-none" style={{ color: 'var(--color-primary)' }}>
            {fmtKWh(totalKWh)}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            {machineSummaries.length} machines
          </div>
        </div>

        <div className="bh-card p-4">
          <div
            className="text-[0.65rem] font-bold uppercase tracking-wider mb-2"
            style={{ color: 'var(--color-muted)' }}
          >
            Total Estimated Cost
          </div>
          <div className="text-2xl font-bold leading-none" style={{ color: 'var(--color-secondary)' }}>
            {fmtCostFull(totalCost)}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>all plants</div>
        </div>

        <div className="bh-card p-4" style={{ borderLeft: `3px solid ${DANGER}` }}>
          <div
            className="text-[0.65rem] font-bold uppercase tracking-wider mb-2"
            style={{ color: 'var(--color-muted)' }}
          >
            Est. Idle Energy Waste
          </div>
          <div className="text-2xl font-bold leading-none" style={{ color: DANGER }}>
            {fmtCostFull(totalIdleCost)}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            {totalCost > 0 ? `${((totalIdleCost / totalCost) * 100).toFixed(1)}% of total cost` : '—'}
          </div>
        </div>

        <div className="bh-card p-4">
          <div
            className="text-[0.65rem] font-bold uppercase tracking-wider mb-2"
            style={{ color: 'var(--color-muted)' }}
          >
            Highest Cost Plant
          </div>
          {highestCostPlant ? (
            <>
              <div className="text-xl font-bold leading-none" style={{ color: 'var(--color-primary)' }}>
                {highestCostPlant.plant}
              </div>
              <div className="text-xs mt-1 font-semibold" style={{ color: 'var(--color-accent)' }}>
                {fmtCostFull(highestCostPlant.totalCost)}
              </div>
            </>
          ) : <div className="text-xl font-bold">—</div>}
        </div>

        <div className="bh-card p-4">
          <div
            className="text-[0.65rem] font-bold uppercase tracking-wider mb-2"
            style={{ color: 'var(--color-muted)' }}
          >
            Most Idle Waste
          </div>
          {mostIdleMachine ? (
            <>
              <div className="text-base font-bold leading-none" style={{ color: 'var(--color-primary)' }}>
                {mostIdleMachine.machine}
              </div>
              <div className="text-xs mt-1 font-semibold" style={{ color: DANGER }}>
                {fmtCostFull(mostIdleMachine.idleCost)} idle
              </div>
              <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
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
            <p
              className="text-[0.65rem] font-bold uppercase tracking-wider mb-3"
              style={{ color: 'var(--color-muted)' }}
            >
              Cost Breakdown by Plant ($)
            </p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={plantChartData} barCategoryGap="35%">
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e4e9" vertical={false} />
                <XAxis
                  dataKey="plant"
                  tick={{ fontSize: 12, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(v: number) => fmtCostFull(v)}
                  contentStyle={{ fontSize: 12, borderColor: '#e2e4e9', borderRadius: 6 }}
                  cursor={{ fill: 'rgba(6,147,227,0.07)' }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Total Cost" fill="#0693e3" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Idle Waste" fill="#cf2e2e" radius={[4, 4, 0, 0]} />
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
                          style={{ background: PLANT_COLORS[p.plant] ?? '#6b7280' }}
                        />
                        <span className="font-semibold">{p.plant}</span>
                      </td>
                      <td className="text-right">{p.machineCount}</td>
                      <td className="text-right">{Math.round(p.totalKWh).toLocaleString()}</td>
                      <td
                        className="text-right font-semibold"
                        style={{ color: 'var(--color-secondary)' }}
                      >
                        {fmtCostFull(p.totalCost)}
                      </td>
                      <td
                        className="text-right"
                        style={{ color: p.idleCost > 0 ? DANGER : 'inherit' }}
                      >
                        {fmtCostFull(p.idleCost)}
                      </td>
                      <td
                        className="text-right font-semibold"
                        style={{ color: p.idleCost > 0 ? DANGER : 'var(--color-muted)' }}
                      >
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
          <span className="ml-2 text-xs font-normal" style={{ color: 'var(--color-muted)' }}>
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
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e4e9" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: '#6b7280' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => `$${(v / 1000).toFixed(1)}k`}
              />
              <YAxis
                type="category"
                dataKey="machine"
                tick={{ fontSize: 11, fill: '#1a1d21' }}
                axisLine={false}
                tickLine={false}
                width={80}
              />
              <Tooltip
                formatter={(v: number) => [fmtCostFull(v), 'Est. Cost']}
                contentStyle={{ fontSize: 12, borderColor: '#e2e4e9', borderRadius: 6 }}
                cursor={{ fill: 'rgba(6,147,227,0.07)' }}
              />
              <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
                {allMachineChartData.map((entry, idx) => (
                  <Cell
                    key={entry.machine}
                    fill={idx < 5 ? WARN_COLORS[idx] : '#0693e3'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[0.65rem] mt-2" style={{ color: 'var(--color-muted)' }}>
            Top 5 highlighted in red-orange. Based on average active power × days in selected period.
          </p>
        </div>
      </section>

      {/* ── D. Idle vs. Productive Energy Cost by Machine ── */}
      {breakdownChartData.length > 0 && (
        <section className="mb-6">
          <h3 className="bh-section-title">
            Idle vs. Productive Energy Cost by Machine
            <span className="ml-2 text-xs font-normal" style={{ color: 'var(--color-muted)' }}>
              top {breakdownChartData.length} by cost
            </span>
          </h3>
          <div className="bh-card p-4">
            <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
              Stacked view of productive (blue) vs. idle (red) energy cost per machine.
              Machines with significant idle portions represent energy recovery opportunities.
            </p>
            <ResponsiveContainer width="100%" height={breakdownChartHeight}>
              <BarChart
                data={breakdownChartData}
                layout="vertical"
                margin={{ left: 20, right: 30, top: 4, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e4e9" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => `$${(v / 1000).toFixed(1)}k`}
                />
                <YAxis
                  type="category"
                  dataKey="machine"
                  tick={{ fontSize: 11, fill: '#1a1d21' }}
                  axisLine={false}
                  tickLine={false}
                  width={80}
                />
                <Tooltip
                  formatter={(v: number, name: string) => [fmtCostFull(v), name]}
                  contentStyle={{ fontSize: 12, borderColor: '#e2e4e9', borderRadius: 6 }}
                  cursor={{ fill: 'rgba(6,147,227,0.07)' }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Productive" stackId="a" fill="#0693e3" />
                <Bar dataKey="Idle" stackId="a" fill={DANGER} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* ── E. Idle Energy Waste ── */}
      <section className="mb-6">
        <h3 className="bh-section-title">Idle Energy Waste</h3>
        <div
          className="bh-card p-3 mb-4 flex items-center gap-3"
          style={{ borderLeft: `4px solid ${DANGER}`, background: '#fef2f2' }}
        >
          <span className="text-2xl font-bold" style={{ color: DANGER }}>
            {fmtCostFull(totalIdleCost)}
          </span>
          <div>
            <div className="text-sm font-semibold" style={{ color: DANGER }}>
              Estimated Idle Energy Waste
            </div>
            <div className="text-xs" style={{ color: '#6b7280' }}>
              Machines drawing {NOISE_FLOOR_KWH}–{idleThreshold} kWh/day without active
              production · idle threshold: {idleThreshold} kWh/day
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          {/* Chart */}
          <div className="bh-card p-4">
            <p
              className="text-[0.65rem] font-bold uppercase tracking-wider mb-3"
              style={{ color: 'var(--color-muted)' }}
            >
              Idle Waste by Machine — Top 10 ($)
            </p>
            {top10Idle.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={idleChartData}
                  layout="vertical"
                  margin={{ left: 20, right: 20, top: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e4e9" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={v => `$${v.toFixed(0)}`}
                  />
                  <YAxis
                    type="category"
                    dataKey="machine"
                    tick={{ fontSize: 11, fill: '#1a1d21' }}
                    axisLine={false}
                    tickLine={false}
                    width={80}
                  />
                  <Tooltip
                    formatter={(v: number) => [fmtCostFull(v), 'Idle Cost']}
                    contentStyle={{ fontSize: 12, borderColor: '#e2e4e9', borderRadius: 6 }}
                  />
                  <Bar dataKey="Idle Cost" fill={DANGER} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p
                className="text-sm text-center py-10"
                style={{ color: 'var(--color-muted)' }}
              >
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
                      <td colSpan={6} className="text-center" style={{ color: 'var(--color-muted)' }}>
                        No idle waste at current threshold
                      </td>
                    </tr>
                  ) : top10Idle.map((m, idx) => (
                    <tr key={m.machine}>
                      <td>
                        <span
                          className="font-semibold"
                          style={{ color: idx < 3 ? DANGER : 'inherit' }}
                        >
                          {m.machine}
                        </span>
                      </td>
                      <td style={{ color: 'var(--color-muted)' }}>{m.plant}</td>
                      <td className="text-right">{Math.round(m.idleKWh).toLocaleString()}</td>
                      <td
                        className="text-right font-semibold"
                        style={{ color: idx < 3 ? DANGER : 'inherit' }}
                      >
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
            <div
              className="bh-card p-4 mb-4"
              style={{ borderLeft: '4px solid var(--color-accent)', background: '#fff7ed' }}
            >
              <div className="text-sm font-semibold mb-2" style={{ color: 'var(--color-accent)' }}>
                Color Change Energy Impact
              </div>
              <div className="flex flex-wrap items-baseline gap-3 mb-2">
                <span className="text-3xl font-bold" style={{ color: 'var(--color-primary)' }}>
                  {totalColorChangeCount.toLocaleString()}
                </span>
                <span className="text-base" style={{ color: 'var(--color-muted)' }}>
                  color changes consumed approximately
                </span>
                <span className="text-2xl font-bold" style={{ color: 'var(--color-secondary)' }}>
                  {fmtCostFull(totalColorChangeCost)}
                </span>
                <span className="text-base" style={{ color: 'var(--color-muted)' }}>
                  in energy ({fmtKWh(totalColorChangeKWh)})
                </span>
              </div>
              <div className="text-xs" style={{ color: '#78350f' }}>
                Across {efficiencyData.length} color-change machines in the selected period.
                Cost reflects total machine energy consumption (not changeover time only).
                Changeover counts use the Changeover tab's current date filter.
              </div>
            </div>
          )}

          <div className="bh-card p-4">
            <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
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
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e4e9" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="machine"
                  tick={{ fontSize: 11, fill: '#1a1d21' }}
                  axisLine={false}
                  tickLine={false}
                  width={80}
                />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderColor: '#e2e4e9', borderRadius: 6 }}
                  cursor={{ fill: 'rgba(6,147,227,0.07)' }}
                />
                <Bar dataKey="kWh / Change" fill="var(--color-accent)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>

            {/* Efficiency detail table with cost per changeover */}
            <div className="mt-5 overflow-x-auto">
              <p
                className="text-[0.65rem] font-bold uppercase tracking-wider mb-2"
                style={{ color: 'var(--color-muted)' }}
              >
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
                      <td style={{ color: 'var(--color-muted)' }}>{m.plant}</td>
                      <td className="text-right">{m.changeoverCount}</td>
                      <td className="text-right">{Math.round(m.totalKWh).toLocaleString()}</td>
                      <td
                        className="text-right font-semibold"
                        style={{ color: 'var(--color-secondary)' }}
                      >
                        {fmtCostFull(m.totalCost)}
                      </td>
                      <td className="text-right">
                        {Math.round(m.kWhPerChangeover ?? 0).toLocaleString()}
                      </td>
                      <td
                        className="text-right font-semibold"
                        style={{ color: 'var(--color-accent)' }}
                      >
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
