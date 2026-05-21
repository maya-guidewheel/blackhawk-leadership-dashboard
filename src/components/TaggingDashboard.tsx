import { useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'
import type { DowntimeEvent } from '../data/types'
import {
  taggingCompliance,
  plannedDowntimeAnalysis,
  taggingReviewCandidates,
} from '../data/taggingAggregations'

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

export default function TaggingDashboard({ events, complianceTarget, onTargetChange }: Props) {
  const [showDefinitions, setShowDefinitions] = useState(false)
  const [warningThreshold, setWarningThreshold] = useState(30)
  const [criticalThreshold, setCriticalThreshold] = useState(50)

  const compliance = useMemo(
    () => taggingCompliance(events, complianceTarget),
    [events, complianceTarget]
  )
  const planned = useMemo(
    () => plannedDowntimeAnalysis(events, warningThreshold, criticalThreshold),
    [events, warningThreshold, criticalThreshold]
  )
  const reviewCandidates = useMemo(() => taggingReviewCandidates(events), [events])

  const complianceColor = compliance.compliancePct >= complianceTarget
    ? 'var(--color-accent)'
    : compliance.compliancePct >= complianceTarget - 5
      ? '#f59e0b'
      : 'var(--color-danger)'

  const plannedStatusColor =
    planned.status === 'critical' ? 'var(--color-danger)' :
    planned.status === 'warning' ? '#f59e0b' :
    'var(--color-accent)'

  if (events.length === 0) {
    return (
      <div className="text-center py-20" style={{ color: 'var(--color-muted)' }}>
        No downtime data loaded. Upload a Guidewheel issues CSV to enable tagging compliance analysis.
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* ── Summary KPI Cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div style={cardStyle}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Total Events</div>
          <div className="text-3xl font-bold" style={{ color: 'var(--color-text)' }}>
            {compliance.totalEvents.toLocaleString()}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            {fmtDuration(compliance.totalDuration)} total
          </div>
        </div>

        <div style={cardStyle}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Tagged Events</div>
          <div className="text-3xl font-bold" style={{ color: complianceColor }}>
            {compliance.taggedEvents.toLocaleString()}
          </div>
          <div className="text-xs mt-1" style={{ color: complianceColor }}>
            {fmt(compliance.compliancePct)}% compliance
          </div>
        </div>

        <div style={cardStyle}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Untagged Events</div>
          <div
            className="text-3xl font-bold"
            style={{ color: compliance.untaggedEvents > 0 ? 'var(--color-danger)' : 'var(--color-accent)' }}
          >
            {compliance.untaggedEvents.toLocaleString()}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            {fmtDuration(compliance.untaggedDuration)} untagged
          </div>
        </div>

        <div style={cardStyle}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Gap to {fmt(complianceTarget)}% Target</div>
          <div
            className="text-3xl font-bold"
            style={{ color: compliance.gapToTarget <= 0 ? 'var(--color-accent)' : 'var(--color-danger)' }}
          >
            {compliance.gapToTarget <= 0 ? '✓' : `${fmt(compliance.gapToTarget)}pp`}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            {compliance.gapToTarget <= 0 ? 'Target met' : `Need ${compliance.untaggedEvents} more tagged`}
          </div>
        </div>
      </div>

      {/* ── Compliance Progress Bar ───────────────────────────────────────── */}
      <div style={cardStyle}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            Tagging Compliance
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Target:</span>
            <input
              type="number"
              value={complianceTarget}
              min={80}
              max={100}
              step={0.5}
              onChange={e => onTargetChange(parseFloat(e.target.value) || 99.5)}
              className="text-xs rounded px-2 py-1 w-20"
              style={{
                background: 'var(--color-background)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
              }}
            />
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>%</span>
          </div>
        </div>

        {/* Event-based compliance */}
        <div className="mb-4">
          <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--color-muted)' }}>
            <span>Event-based: {fmt(compliance.compliancePct)}%</span>
            <span>Target: {fmt(complianceTarget)}%</span>
          </div>
          <div className="relative h-4 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(compliance.compliancePct, 100)}%`,
                background: complianceColor,
              }}
            />
            {/* Target line */}
            <div
              className="absolute top-0 h-full w-0.5"
              style={{
                left: `${complianceTarget}%`,
                background: 'rgba(255,255,255,0.7)',
              }}
            />
          </div>
        </div>

        {/* Duration-weighted compliance */}
        <div>
          <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--color-muted)' }}>
            <span>Duration-weighted: {fmt(compliance.durationCompliancePct)}%</span>
            <span>{fmtDuration(compliance.taggedDuration)} of {fmtDuration(compliance.totalDuration)} tagged</span>
          </div>
          <div className="relative h-4 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(compliance.durationCompliancePct, 100)}%`,
                background: compliance.durationCompliancePct >= complianceTarget
                  ? 'var(--color-accent)'
                  : compliance.durationCompliancePct >= complianceTarget - 5
                    ? '#f59e0b'
                    : 'var(--color-danger)',
              }}
            />
            <div
              className="absolute top-0 h-full w-0.5"
              style={{ left: `${complianceTarget}%`, background: 'rgba(255,255,255,0.7)' }}
            />
          </div>
        </div>

        <p className="mt-3 text-xs" style={{ color: 'var(--color-muted)' }}>
          Event-based compliance: counts whether each event has a tag. Duration-weighted compliance: measures tagged minutes as % of all downtime minutes.
        </p>
      </div>

      {/* ── By Site Table ─────────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>
          Compliance by Site (worst first)
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {['Site', 'Total', 'Tagged', 'Untagged', 'Compliance %', 'Untagged Duration'].map(h => (
                  <th key={h} style={tableHeaderStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {compliance.bySite.map(row => (
                <tr key={row.site}>
                  <td style={tableCellStyle}><span className="font-medium">{row.site}</span></td>
                  <td style={tableCellStyle}>{row.total.toLocaleString()}</td>
                  <td style={tableCellStyle}>{row.tagged.toLocaleString()}</td>
                  <td style={{ ...tableCellStyle, color: row.untagged > 0 ? 'var(--color-danger)' : 'var(--color-text)' }}>
                    {row.untagged.toLocaleString()}
                  </td>
                  <td style={{ ...tableCellStyle, color: row.compliancePct >= complianceTarget ? 'var(--color-accent)' : 'var(--color-danger)', fontWeight: 600 }}>
                    {fmt(row.compliancePct)}%
                  </td>
                  <td style={tableCellStyle}>{fmtDuration(row.untaggedDuration)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── By Machine Table (top 10 worst) ──────────────────────────────── */}
      <div style={cardStyle}>
        <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>
          Compliance by Machine — Top 10 Worst
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {['Machine', 'Site', 'Total', 'Tagged', 'Untagged', 'Compliance %'].map(h => (
                  <th key={h} style={tableHeaderStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {compliance.byMachine.slice(0, 10).map(row => (
                <tr key={row.machine}>
                  <td style={tableCellStyle}><span className="font-medium font-mono text-xs">{row.machine}</span></td>
                  <td style={tableCellStyle}>{row.site}</td>
                  <td style={tableCellStyle}>{row.total.toLocaleString()}</td>
                  <td style={tableCellStyle}>{row.tagged.toLocaleString()}</td>
                  <td style={{ ...tableCellStyle, color: row.untagged > 0 ? 'var(--color-danger)' : 'var(--color-text)' }}>
                    {row.untagged.toLocaleString()}
                  </td>
                  <td style={{ ...tableCellStyle, color: row.compliancePct >= complianceTarget ? 'var(--color-accent)' : 'var(--color-danger)', fontWeight: 600 }}>
                    {fmt(row.compliancePct)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── By Shift Table ────────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>
          Compliance by Shift
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {['Shift', 'Total', 'Tagged', 'Untagged', 'Compliance %', 'Untagged Duration'].map(h => (
                  <th key={h} style={tableHeaderStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {compliance.byShift.map(row => (
                <tr key={row.shift}>
                  <td style={tableCellStyle}><span className="font-medium">{row.shift}</span></td>
                  <td style={tableCellStyle}>{row.total.toLocaleString()}</td>
                  <td style={tableCellStyle}>{row.tagged.toLocaleString()}</td>
                  <td style={{ ...tableCellStyle, color: row.untagged > 0 ? 'var(--color-danger)' : 'var(--color-text)' }}>
                    {row.untagged.toLocaleString()}
                  </td>
                  <td style={{ ...tableCellStyle, color: row.compliancePct >= complianceTarget ? 'var(--color-accent)' : 'var(--color-danger)', fontWeight: 600 }}>
                    {fmt(row.compliancePct)}%
                  </td>
                  <td style={tableCellStyle}>{fmtDuration(row.untaggedDuration)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Tagging Review Candidates ─────────────────────────────────────── */}
      <div style={cardStyle}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            Tagging Review Candidates
            <span
              className="ml-2 text-xs font-normal px-2 py-0.5 rounded-full"
              style={{ background: reviewCandidates.length > 0 ? '#fef3c7' : '#f0fdf4', color: reviewCandidates.length > 0 ? '#92400e' : '#166534' }}
            >
              {reviewCandidates.length} events
            </span>
          </h2>
        </div>

        <div
          className="rounded-lg px-4 py-3 mb-4 text-xs"
          style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}
        >
          These events may need supervisor review based on patterns and duration. This does not prove tagging errors.
        </div>

        {reviewCandidates.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No review candidates found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  {['Machine', 'Site', 'Shift', 'Duration', 'Tags', 'Reason(s) for Review'].map(h => (
                    <th key={h} style={tableHeaderStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reviewCandidates.slice(0, 50).map((e, i) => (
                  <tr key={i}>
                    <td style={tableCellStyle}><span className="font-mono text-xs">{e.device}</span></td>
                    <td style={tableCellStyle}>{e.plant}</td>
                    <td style={tableCellStyle}>{e.shift}</td>
                    <td style={tableCellStyle}>{fmtDuration(e.duration)}</td>
                    <td style={{ ...tableCellStyle, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.tags || <span style={{ color: 'var(--color-muted)' }}>—</span>}
                    </td>
                    <td style={tableCellStyle}>
                      {e.reasons.map((r, ri) => (
                        <div key={ri} className="text-xs" style={{ color: '#92400e' }}>{r}</div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {reviewCandidates.length > 50 && (
              <p className="text-xs mt-2 px-2" style={{ color: 'var(--color-muted)' }}>
                Showing 50 of {reviewCandidates.length} candidates.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Planned Downtime Review ───────────────────────────────────────── */}
      <div style={{ ...cardStyle, borderLeft: `4px solid ${plannedStatusColor}` }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            Planned Downtime Review
          </h2>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Warning:</span>
              <input
                type="number"
                value={warningThreshold}
                min={1}
                max={99}
                onChange={e => setWarningThreshold(parseFloat(e.target.value) || 30)}
                className="text-xs rounded px-2 py-1 w-16"
                style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              />
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Critical:</span>
              <input
                type="number"
                value={criticalThreshold}
                min={1}
                max={100}
                onChange={e => setCriticalThreshold(parseFloat(e.target.value) || 50)}
                className="text-xs rounded px-2 py-1 w-16"
                style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              />
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>%</span>
            </div>
          </div>
        </div>

        {/* Planned DT KPI */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          <div style={{ ...cardStyle, borderColor: plannedStatusColor }}>
            <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Planned DT %</div>
            <div className="text-3xl font-bold" style={{ color: plannedStatusColor }}>
              {fmt(planned.plannedPct)}%
            </div>
            <div
              className="text-xs mt-1 font-medium uppercase tracking-wider"
              style={{ color: plannedStatusColor }}
            >
              {planned.status}
            </div>
          </div>
          <div style={cardStyle}>
            <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Planned Events</div>
            <div className="text-3xl font-bold" style={{ color: 'var(--color-text)' }}>{planned.plannedEvents.toLocaleString()}</div>
          </div>
          <div style={cardStyle}>
            <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Planned Duration</div>
            <div className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{fmtDuration(planned.plannedDuration)}</div>
          </div>
          <div style={cardStyle}>
            <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Total DT Duration</div>
            <div className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{fmtDuration(planned.totalDuration)}</div>
          </div>
        </div>

        {/* Shift coverage recommendation */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
          <div
            className="rounded-lg px-4 py-3 text-xs"
            style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', color: '#92400e' }}
          >
            <span className="font-semibold">Build backup tagging coverage on 2nd/3rd shift</span>
            <br />
            Off-shift planned downtime events may benefit from a secondary reviewer.
          </div>
          <div
            className="rounded-lg px-4 py-3 text-xs"
            style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', color: '#92400e' }}
          >
            <span className="font-semibold">Review after-hours untagged events</span>
            <br />
            Untagged events on 2nd/3rd shift represent the highest-priority compliance gap.
          </div>
        </div>

        {/* Planned DT by Site */}
        <div className="mb-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>By Site</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  {['Site', 'Total Events', 'Planned Events', 'Planned %', 'Total Duration', 'Planned Duration'].map(h => (
                    <th key={h} style={tableHeaderStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {planned.bySite.map(row => (
                  <tr key={row.site}>
                    <td style={tableCellStyle}><span className="font-medium">{row.site}</span></td>
                    <td style={tableCellStyle}>{row.total.toLocaleString()}</td>
                    <td style={tableCellStyle}>{row.planned.toLocaleString()}</td>
                    <td style={{ ...tableCellStyle, fontWeight: 600, color: row.plannedPct >= criticalThreshold ? 'var(--color-danger)' : row.plannedPct >= warningThreshold ? '#f59e0b' : 'var(--color-accent)' }}>
                      {fmt(row.plannedPct)}%
                    </td>
                    <td style={tableCellStyle}>{fmtDuration(row.totalDuration)}</td>
                    <td style={tableCellStyle}>{fmtDuration(row.plannedDuration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Planned DT by Shift */}
        <div className="mb-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>By Shift</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  {['Shift', 'Total Events', 'Planned Events', 'Planned %', 'Total Duration', 'Planned Duration'].map(h => (
                    <th key={h} style={tableHeaderStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {planned.byShift.map(row => (
                  <tr key={row.shift}>
                    <td style={tableCellStyle}><span className="font-medium">{row.shift}</span></td>
                    <td style={tableCellStyle}>{row.total.toLocaleString()}</td>
                    <td style={tableCellStyle}>{row.planned.toLocaleString()}</td>
                    <td style={{ ...tableCellStyle, fontWeight: 600, color: row.plannedPct >= criticalThreshold ? 'var(--color-danger)' : row.plannedPct >= warningThreshold ? '#f59e0b' : 'var(--color-accent)' }}>
                      {fmt(row.plannedPct)}%
                    </td>
                    <td style={tableCellStyle}>{fmtDuration(row.totalDuration)}</td>
                    <td style={tableCellStyle}>{fmtDuration(row.plannedDuration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Planned DT Trend Chart */}
        {planned.trend.length > 0 && (
          <div className="mb-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-muted)' }}>Planned DT % Trend</h3>
            <div style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={planned.trend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--color-muted)' }} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--color-muted)' }} tickFormatter={v => `${Math.round(v)}%`} />
                  <Tooltip
                    contentStyle={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 11 }}
                    formatter={(v: number) => [`${fmt(v)}%`, 'Planned DT %']}
                  />
                  <Line
                    type="monotone"
                    dataKey="plannedPct"
                    stroke={plannedStatusColor}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Definitions callout */}
        <div
          className="rounded-lg overflow-hidden"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <button
            className="w-full text-left px-4 py-3 flex items-center justify-between text-sm font-semibold"
            style={{ background: 'var(--color-background)', color: 'var(--color-text)' }}
            onClick={() => setShowDefinitions(v => !v)}
          >
            <span>Planned Downtime: When to Use It</span>
            <span style={{ color: 'var(--color-muted)' }}>{showDefinitions ? '▲' : '▼'}</span>
          </button>
          {showDefinitions && (
            <div className="px-4 py-3 text-sm" style={{ background: 'var(--color-card)' }}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="font-semibold mb-2" style={{ color: 'var(--color-accent)' }}>Use for:</p>
                  <ul className="space-y-1 text-xs" style={{ color: 'var(--color-text)' }}>
                    <li>• No orders</li>
                    <li>• Weekends</li>
                    <li>• Holidays</li>
                    <li>• Planned shutdowns</li>
                  </ul>
                </div>
                <div>
                  <p className="font-semibold mb-2" style={{ color: 'var(--color-danger)' }}>Do NOT use for:</p>
                  <ul className="space-y-1 text-xs" style={{ color: 'var(--color-text)' }}>
                    <li>• Upstream/downstream machine issues</li>
                    <li>• Hopper full / blocked flow</li>
                    <li>• Machine dependency issues</li>
                    <li>• Equipment malfunction</li>
                    <li>• Machine repair</li>
                  </ul>
                </div>
              </div>
              <p className="mt-3 text-xs italic" style={{ color: 'var(--color-muted)' }}>
                Final definitions should be confirmed by Blackhawk leadership during supervisor training.
              </p>
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
