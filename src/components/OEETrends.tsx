import { useMemo, useState, useRef } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import type { OEERecord } from '../data/types'
import {
  monthlyOEE, quarterlyOEE, periodComparison, oeeByMachine
} from '../data/oeeAggregations'
import { axisTick, tooltipStyle, gridStroke, oeeColors } from '../utils/chartTheme'

interface Props {
  records: OEERecord[]
}

function fmt(n: number, d = 1): string {
  return n.toFixed(d)
}

function inferSite(machine: string): string {
  const first = machine.charAt(0)
  switch (first) {
    case '1': return 'Addison'
    case '2': return 'Mayflower'
    case '3': return 'Sparks'
    default: return 'Unknown'
  }
}

const cardCls = 'bg-card border border-border rounded-xl p-5'

const tableHeaderCls = 'text-[0.7rem] font-bold uppercase tracking-[0.06em] text-muted-foreground px-3 py-2 border-b border-border text-left'

const tableCellCls = 'px-3 py-2 text-[0.8rem] text-foreground border-b border-border'

const COMPARISON_PRESETS = [
  { label: 'Previous Period', value: 'previous' },
  { label: 'Same Period Last Year', value: 'yoy' },
  { label: 'Custom', value: 'custom' },
]

export default function OEETrends({ records }: Props) {
  const noteRef = useRef<HTMLTextAreaElement>(null)

  // Derive available sites and machines
  const sites = useMemo(() => {
    const s = new Set(records.map(r => inferSite(r.machine)))
    return ['All', ...Array.from(s).sort()]
  }, [records])

  const machines = useMemo(() => {
    return ['All', ...Array.from(new Set(records.map(r => r.machine))).sort()]
  }, [records])

  // Date range of data
  const dataDateRange = useMemo(() => {
    if (records.length === 0) return { min: '', max: '' }
    const dates = records.map(r => r.date).sort()
    return { min: dates[0], max: dates[dates.length - 1] }
  }, [records])

  const [siteFilter, setSiteFilter] = useState('All')
  const [machineFilter, setMachineFilter] = useState('All')
  const [comparisonMode, setComparisonMode] = useState('previous')

  // Current period defaults to last 90 days of data
  const [currentFrom, setCurrentFrom] = useState(() => {
    if (!dataDateRange.max) return ''
    const d = new Date(dataDateRange.max)
    d.setDate(d.getDate() - 90)
    return d.toISOString().slice(0, 10)
  })
  const [currentTo, setCurrentTo] = useState(dataDateRange.max)

  // Comparison period
  const [compareFrom, setCompareFrom] = useState(() => {
    if (!dataDateRange.max) return ''
    const d = new Date(dataDateRange.max)
    d.setDate(d.getDate() - 180)
    return d.toISOString().slice(0, 10)
  })
  const [compareTo, setCompareTo] = useState(() => {
    if (!dataDateRange.max) return ''
    const d = new Date(dataDateRange.max)
    d.setDate(d.getDate() - 91)
    return d.toISOString().slice(0, 10)
  })

  // Derived comparison period based on mode
  const effectiveCompareFrom = useMemo(() => {
    if (comparisonMode === 'custom') return compareFrom
    if (!currentFrom || !currentTo) return compareFrom
    const fromDate = new Date(currentFrom)
    const toDate = new Date(currentTo)
    const daySpan = Math.round((toDate.getTime() - fromDate.getTime()) / (1000 * 86400))
    if (comparisonMode === 'yoy') {
      const f = new Date(fromDate)
      f.setFullYear(f.getFullYear() - 1)
      return f.toISOString().slice(0, 10)
    }
    // previous
    const f = new Date(fromDate)
    f.setDate(f.getDate() - daySpan - 1)
    return f.toISOString().slice(0, 10)
  }, [comparisonMode, currentFrom, currentTo, compareFrom])

  const effectiveCompareTo = useMemo(() => {
    if (comparisonMode === 'custom') return compareTo
    if (!currentFrom) return compareTo
    const fromDate = new Date(currentFrom)
    const toDate = new Date(currentTo)
    const daySpan = Math.round((toDate.getTime() - fromDate.getTime()) / (1000 * 86400))
    if (comparisonMode === 'yoy') {
      const t = new Date(toDate)
      t.setFullYear(t.getFullYear() - 1)
      return t.toISOString().slice(0, 10)
    }
    const t = new Date(fromDate)
    t.setDate(t.getDate() - 1)
    return t.toISOString().slice(0, 10)
  }, [comparisonMode, currentFrom, currentTo, compareTo])

  // Filter records by site / machine
  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      if (siteFilter !== 'All' && inferSite(r.machine) !== siteFilter) return false
      if (machineFilter !== 'All' && r.machine !== machineFilter) return false
      return true
    })
  }, [records, siteFilter, machineFilter])

  const monthly = useMemo(() => monthlyOEE(filteredRecords), [filteredRecords])
  const quarterly = useMemo(() => quarterlyOEE(filteredRecords), [filteredRecords])

  const comparison = useMemo(() => {
    if (!currentFrom || !currentTo || !effectiveCompareFrom || !effectiveCompareTo) return null
    return periodComparison(
      filteredRecords,
      { from: currentFrom, to: currentTo },
      { from: effectiveCompareFrom, to: effectiveCompareTo }
    )
  }, [filteredRecords, currentFrom, currentTo, effectiveCompareFrom, effectiveCompareTo])

  const machineTable = useMemo(
    () => oeeByMachine(filteredRecords, currentFrom, currentTo),
    [filteredRecords, currentFrom, currentTo]
  )

  const machineTableComparison = useMemo(
    () => oeeByMachine(filteredRecords, effectiveCompareFrom, effectiveCompareTo),
    [filteredRecords, effectiveCompareFrom, effectiveCompareTo]
  )

  const machineTableMerged = useMemo(() => {
    const compMap = new Map(machineTableComparison.map(r => [r.machine, r]))
    return machineTable.map(r => {
      const comp = compMap.get(r.machine)
      const delta = comp ? r.avgOEE - comp.avgOEE : null
      return { ...r, compAvgOEE: comp?.avgOEE ?? null, delta }
    })
  }, [machineTable, machineTableComparison])

  const deltaColorCls = (d: number | null) => {
    if (d === null) return 'text-muted-foreground'
    if (d > 0) return 'text-success'
    if (d < 0) return 'text-danger'
    return 'text-foreground'
  }

  if (records.length === 0) {
    return (
      <div className="rounded-xl p-8 text-center bg-card border border-border">
        <p className="text-base font-semibold mb-2 text-foreground">
          OEE data not loaded yet
        </p>
        <p className="text-sm mb-4 text-muted-foreground">
          Upload a Guidewheel Production CSV to populate OEE Trends.
        </p>
        <div className="mx-auto max-w-md rounded-lg px-4 py-3 text-sm text-left bg-btn-primary/5 border border-btn-primary/20 text-btn-primary">
          <p className="font-semibold mb-1">How to upload:</p>
          <p>
            Files with <strong>Production</strong> or <strong>OEE</strong> in the filename will be parsed for
            scheduled time, machine, production quantity, waste, and OEE. Use the <strong>Upload CSV</strong> button in the top-right corner.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* ── Filters ───────────────────────────────────────────────────────── */}
      <div className={cardCls}>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="bh-metric-label mb-1 block">Site</label>
            <select
              value={siteFilter}
              onChange={e => { setSiteFilter(e.target.value); setMachineFilter('All') }}
              className="text-sm rounded px-3 py-1.5 bg-background border border-border text-foreground"
            >
              {sites.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="bh-metric-label mb-1 block">Machine</label>
            <select
              value={machineFilter}
              onChange={e => setMachineFilter(e.target.value)}
              className="text-sm rounded px-3 py-1.5 bg-background border border-border text-foreground"
            >
              {machines
                .filter(m => m === 'All' || siteFilter === 'All' || inferSite(m) === siteFilter)
                .map(m => <option key={m} value={m}>{m}</option>)
              }
            </select>
          </div>
          <div>
            <label className="bh-metric-label mb-1 block">Current Period From</label>
            <input type="date" value={currentFrom} onChange={e => setCurrentFrom(e.target.value)}
              className="text-sm rounded px-3 py-1.5 bg-background border border-border text-foreground"
              min={dataDateRange.min || undefined}
              max={dataDateRange.max || undefined}
            />
          </div>
          <div>
            <label className="bh-metric-label mb-1 block">Current Period To</label>
            <input type="date" value={currentTo} onChange={e => setCurrentTo(e.target.value)}
              className="text-sm rounded px-3 py-1.5 bg-background border border-border text-foreground"
              min={dataDateRange.min || undefined}
              max={dataDateRange.max || undefined}
            />
          </div>
          <div>
            <label className="bh-metric-label mb-1 block">Comparison</label>
            <select
              value={comparisonMode}
              onChange={e => setComparisonMode(e.target.value)}
              className="text-sm rounded px-3 py-1.5 bg-background border border-border text-foreground"
            >
              {COMPARISON_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          {comparisonMode === 'custom' && (
            <>
              <div>
                <label className="bh-metric-label mb-1 block">Compare From</label>
                <input type="date" value={compareFrom} onChange={e => setCompareFrom(e.target.value)}
                  className="text-sm rounded px-3 py-1.5 bg-background border border-border text-foreground"
                />
              </div>
              <div>
                <label className="bh-metric-label mb-1 block">Compare To</label>
                <input type="date" value={compareTo} onChange={e => setCompareTo(e.target.value)}
                  className="text-sm rounded px-3 py-1.5 bg-background border border-border text-foreground"
                />
              </div>
            </>
          )}

          {/* Available data range indicator */}
          {(dataDateRange.min || dataDateRange.max) && (
            <div className="ml-auto self-end pb-0.5 text-right">
              <div className="text-xs text-muted-foreground">
                Available data:{' '}
                <span className="font-medium text-foreground">{dataDateRange.min}</span>
                {' '}to{' '}
                <span className="font-medium text-foreground">{dataDateRange.max}</span>
              </div>
            </div>
          )}
        </div>

        {/* Date validation warnings for current period */}
        {(() => {
          const noOverlap = Boolean(
            dataDateRange.min && dataDateRange.max && currentFrom && currentTo &&
            (currentTo < dataDateRange.min || currentFrom > dataDateRange.max)
          )
          const beforeData = !noOverlap && Boolean(dataDateRange.min && currentFrom && currentFrom < dataDateRange.min)
          const exceedsData = !noOverlap && Boolean(dataDateRange.max && currentTo && currentTo > dataDateRange.max)
          return (
            <>
              {noOverlap && (
                <div className="mt-3 rounded px-3 py-2 text-xs font-semibold bg-danger/5 border border-danger/30 text-danger">
                  No data available for the selected current period. Available data is {dataDateRange.min} to {dataDateRange.max}.
                </div>
              )}
              {beforeData && (
                <div className="mt-3 rounded px-3 py-2 text-xs bg-warning/5 border border-warning/30 text-warning">
                  ⚠ Current period start is before available data. Displayed values begin on {dataDateRange.min}.
                </div>
              )}
              {exceedsData && (
                <div className="mt-3 rounded px-3 py-2 text-xs bg-warning/5 border border-warning/30 text-warning">
                  ⚠ Current period end is after latest uploaded data. Displayed values only reflect data through {dataDateRange.max}.
                </div>
              )}
            </>
          )
        })()}
      </div>

      {/* ── Period Comparison Cards ───────────────────────────────────────── */}
      {comparison && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className={cardCls}>
            <div className="bh-metric-label mb-1">Current Period</div>
            <div className="text-3xl font-bold text-foreground">
              {fmt(comparison.periodA.avgOEE)}%
            </div>
            <div className="text-xs mt-1 text-muted-foreground">
              {comparison.periodA.label}
            </div>
            <div className="text-xs mt-0.5 text-muted-foreground">
              {comparison.periodA.count} readings
            </div>
          </div>
          <div className={cardCls}>
            <div className="bh-metric-label mb-1">Comparison Period</div>
            <div className="text-3xl font-bold text-foreground">
              {fmt(comparison.periodB.avgOEE)}%
            </div>
            <div className="text-xs mt-1 text-muted-foreground">
              {comparison.periodB.label}
            </div>
            <div className="text-xs mt-0.5 text-muted-foreground">
              {comparison.periodB.count} readings
            </div>
          </div>
          <div className={`${cardCls} border-l-4 ${comparison.delta >= 0 ? 'border-l-success' : 'border-l-danger'}`}>
            <div className="bh-metric-label mb-1">Change</div>
            <div className={`text-3xl font-bold ${comparison.delta >= 0 ? 'text-success' : 'text-danger'}`}>
              {comparison.delta >= 0 ? '+' : ''}{fmt(comparison.delta)}pp
            </div>
            <div className={`text-sm mt-1 ${comparison.delta >= 0 ? 'text-success' : 'text-danger'}`}>
              {comparison.delta >= 0 ? '▲' : '▼'} {fmt(Math.abs(comparison.pctChange))}% vs comparison
            </div>
          </div>
        </div>
      )}

      {/* ── Monthly OEE Trend ─────────────────────────────────────────────── */}
      {monthly.length > 0 && (
        <div className={cardCls}>
          <h2 className="text-sm font-semibold mb-3 text-foreground">Monthly OEE Trend</h2>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthly} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="month" tick={axisTick} />
                <YAxis tick={axisTick} tickFormatter={v => `${Math.round(v)}%`} domain={[0, 100]} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number) => [`${fmt(v)}%`, 'Avg OEE']}
                />
                <Line type="monotone" dataKey="avgOEE" stroke={oeeColors.overall} strokeWidth={2} dot={{ r: 3 }} name="Avg OEE" />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs mt-2 text-muted-foreground">
            Methodology: simple average of daily OEE readings per month.
          </p>
        </div>
      )}

      {/* ── Quarterly OEE Chart ───────────────────────────────────────────── */}
      {quarterly.length > 0 && (
        <div className={cardCls}>
          <h2 className="text-sm font-semibold mb-3 text-foreground">Quarter-over-Quarter OEE</h2>
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={quarterly} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="quarter" tick={axisTick} />
                <YAxis tick={axisTick} tickFormatter={v => `${Math.round(v)}%`} domain={[0, 100]} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number) => [`${fmt(v)}%`, 'Avg OEE']}
                />
                <Bar dataKey="avgOEE" fill={oeeColors.overall} radius={[3, 3, 0, 0]} name="Avg OEE" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Machine-level OEE Table ───────────────────────────────────────── */}
      {machineTableMerged.length > 0 && (
        <div className={cardCls}>
          <h2 className="text-sm font-semibold mb-3 text-foreground">Machine OEE — Current vs Comparison Period</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  {['Machine', 'Site', 'Current Avg OEE', 'Comparison Avg OEE', 'Delta', 'Readings'].map(h => (
                    <th key={h} className={tableHeaderCls}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {machineTableMerged.map(row => (
                  <tr key={row.machine}>
                    <td className={tableCellCls}><span className="font-mono text-xs font-medium">{row.machine}</span></td>
                    <td className={tableCellCls}>{row.site}</td>
                    <td className={`${tableCellCls} font-semibold`}>{fmt(row.avgOEE)}%</td>
                    <td className={tableCellCls}>{row.compAvgOEE !== null ? `${fmt(row.compAvgOEE)}%` : '—'}</td>
                    <td className={`${tableCellCls} font-semibold ${deltaColorCls(row.delta)}`}>
                      {row.delta !== null ? `${row.delta >= 0 ? '+' : ''}${fmt(row.delta)}pp` : '—'}
                    </td>
                    <td className={tableCellCls}>{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs mt-2 text-muted-foreground">
            Weighted OEE accounts for runtime behind each reading. Simple average treats each daily reading equally. Currently showing: simple average.
          </p>
        </div>
      )}

      {/* ── Export-friendly Summary ───────────────────────────────────────── */}
      {comparison && (
        <div className={`${cardCls} print-section`}>
          <h2 className="text-sm font-semibold mb-4 text-foreground">Performance Review Summary</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
            <div>
              <p className="bh-metric-label mb-2">Period Details</p>
              <p className="text-sm text-foreground">
                <span className="font-medium">Current:</span> {comparison.periodA.label}
              </p>
              <p className="text-sm mt-1 text-foreground">
                <span className="font-medium">Comparison:</span> {comparison.periodB.label}
              </p>
              <p className="text-sm mt-1 text-foreground">
                <span className="font-medium">OEE Change:</span>{' '}
                <span className={comparison.delta >= 0 ? 'text-success' : 'text-danger'}>
                  {comparison.delta >= 0 ? '+' : ''}{fmt(comparison.delta)}pp ({fmt(Math.abs(comparison.pctChange))}%)
                </span>
              </p>
            </div>
            <div>
              {comparison.topImproved.length > 0 && (
                <div className="mb-3">
                  <p className="bh-metric-label text-success mb-1">Top Improved</p>
                  {comparison.topImproved.slice(0, 3).map(m => (
                    <p key={m.machine} className="text-sm text-foreground">
                      {m.machine}: +{fmt(m.delta)}pp
                    </p>
                  ))}
                </div>
              )}
              {comparison.topDeclined.length > 0 && (
                <div>
                  <p className="bh-metric-label text-danger mb-1">Top Declined</p>
                  {comparison.topDeclined.slice(0, 3).map(m => (
                    <p key={m.machine} className="text-sm text-foreground">
                      {m.machine}: {fmt(m.delta)}pp
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mb-4">
            <p className="bh-metric-label mb-2">Notes</p>
            <textarea
              ref={noteRef}
              className="w-full rounded-lg px-3 py-2 text-sm bg-background border border-border text-foreground"
              style={{ minHeight: 80, resize: 'vertical' }}
              placeholder="Add notes for performance review..."
            />
          </div>

          <button
            onClick={() => window.print()}
            className="text-sm px-4 py-2 rounded font-medium bg-btn-primary text-btn-primary-foreground hover:bg-btn-primary-accent"
          >
            Print / Save as PDF
          </button>
        </div>
      )}

    </div>
  )
}
