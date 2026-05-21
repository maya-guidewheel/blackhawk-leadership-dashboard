import { useMemo, useState, useRef } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import type { OEERecord } from '../data/types'
import {
  monthlyOEE, quarterlyOEE, periodComparison, oeeByMachine
} from '../data/oeeAggregations'

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

const cardStyle: React.CSSProperties = {
  background: 'var(--color-card)',
  border: '1px solid var(--color-border)',
  borderRadius: '0.75rem',
  padding: '1.25rem',
}

const tableHeaderStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
  color: 'var(--color-muted)',
  padding: '0.5rem 0.75rem',
  borderBottom: '1px solid var(--color-border)',
  textAlign: 'left' as const,
}

const tableCellStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  fontSize: '0.8rem',
  color: 'var(--color-text)',
  borderBottom: '1px solid var(--color-border)',
}

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

  const deltaColor = (d: number | null) => {
    if (d === null) return 'var(--color-muted)'
    if (d > 0) return 'var(--color-accent)'
    if (d < 0) return 'var(--color-danger)'
    return 'var(--color-text)'
  }

  if (records.length === 0) {
    return (
      <div
        className="rounded-xl p-8 text-center"
        style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}
      >
        <p className="text-base font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
          OEE data not loaded
        </p>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          Upload a Guidewheel OEE CSV to enable period comparison.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* ── Filters ───────────────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Site</label>
            <select
              value={siteFilter}
              onChange={e => { setSiteFilter(e.target.value); setMachineFilter('All') }}
              className="text-sm rounded px-3 py-1.5"
              style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            >
              {sites.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Machine</label>
            <select
              value={machineFilter}
              onChange={e => setMachineFilter(e.target.value)}
              className="text-sm rounded px-3 py-1.5"
              style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            >
              {machines
                .filter(m => m === 'All' || siteFilter === 'All' || inferSite(m) === siteFilter)
                .map(m => <option key={m} value={m}>{m}</option>)
              }
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Current Period From</label>
            <input type="date" value={currentFrom} onChange={e => setCurrentFrom(e.target.value)}
              className="text-sm rounded px-3 py-1.5"
              style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Current Period To</label>
            <input type="date" value={currentTo} onChange={e => setCurrentTo(e.target.value)}
              className="text-sm rounded px-3 py-1.5"
              style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Comparison</label>
            <select
              value={comparisonMode}
              onChange={e => setComparisonMode(e.target.value)}
              className="text-sm rounded px-3 py-1.5"
              style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            >
              {COMPARISON_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          {comparisonMode === 'custom' && (
            <>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Compare From</label>
                <input type="date" value={compareFrom} onChange={e => setCompareFrom(e.target.value)}
                  className="text-sm rounded px-3 py-1.5"
                  style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Compare To</label>
                <input type="date" value={compareTo} onChange={e => setCompareTo(e.target.value)}
                  className="text-sm rounded px-3 py-1.5"
                  style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Period Comparison Cards ───────────────────────────────────────── */}
      {comparison && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div style={cardStyle}>
            <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Current Period</div>
            <div className="text-3xl font-bold" style={{ color: 'var(--color-primary)' }}>
              {fmt(comparison.periodA.avgOEE)}%
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
              {comparison.periodA.label}
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
              {comparison.periodA.count} readings
            </div>
          </div>
          <div style={cardStyle}>
            <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Comparison Period</div>
            <div className="text-3xl font-bold" style={{ color: 'var(--color-text)' }}>
              {fmt(comparison.periodB.avgOEE)}%
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
              {comparison.periodB.label}
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
              {comparison.periodB.count} readings
            </div>
          </div>
          <div style={{ ...cardStyle, borderLeft: `4px solid ${comparison.delta >= 0 ? 'var(--color-accent)' : 'var(--color-danger)'}` }}>
            <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Change</div>
            <div className="text-3xl font-bold" style={{ color: comparison.delta >= 0 ? 'var(--color-accent)' : 'var(--color-danger)' }}>
              {comparison.delta >= 0 ? '+' : ''}{fmt(comparison.delta)}pp
            </div>
            <div className="text-sm mt-1" style={{ color: comparison.delta >= 0 ? 'var(--color-accent)' : 'var(--color-danger)' }}>
              {comparison.delta >= 0 ? '▲' : '▼'} {fmt(Math.abs(comparison.pctChange))}% vs comparison
            </div>
          </div>
        </div>
      )}

      {/* ── Monthly OEE Trend ─────────────────────────────────────────────── */}
      {monthly.length > 0 && (
        <div style={cardStyle}>
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>Monthly OEE Trend</h2>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthly} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--color-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--color-muted)' }} tickFormatter={v => `${Math.round(v)}%`} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number) => [`${fmt(v)}%`, 'Avg OEE']}
                />
                <Line type="monotone" dataKey="avgOEE" stroke="var(--color-accent)" strokeWidth={2} dot={{ r: 3 }} name="Avg OEE" />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
            Methodology: simple average of daily OEE readings per month.
          </p>
        </div>
      )}

      {/* ── Quarterly OEE Chart ───────────────────────────────────────────── */}
      {quarterly.length > 0 && (
        <div style={cardStyle}>
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>Quarter-over-Quarter OEE</h2>
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={quarterly} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="quarter" tick={{ fontSize: 10, fill: 'var(--color-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--color-muted)' }} tickFormatter={v => `${Math.round(v)}%`} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number) => [`${fmt(v)}%`, 'Avg OEE']}
                />
                <Bar dataKey="avgOEE" fill="var(--color-accent)" radius={[3, 3, 0, 0]} name="Avg OEE" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Machine-level OEE Table ───────────────────────────────────────── */}
      {machineTableMerged.length > 0 && (
        <div style={cardStyle}>
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>Machine OEE — Current vs Comparison Period</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  {['Machine', 'Site', 'Current Avg OEE', 'Comparison Avg OEE', 'Delta', 'Readings'].map(h => (
                    <th key={h} style={tableHeaderStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {machineTableMerged.map(row => (
                  <tr key={row.machine}>
                    <td style={tableCellStyle}><span className="font-mono text-xs font-medium">{row.machine}</span></td>
                    <td style={tableCellStyle}>{row.site}</td>
                    <td style={{ ...tableCellStyle, fontWeight: 600 }}>{fmt(row.avgOEE)}%</td>
                    <td style={tableCellStyle}>{row.compAvgOEE !== null ? `${fmt(row.compAvgOEE)}%` : '—'}</td>
                    <td style={{ ...tableCellStyle, fontWeight: 600, color: deltaColor(row.delta) }}>
                      {row.delta !== null ? `${row.delta >= 0 ? '+' : ''}${fmt(row.delta)}pp` : '—'}
                    </td>
                    <td style={tableCellStyle}>{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
            Weighted OEE accounts for runtime behind each reading. Simple average treats each daily reading equally. Currently showing: simple average.
          </p>
        </div>
      )}

      {/* ── Export-friendly Summary ───────────────────────────────────────── */}
      {comparison && (
        <div style={cardStyle} className="print-section">
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Performance Review Summary</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>Period Details</p>
              <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                <span className="font-medium">Current:</span> {comparison.periodA.label}
              </p>
              <p className="text-sm mt-1" style={{ color: 'var(--color-text)' }}>
                <span className="font-medium">Comparison:</span> {comparison.periodB.label}
              </p>
              <p className="text-sm mt-1" style={{ color: 'var(--color-text)' }}>
                <span className="font-medium">OEE Change:</span>{' '}
                <span style={{ color: comparison.delta >= 0 ? 'var(--color-accent)' : 'var(--color-danger)' }}>
                  {comparison.delta >= 0 ? '+' : ''}{fmt(comparison.delta)}pp ({fmt(Math.abs(comparison.pctChange))}%)
                </span>
              </p>
            </div>
            <div>
              {comparison.topImproved.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-accent)' }}>Top Improved</p>
                  {comparison.topImproved.slice(0, 3).map(m => (
                    <p key={m.machine} className="text-sm" style={{ color: 'var(--color-text)' }}>
                      {m.machine}: +{fmt(m.delta)}pp
                    </p>
                  ))}
                </div>
              )}
              {comparison.topDeclined.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-danger)' }}>Top Declined</p>
                  {comparison.topDeclined.slice(0, 3).map(m => (
                    <p key={m.machine} className="text-sm" style={{ color: 'var(--color-text)' }}>
                      {m.machine}: {fmt(m.delta)}pp
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>Notes</p>
            <textarea
              ref={noteRef}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={{
                background: 'var(--color-background)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
                minHeight: 80,
                resize: 'vertical',
              }}
              placeholder="Add notes for performance review..."
            />
          </div>

          <button
            onClick={() => window.print()}
            className="text-sm px-4 py-2 rounded font-medium"
            style={{ background: 'var(--color-accent)', color: '#ffffff' }}
          >
            Print / Save as PDF
          </button>
        </div>
      )}

    </div>
  )
}
