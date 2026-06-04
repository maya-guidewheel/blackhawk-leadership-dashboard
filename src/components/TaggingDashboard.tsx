import { useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'
import type { DowntimeEvent } from '../data/types'
import {
  taggingCompliance,
  plannedDowntimeAnalysis,
  taggingReviewCandidates,
  computeReviewHighlights,
  REVIEW_REASON_CATEGORIES,
  matchesReasonCategory,
} from '../data/taggingAggregations'
import { axisTick, tooltipStyle, gridStroke } from '../utils/chartTheme'

interface Props {
  events: DowntimeEvent[]
  complianceTarget: number
  onTargetChange: (v: number) => void
}

function fmt(n: number, decimals = 1): string {
  return n.toFixed(decimals)
}

function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysAgoISO(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function startOfMonthISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function startOfQuarterISO(): string {
  const d = new Date()
  const qMonth = Math.floor(d.getMonth() / 3) * 3
  return `${d.getFullYear()}-${String(qMonth + 1).padStart(2, '0')}-01`
}

function startOfYearISO(): string {
  return `${new Date().getFullYear()}-01-01`
}

const cardCls = 'bg-card border border-border rounded-xl p-5'

const tableHeaderCls = 'text-[0.7rem] font-bold uppercase tracking-[0.06em] text-muted-foreground px-3 py-2 border-b border-border text-left'

const tableCellCls = 'px-3 py-2 text-[0.8rem] text-foreground border-b border-border'

const quickBtnCls = 'text-[0.7rem] font-semibold px-2.5 py-1 rounded-md cursor-pointer border border-border bg-background text-muted-foreground'

export default function TaggingDashboard({ events, complianceTarget, onTargetChange }: Props) {
  const [showDefinitions, setShowDefinitions] = useState(false)
  const [warningThreshold, setWarningThreshold] = useState(30)
  const [criticalThreshold, setCriticalThreshold] = useState(50)
  const [reviewPlantFilter, setReviewPlantFilter] = useState('All')
  const [reviewReasonFilter, setReviewReasonFilter] = useState('all')

  // Date extent of all loaded events
  const dateExtent = useMemo(() => {
    if (events.length === 0) return { min: '', max: '' }
    const dates = events.map(e => e.calendar_date).sort()
    return { min: dates[0], max: dates[dates.length - 1] }
  }, [events])

  // Date range filter — empty strings mean "use full extent"
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const effectiveDateFrom = dateFrom || dateExtent.min
  const effectiveDateTo = dateTo || dateExtent.max

  const noDataInRange = Boolean(
    dateExtent.min && dateExtent.max && events.length > 0 &&
    (effectiveDateTo < dateExtent.min || effectiveDateFrom > dateExtent.max)
  )
  const dateBeforeData = !noDataInRange && Boolean(dateExtent.min && effectiveDateFrom < dateExtent.min)
  const rangeExceedsData = !noDataInRange && effectiveDateTo > dateExtent.max && dateExtent.max !== ''

  // Apply date range filter
  const filteredEvents = useMemo(
    () => events.filter(
      e => e.calendar_date >= effectiveDateFrom && e.calendar_date <= effectiveDateTo
    ),
    [events, effectiveDateFrom, effectiveDateTo]
  )

  const compliance = useMemo(
    () => taggingCompliance(filteredEvents, complianceTarget),
    [filteredEvents, complianceTarget]
  )
  const planned = useMemo(
    () => plannedDowntimeAnalysis(filteredEvents, warningThreshold, criticalThreshold),
    [filteredEvents, warningThreshold, criticalThreshold]
  )
  const allReviewCandidates = useMemo(
    () => taggingReviewCandidates(filteredEvents),
    [filteredEvents]
  )

  const reviewCandidates = useMemo(() => {
    return allReviewCandidates.filter(e => {
      if (reviewPlantFilter !== 'All' && e.plant !== reviewPlantFilter) return false
      if (!matchesReasonCategory(e.reasons, reviewReasonFilter)) return false
      return true
    })
  }, [allReviewCandidates, reviewPlantFilter, reviewReasonFilter])

  const reviewPlants = useMemo(() => {
    const plants = Array.from(new Set(allReviewCandidates.map(e => e.plant))).sort()
    return ['All', ...plants]
  }, [allReviewCandidates])

  const reviewHighlights = useMemo(
    () => computeReviewHighlights(allReviewCandidates),
    [allReviewCandidates]
  )

  const complianceColorCls = compliance.compliancePct >= complianceTarget
    ? 'text-success'
    : compliance.compliancePct >= complianceTarget - 5
      ? 'text-warning'
      : 'text-danger'

  // CSS var for inline styles (progress bar background, border-l etc.)
  const complianceCssVar = compliance.compliancePct >= complianceTarget
    ? 'var(--color-success)'
    : compliance.compliancePct >= complianceTarget - 5
      ? 'var(--color-warning)'
      : 'var(--color-danger)'

  const plannedStatusCls =
    planned.status === 'critical' ? 'text-danger' :
    planned.status === 'warning' ? 'text-warning' :
    'text-success'

  const plannedStatusBorderCls =
    planned.status === 'critical' ? 'border-l-danger' :
    planned.status === 'warning' ? 'border-l-warning' :
    'border-l-success'

  const plannedStatusBorderColorCls =
    planned.status === 'critical' ? 'border-danger' :
    planned.status === 'warning' ? 'border-warning' :
    'border-success'

  const plannedStatusCssVar =
    planned.status === 'critical' ? 'var(--color-danger)' :
    planned.status === 'warning' ? 'var(--color-warning)' :
    'var(--color-success)'

  if (events.length === 0) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        No downtime data loaded. Upload a Guidewheel issues CSV to enable tagging compliance analysis.
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* ── Date Range Filter ─────────────────────────────────────────────── */}
      <div className={cardCls}>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="bh-metric-label mb-1 block">
              From
            </label>
            <input
              type="date"
              value={effectiveDateFrom}
              min={dateExtent.min || undefined}
              max={dateExtent.max || undefined}
              onChange={e => setDateFrom(e.target.value)}
              className="text-sm rounded px-3 py-1.5 bg-background border border-border text-foreground"
            />
          </div>
          <div>
            <label className="bh-metric-label mb-1 block">
              To
            </label>
            <input
              type="date"
              value={effectiveDateTo}
              min={dateExtent.min || undefined}
              max={dateExtent.max || undefined}
              onChange={e => setDateTo(e.target.value)}
              className="text-sm rounded px-3 py-1.5 bg-background border border-border text-foreground"
            />
          </div>

          {/* Quick range buttons */}
          <div className="flex flex-wrap gap-1 items-end pb-0.5">
            {[
              { label: '7d', fn: () => { setDateFrom(daysAgoISO(7)); setDateTo(todayISO()) } },
              { label: '30d', fn: () => { setDateFrom(daysAgoISO(30)); setDateTo(todayISO()) } },
              { label: 'MTD', fn: () => { setDateFrom(startOfMonthISO()); setDateTo(todayISO()) } },
              { label: 'QTD', fn: () => { setDateFrom(startOfQuarterISO()); setDateTo(todayISO()) } },
              { label: 'YTD', fn: () => { setDateFrom(startOfYearISO()); setDateTo(todayISO()) } },
              { label: 'All', fn: () => { setDateFrom(''); setDateTo('') } },
            ].map(({ label, fn }) => (
              <button key={label} className={quickBtnCls} onClick={fn}>{label}</button>
            ))}
          </div>

          <div className="ml-auto text-right">
            <div className="text-xs text-muted-foreground">
              {filteredEvents.length.toLocaleString()} events in range
            </div>
            {(dateExtent.min || dateExtent.max) && (
              <div className="text-xs mt-0.5 text-muted-foreground">
                Available data: <span className="font-medium text-foreground">{dateExtent.min}</span>
                {' '}to{' '}
                <span className="font-medium text-foreground">{dateExtent.max}</span>
              </div>
            )}
          </div>
        </div>

        {noDataInRange && (
          <div className="mt-3 rounded px-3 py-2 text-xs font-semibold bg-danger/5 border border-danger/30 text-danger">
            No data available for the selected date range. Available data is {dateExtent.min} to {dateExtent.max}.
          </div>
        )}
        {dateBeforeData && (
          <div className="mt-3 rounded px-3 py-2 text-xs bg-warning/5 border border-warning/30 text-warning">
            ⚠ Selected start date is before available data. Displayed values begin on {dateExtent.min}.
          </div>
        )}
        {rangeExceedsData && (
          <div className="mt-3 rounded px-3 py-2 text-xs bg-warning/5 border border-warning/30 text-warning">
            ⚠ Selected end date is after latest uploaded data. Displayed values only reflect data through {dateExtent.max}.
          </div>
        )}
      </div>

      {/* ── Date range context ───────────────────────────────────────────── */}
      {(effectiveDateFrom || effectiveDateTo) && (
        <div className="text-xs text-muted-foreground px-1">
          Showing <span className="font-medium text-foreground">{effectiveDateFrom}</span> to <span className="font-medium text-foreground">{effectiveDateTo}</span>
          {' '}·{' '}{filteredEvents.length.toLocaleString()} events
          {dateExtent.min && (
            <span className="ml-2 text-muted-foreground">(available data: {dateExtent.min} to {dateExtent.max})</span>
          )}
        </div>
      )}

      {/* ── Summary KPI Cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={cardCls}>
          <div className="bh-metric-label mb-1">Total Events</div>
          <div className="text-3xl font-bold text-foreground">
            {compliance.totalEvents.toLocaleString()}
          </div>
          <div className="text-xs mt-1 text-muted-foreground">
            {fmtDuration(compliance.totalDuration)} total
          </div>
        </div>

        <div className={cardCls}>
          <div className="bh-metric-label mb-1">Tagged Events</div>
          <div className={`text-3xl font-bold ${complianceColorCls}`}>
            {compliance.taggedEvents.toLocaleString()}
          </div>
          <div className={`text-xs mt-1 ${complianceColorCls}`}>
            {fmt(compliance.compliancePct)}% compliance
          </div>
        </div>

        <div className={cardCls}>
          <div className="bh-metric-label mb-1">Untagged Events</div>
          <div className={`text-3xl font-bold ${compliance.untaggedEvents > 0 ? 'text-danger' : 'text-success'}`}>
            {compliance.untaggedEvents.toLocaleString()}
          </div>
          <div className="text-xs mt-1 text-muted-foreground">
            {fmtDuration(compliance.untaggedDuration)} untagged
          </div>
        </div>

        <div className={cardCls}>
          <div className="bh-metric-label mb-1">Gap to {fmt(complianceTarget)}% Target</div>
          <div className={`text-3xl font-bold ${compliance.gapToTarget <= 0 ? 'text-success' : 'text-danger'}`}>
            {compliance.gapToTarget <= 0 ? '✓' : `${fmt(compliance.gapToTarget)}pp`}
          </div>
          <div className="text-xs mt-1 text-muted-foreground">
            {compliance.gapToTarget <= 0 ? 'Target met' : `Need ${compliance.untaggedEvents} more tagged`}
          </div>
        </div>
      </div>

      {/* ── Compliance Progress Bar ───────────────────────────────────────── */}
      <div className={cardCls}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground">
            Tagging Compliance
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Target:</span>
            <input
              type="number"
              value={complianceTarget}
              min={80}
              max={100}
              step={0.5}
              onChange={e => onTargetChange(parseFloat(e.target.value) || 99.5)}
              className="text-xs rounded px-2 py-1 w-20 bg-background border border-border text-foreground"
            />
            <span className="text-xs text-muted-foreground">%</span>
          </div>
        </div>

        {/* Event-based compliance */}
        <div className="mb-4">
          <div className="flex justify-between text-xs mb-1 text-muted-foreground">
            <span>Event-based: {fmt(compliance.compliancePct)}%</span>
            <span>Target: {fmt(complianceTarget)}%</span>
          </div>
          <div className="relative h-4 rounded-full overflow-hidden bg-border">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(compliance.compliancePct, 100)}%`,
                background: complianceCssVar,
              }}
            />
            <div
              className="absolute top-0 h-full w-0.5"
              style={{ left: `${complianceTarget}%`, background: 'rgba(255,255,255,0.7)' }}
            />
          </div>
        </div>

        {/* Duration-weighted compliance */}
        <div>
          <div className="flex justify-between text-xs mb-1 text-muted-foreground">
            <span>Duration-weighted: {fmt(compliance.durationCompliancePct)}%</span>
            <span>{fmtDuration(compliance.taggedDuration)} of {fmtDuration(compliance.totalDuration)} tagged</span>
          </div>
          <div className="relative h-4 rounded-full overflow-hidden bg-border">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(compliance.durationCompliancePct, 100)}%`,
                background: compliance.durationCompliancePct >= complianceTarget
                  ? 'var(--color-success)'
                  : compliance.durationCompliancePct >= complianceTarget - 5
                    ? 'var(--color-warning)'
                    : 'var(--color-danger)',
              }}
            />
            <div
              className="absolute top-0 h-full w-0.5"
              style={{ left: `${complianceTarget}%`, background: 'rgba(255,255,255,0.7)' }}
            />
          </div>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Methodology:</span>
          {' '}Event-based counts whether each event has a tag. Duration-weighted measures tagged minutes as % of all downtime minutes.
          Events with blank tags or values like "No Tag" / "Not Tagged" are counted as untagged.
        </p>
      </div>

      {/* ── By Site Table ─────────────────────────────────────────────────── */}
      <div className={cardCls}>
        <h2 className="text-sm font-semibold mb-3 text-foreground">
          Compliance by Site (worst first)
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {['Site', 'Total', 'Tagged', 'Untagged', 'Compliance %', 'Untagged Duration'].map(h => (
                  <th key={h} className={tableHeaderCls}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {compliance.bySite.map(row => (
                <tr key={row.site}>
                  <td className={tableCellCls}><span className="font-medium">{row.site}</span></td>
                  <td className={tableCellCls}>{row.total.toLocaleString()}</td>
                  <td className={tableCellCls}>{row.tagged.toLocaleString()}</td>
                  <td className={`${tableCellCls} ${row.untagged > 0 ? 'text-danger' : ''}`}>
                    {row.untagged.toLocaleString()}
                  </td>
                  <td className={`${tableCellCls} font-semibold ${row.compliancePct >= complianceTarget ? 'text-success' : 'text-danger'}`}>
                    {fmt(row.compliancePct)}%
                  </td>
                  <td className={tableCellCls}>{fmtDuration(row.untaggedDuration)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── By Machine Table (top 10 worst) ──────────────────────────────── */}
      <div className={cardCls}>
        <h2 className="text-sm font-semibold mb-3 text-foreground">
          Compliance by Machine — Top 10 Worst
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {['Machine', 'Site', 'Total', 'Tagged', 'Untagged', 'Compliance %'].map(h => (
                  <th key={h} className={tableHeaderCls}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {compliance.byMachine.slice(0, 10).map(row => (
                <tr key={row.machine}>
                  <td className={tableCellCls}><span className="font-medium font-mono text-xs">{row.machine}</span></td>
                  <td className={tableCellCls}>{row.site}</td>
                  <td className={tableCellCls}>{row.total.toLocaleString()}</td>
                  <td className={tableCellCls}>{row.tagged.toLocaleString()}</td>
                  <td className={`${tableCellCls} ${row.untagged > 0 ? 'text-danger' : ''}`}>
                    {row.untagged.toLocaleString()}
                  </td>
                  <td className={`${tableCellCls} font-semibold ${row.compliancePct >= complianceTarget ? 'text-success' : 'text-danger'}`}>
                    {fmt(row.compliancePct)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── By Shift Table ────────────────────────────────────────────────── */}
      <div className={cardCls}>
        <h2 className="text-sm font-semibold mb-3 text-foreground">
          Compliance by Shift
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {['Shift', 'Total', 'Tagged', 'Untagged', 'Compliance %', 'Untagged Duration'].map(h => (
                  <th key={h} className={tableHeaderCls}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {compliance.byShift.map(row => (
                <tr key={row.shift}>
                  <td className={tableCellCls}><span className="font-medium">{row.shift}</span></td>
                  <td className={tableCellCls}>{row.total.toLocaleString()}</td>
                  <td className={tableCellCls}>{row.tagged.toLocaleString()}</td>
                  <td className={`${tableCellCls} ${row.untagged > 0 ? 'text-danger' : ''}`}>
                    {row.untagged.toLocaleString()}
                  </td>
                  <td className={`${tableCellCls} font-semibold ${row.compliancePct >= complianceTarget ? 'text-success' : 'text-danger'}`}>
                    {fmt(row.compliancePct)}%
                  </td>
                  <td className={tableCellCls}>{fmtDuration(row.untaggedDuration)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Tagging Review Candidates ─────────────────────────────────────── */}
      <div className={cardCls}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground">
            Tagging Review Candidates
            <span className={`ml-2 text-xs font-normal px-2 py-0.5 rounded-full ${
              allReviewCandidates.length > 0 ? 'bg-warning/10 text-warning' : 'bg-success/5 text-success'
            }`}>
              {allReviewCandidates.length} total
            </span>
          </h2>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-4 mb-3 pb-3 border-b border-border">
          <div>
            <label className="bh-metric-label mb-1 block">Plant</label>
            <select
              value={reviewPlantFilter}
              onChange={e => setReviewPlantFilter(e.target.value)}
              className="text-sm rounded px-3 py-1.5 bg-background border border-border text-foreground"
            >
              {reviewPlants.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="bh-metric-label mb-1 block">Review reason</label>
            <select
              value={reviewReasonFilter}
              onChange={e => setReviewReasonFilter(e.target.value)}
              className="text-sm rounded px-3 py-1.5 bg-background border border-border text-foreground"
            >
              {REVIEW_REASON_CATEGORIES.map(c => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          </div>
          {(reviewPlantFilter !== 'All' || reviewReasonFilter !== 'all') && (
            <div className="flex items-end gap-2 pb-0.5">
              <span className="text-xs text-muted-foreground">
                Showing {reviewCandidates.length} of {allReviewCandidates.length}
              </span>
              <button
                onClick={() => { setReviewPlantFilter('All'); setReviewReasonFilter('all') }}
                className="text-xs text-btn-primary hover:underline"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>

        {/* Review Highlights */}
        {reviewHighlights.length > 0 && (
          <div className="rounded-lg px-4 py-3 mb-3 bg-card border border-border">
            <div className="text-xs font-semibold text-foreground mb-2">
              Tagging Pattern Summary
              <span className="ml-2 font-normal text-muted-foreground">({effectiveDateFrom} to {effectiveDateTo})</span>
            </div>
            <ul className="space-y-1">
              {reviewHighlights.map((h, i) => (
                <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                  <span className="text-btn-primary mt-0.5">›</span>
                  <span>{h.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="rounded-lg px-4 py-3 mb-3 text-xs bg-warning/5 border border-warning/30 text-warning">
          Tagging accuracy requires operational review. Events are flagged based on patterns, duration, and tag usage. This does not prove tagging errors — supervisor review is required.
        </div>

        <div className="rounded-lg px-4 py-2 mb-4 text-xs bg-card border border-border text-muted-foreground">
          <span className="font-semibold text-foreground">Double-tagged events:</span>
          {' '}Events with the same tag repeated multiple times are shown for review because they may double-count downtime in tag-level analysis.
        </div>

        {reviewCandidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {allReviewCandidates.length === 0
              ? 'No review candidates found.'
              : 'No candidates match the current filters.'}
          </p>
        ) : (
          <div className="overflow-x-auto" style={{ maxHeight: 480, overflowY: 'auto' }}>
            <table className="w-full">
              <thead className="sticky top-0 bg-card z-10">
                <tr>
                  {['Machine', 'Site', 'Shift', 'Date', 'Duration', 'Tags', 'Reason(s) for Review'].map(h => (
                    <th key={h} className={tableHeaderCls}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reviewCandidates.slice(0, 200).map((e, i) => (
                  <tr key={i} className={e.reasons.some(r => r.toLowerCase().startsWith('double-tagged')) ? 'bg-danger/5' : ''}>
                    <td className={tableCellCls}><span className="font-mono text-xs">{e.device}</span></td>
                    <td className={tableCellCls}>{e.plant}</td>
                    <td className={tableCellCls}>{e.shift}</td>
                    <td className={tableCellCls}>{e.calendar_date}</td>
                    <td className={tableCellCls}>{fmtDuration(e.duration)}</td>
                    <td
                      className={tableCellCls}
                      style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={e.tags}
                    >
                      {e.tags || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className={tableCellCls}>
                      {e.reasons.map((r, ri) => (
                        <div key={ri} className={`text-xs ${r.toLowerCase().startsWith('double-tagged') ? 'text-danger' : 'text-warning'}`}>{r}</div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {reviewCandidates.length > 200 && (
              <p className="text-xs mt-2 px-2 text-muted-foreground">
                Showing 200 of {reviewCandidates.length} candidates. Use filters to narrow results.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Planned Downtime Review ───────────────────────────────────────── */}
      <div className={`${cardCls} border-l-4 ${plannedStatusBorderCls}`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-foreground">
            Planned Downtime Review
          </h2>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Warning:</span>
              <input
                type="number"
                value={warningThreshold}
                min={1}
                max={99}
                onChange={e => setWarningThreshold(parseFloat(e.target.value) || 30)}
                className="text-xs rounded px-2 py-1 w-16 bg-background border border-border text-foreground"
              />
              <span className="text-xs text-muted-foreground">%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Critical:</span>
              <input
                type="number"
                value={criticalThreshold}
                min={1}
                max={100}
                onChange={e => setCriticalThreshold(parseFloat(e.target.value) || 50)}
                className="text-xs rounded px-2 py-1 w-16 bg-background border border-border text-foreground"
              />
              <span className="text-xs text-muted-foreground">%</span>
            </div>
          </div>
        </div>

        <div className="rounded-lg px-4 py-3 mb-4 text-xs bg-danger/5 border border-danger/20 text-foreground">
          Planned downtime is intended for <strong>no orders, weekends, holidays, or planned shutdowns</strong>. Equipment dependencies, upstream/downstream constraints, and machine failures should not be classified as Planned unless Blackhawk leadership confirms that definition.
        </div>

        {/* Planned DT KPI */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          <div className={`${cardCls} ${plannedStatusBorderColorCls}`}>
            <div className="bh-metric-label mb-1">Planned DT %</div>
            <div className={`text-3xl font-bold ${plannedStatusCls}`}>
              {fmt(planned.plannedPct)}%
            </div>
            <div className={`text-xs mt-1 font-medium uppercase tracking-wider ${plannedStatusCls}`}>
              {planned.status}
            </div>
          </div>
          <div className={cardCls}>
            <div className="bh-metric-label mb-1">Planned Events</div>
            <div className="text-3xl font-bold text-foreground">{planned.plannedEvents.toLocaleString()}</div>
          </div>
          <div className={cardCls}>
            <div className="bh-metric-label mb-1">Planned Duration</div>
            <div className="text-2xl font-bold text-foreground">{fmtDuration(planned.plannedDuration)}</div>
          </div>
          <div className={cardCls}>
            <div className="bh-metric-label mb-1">Total DT Duration</div>
            <div className="text-2xl font-bold text-foreground">{fmtDuration(planned.totalDuration)}</div>
          </div>
        </div>

        {/* Shift coverage recommendation */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
          <div className="rounded-lg px-4 py-3 text-xs bg-warning/5 border border-warning/30 text-warning">
            <span className="font-semibold">Build backup tagging coverage on 2nd/3rd shift</span>
            <br />
            Off-shift planned downtime events may benefit from a secondary reviewer.
          </div>
          <div className="rounded-lg px-4 py-3 text-xs bg-warning/5 border border-warning/30 text-warning">
            <span className="font-semibold">Review after-hours untagged events</span>
            <br />
            Untagged events on 2nd/3rd shift represent the highest-priority compliance gap.
          </div>
        </div>

        {/* Planned DT by Site */}
        <div className="mb-5">
          <h3 className="bh-metric-label mb-2">By Site</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  {['Site', 'Total Events', 'Planned Events', 'Planned %', 'Total Duration', 'Planned Duration'].map(h => (
                    <th key={h} className={tableHeaderCls}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {planned.bySite.map(row => {
                  const pctCls = row.plannedPct >= criticalThreshold ? 'text-danger' : row.plannedPct >= warningThreshold ? 'text-warning' : 'text-success'
                  return (
                    <tr key={row.site}>
                      <td className={tableCellCls}><span className="font-medium">{row.site}</span></td>
                      <td className={tableCellCls}>{row.total.toLocaleString()}</td>
                      <td className={tableCellCls}>{row.planned.toLocaleString()}</td>
                      <td className={`${tableCellCls} font-semibold ${pctCls}`}>
                        {fmt(row.plannedPct)}%
                      </td>
                      <td className={tableCellCls}>{fmtDuration(row.totalDuration)}</td>
                      <td className={tableCellCls}>{fmtDuration(row.plannedDuration)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Planned DT by Shift */}
        <div className="mb-5">
          <h3 className="bh-metric-label mb-2">By Shift</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  {['Shift', 'Total Events', 'Planned Events', 'Planned %', 'Total Duration', 'Planned Duration'].map(h => (
                    <th key={h} className={tableHeaderCls}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {planned.byShift.map(row => {
                  const pctCls = row.plannedPct >= criticalThreshold ? 'text-danger' : row.plannedPct >= warningThreshold ? 'text-warning' : 'text-success'
                  return (
                    <tr key={row.shift}>
                      <td className={tableCellCls}><span className="font-medium">{row.shift}</span></td>
                      <td className={tableCellCls}>{row.total.toLocaleString()}</td>
                      <td className={tableCellCls}>{row.planned.toLocaleString()}</td>
                      <td className={`${tableCellCls} font-semibold ${pctCls}`}>
                        {fmt(row.plannedPct)}%
                      </td>
                      <td className={tableCellCls}>{fmtDuration(row.totalDuration)}</td>
                      <td className={tableCellCls}>{fmtDuration(row.plannedDuration)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Planned DT Trend Chart */}
        {planned.trend.length > 0 && (
          <div className="mb-5">
            <h3 className="bh-metric-label mb-3">Planned DT % Trend</h3>
            <div style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={planned.trend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis dataKey="date" tick={axisTick} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
                  <YAxis tick={axisTick} tickFormatter={v => `${Math.round(v)}%`} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v: number) => [`${fmt(v)}%`, 'Planned DT %']}
                  />
                  <Line
                    type="monotone"
                    dataKey="plannedPct"
                    stroke={plannedStatusCssVar}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Definitions callout */}
        <div className="rounded-lg overflow-hidden border border-border">
          <button
            className="w-full text-left px-4 py-3 flex items-center justify-between text-sm font-semibold bg-background text-foreground"
            onClick={() => setShowDefinitions(v => !v)}
          >
            <span>Planned Downtime: When to Use It</span>
            <span className="text-muted-foreground">{showDefinitions ? '▲' : '▼'}</span>
          </button>
          {showDefinitions && (
            <div className="px-4 py-3 text-sm bg-card">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="font-semibold mb-2 text-success">Use for:</p>
                  <ul className="space-y-1 text-xs text-foreground">
                    <li>• No orders</li>
                    <li>• Weekends</li>
                    <li>• Holidays</li>
                    <li>• Planned shutdowns</li>
                  </ul>
                </div>
                <div>
                  <p className="font-semibold mb-2 text-danger">Do NOT use for:</p>
                  <ul className="space-y-1 text-xs text-foreground">
                    <li>• Upstream/downstream machine issues</li>
                    <li>• Hopper full / blocked flow</li>
                    <li>• Machine dependency issues</li>
                    <li>• Equipment malfunction</li>
                    <li>• Machine repair</li>
                  </ul>
                </div>
              </div>
              <p className="mt-3 text-xs italic text-muted-foreground">
                Final definitions should be confirmed by Blackhawk leadership during supervisor training.
              </p>
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
