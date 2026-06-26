import { useMemo } from 'react'
import type { ColorChangeEvent, DowntimeEvent, RuntimeRecord, OEERecord } from '../data/types'
import { deviceSummaries } from '../data/aggregations'
import { taggingCompliance, plannedDowntimeAnalysis, taggingReviewCandidates } from '../data/taggingAggregations'

interface Props {
  changeoverEvents: ColorChangeEvent[]   // changeover-tagged issues
  downtimeEvents: DowntimeEvent[]         // all issues / downtime
  runtimeRecords: RuntimeRecord[]
  oeeRecords: OEERecord[]
}

type Confidence = 'High' | 'Medium' | 'Low'

interface Callout {
  id: string
  category: string
  title: string
  plant: string
  scope: string          // machine/device/group
  dateRange: string
  why: string
  action: string
  confidence: Confidence
  related: string        // dashboard tab/section
}

const CHANGEOVER_TARGET_MIN = 45

function dateRangeOf(dates: string[]): string {
  const valid = dates.filter(Boolean).sort()
  if (valid.length === 0) return '—'
  return `${valid[0]} to ${valid[valid.length - 1]}`
}

const SEV_CLS: Record<string, string> = {
  Idle: 'border-l-warning',
  Tagging: 'border-l-btn-primary',
  Changeover: 'border-l-danger',
  'Data Quality': 'border-l-warning',
  'Data Gap': 'border-l-muted-foreground',
}

const CONF_CLS: Record<Confidence, string> = {
  High: 'bg-danger/10 text-danger',
  Medium: 'bg-warning/10 text-warning',
  Low: 'bg-background-accent text-muted-foreground',
}

export default function ManagerCallouts({ changeoverEvents, downtimeEvents, runtimeRecords, oeeRecords }: Props) {
  const callouts = useMemo<Callout[]>(() => {
    const out: Callout[] = []

    // ── 1. High idle / low uptime machines (runtime data) ──
    if (runtimeRecords.length > 0) {
      const byDevice = new Map<string, { plant: string; pcts: number[] }>()
      for (const r of runtimeRecords) {
        if (!r?.device) continue
        if (!byDevice.has(r.device)) byDevice.set(r.device, { plant: r.plant, pcts: [] })
        if (Number.isFinite(r.runtimePct)) byDevice.get(r.device)!.pcts.push(r.runtimePct)
      }
      const lowUptime = Array.from(byDevice.entries())
        .filter(([, v]) => v.pcts.length >= 5)
        .map(([device, v]) => ({ device, plant: v.plant, avg: v.pcts.reduce((s, p) => s + p, 0) / v.pcts.length, n: v.pcts.length }))
        .filter(d => d.avg < 50)
        .sort((a, b) => a.avg - b.avg)
        .slice(0, 5)
      const rtRange = dateRangeOf(runtimeRecords.map(r => r.date))
      for (const d of lowUptime) {
        out.push({
          id: `idle-${d.device}`, category: 'Idle',
          title: `Low average uptime (${d.avg.toFixed(0)}%)`,
          plant: d.plant, scope: d.device, dateRange: rtRange,
          why: `Machine ran at ${d.avg.toFixed(0)}% average uptime across ${d.n} shift-days — a high share of monitored time was idle/down.`,
          action: 'Confirm whether this idle state is expected (no orders / planned) or recoverable; review with the team.',
          confidence: d.n >= 20 ? 'High' : 'Medium',
          related: 'Energy vs Uptime · Energy & Cost (Idle Waste)',
        })
      }
    }

    // ── 2. Tagging compliance gaps (per machine) ──
    if (downtimeEvents.length > 0) {
      const comp = taggingCompliance(downtimeEvents, 99.5)
      const dtRange = dateRangeOf(downtimeEvents.map(e => e.calendar_date))
      const worstMachines = comp.byMachine.filter(m => m.total >= 10 && m.compliancePct < 90).slice(0, 5)
      for (const m of worstMachines) {
        out.push({
          id: `tag-${m.machine}`, category: 'Tagging',
          title: `Tagging compliance ${m.compliancePct.toFixed(0)}% (${m.untagged} untagged)`,
          plant: m.site, scope: m.machine, dateRange: dtRange,
          why: `${m.untagged} of ${m.total} downtime events are untagged — gaps reduce the accuracy of every downstream analysis.`,
          action: 'Investigate tagging consistency with the shift teams responsible for this machine.',
          confidence: m.total >= 40 ? 'High' : 'Medium',
          related: 'Tagging & Downtime',
        })
      }

      // ── 3. Broad catch-all "Planned" overuse (per site) ──
      const planned = plannedDowntimeAnalysis(downtimeEvents, 30, 50)
      for (const s of planned.bySite.filter(s => s.plannedPct >= 40 && s.total >= 20).slice(0, 3)) {
        out.push({
          id: `planned-${s.site}`, category: 'Tagging',
          title: `High "Planned" share (${s.plannedPct.toFixed(0)}% of downtime)`,
          plant: s.site, scope: 'All machines (site-level)', dateRange: dtRange,
          why: `A large share of downtime is tagged "Planned" — broad catch-all tags can mask equipment or scheduling issues.`,
          action: 'Review whether "Planned" is being used for unplanned states (equipment dependency, machine issues).',
          confidence: 'Medium',
          related: 'Tagging & Downtime (Planned Downtime Review)',
        })
      }

      // ── 4. Review candidates / double-tagging ──
      const review = taggingReviewCandidates(downtimeEvents)
      const doubles = review.filter(e => e.reasons.some(r => r.toLowerCase().startsWith('double-tagged')))
      if (doubles.length > 0) {
        out.push({
          id: 'double-tagging', category: 'Data Quality',
          title: `${doubles.length} double-tagged events flagged`,
          plant: 'Multiple', scope: 'See review candidates', dateRange: dtRange,
          why: 'Events with the same tag repeated may double-count downtime in tag-level analysis.',
          action: 'Data quality review needed — confirm tagging procedure with supervisors.',
          confidence: doubles.length >= 20 ? 'High' : 'Medium',
          related: 'Tagging & Downtime (Review Candidates)',
        })
      }
      if (review.length > 0) {
        out.push({
          id: 'review-candidates', category: 'Data Quality',
          title: `${review.length} tagging review candidates`,
          plant: 'Multiple', scope: 'Mixed machines', dateRange: dtRange,
          why: 'Events flagged by duration/pattern/tag heuristics may indicate tagging inconsistencies.',
          action: 'Review with team — these are candidates, not confirmed errors.',
          confidence: 'Low',
          related: 'Tagging & Downtime (Review Candidates)',
        })
      }
    }

    // ── 5. Off-target changeover performance (per device) ──
    if (changeoverEvents.length > 0) {
      const devs = deviceSummaries(changeoverEvents)
      const coRange = dateRangeOf(changeoverEvents.map(e => e.calendar_date))
      const offTarget = devs
        .filter(d => d.count >= 3 && d.p90 > CHANGEOVER_TARGET_MIN)
        .map(d => ({ ...d, gap: d.p90 - CHANGEOVER_TARGET_MIN }))
        .sort((a, b) => b.gap - a.gap)
        .slice(0, 5)
      for (const d of offTarget) {
        out.push({
          id: `co-${d.device}`, category: 'Changeover',
          title: `Changeover P90 ${Math.round(d.p90)} min (target ${CHANGEOVER_TARGET_MIN})`,
          plant: d.plant, scope: d.device, dateRange: coRange,
          why: `90th-percentile changeover time is ${Math.round(d.gap)} min above target across ${d.count} changeovers.`,
          action: 'Review changeover procedure with the team; look for setup/scheduling improvements.',
          confidence: d.count >= 10 ? 'High' : 'Medium',
          related: 'Changeover',
        })
      }
    }

    // ── 6. Missing data / low confidence ──
    if (oeeRecords.length === 0) {
      out.push({
        id: 'gap-oee', category: 'Data Gap',
        title: 'No production / OEE data loaded',
        plant: 'All', scope: 'All machines', dateRange: '—',
        why: 'Without production/job data, job-to-color-change ratio and production-normalized metrics cannot be computed.',
        action: 'Upload a Production/OEE export (with batch/job numbers) to enable these analyses.',
        confidence: 'High', related: 'Changeover (Job-to-Color-Change) · OEE Trends',
      })
    }
    if (runtimeRecords.length === 0) {
      out.push({
        id: 'gap-runtime', category: 'Data Gap',
        title: 'No runtime / uptime trends data loaded',
        plant: 'All', scope: 'All machines', dateRange: '—',
        why: 'Idle/uptime callouts use actual runtime; without it, idle is only estimated from downtime.',
        action: 'Upload a Guidewheel Trends (runtime) export to improve idle/uptime accuracy.',
        confidence: 'High', related: 'Energy vs Uptime',
      })
    }

    return out
  }, [changeoverEvents, downtimeEvents, runtimeRecords, oeeRecords])

  const hasAnyData = changeoverEvents.length > 0 || downtimeEvents.length > 0 || runtimeRecords.length > 0 || oeeRecords.length > 0

  return (
    <div className="space-y-5">
      <div className="bh-card p-5">
        <h2 className="text-base font-semibold mb-1 text-foreground">Manager Callouts</h2>
        <p className="text-sm text-muted-foreground">
          Operational coaching prompts generated automatically from the currently loaded data — no costs or dollar values.
          Each callout is a starting point for review, not a confirmed finding. Investigate in the linked tab before acting.
        </p>
      </div>

      {!hasAnyData ? (
        <div className="bh-card p-8 text-center text-sm text-muted-foreground">
          No data loaded yet. Upload Issues, Runtime/Trends, or Production/OEE data to generate manager callouts.
        </div>
      ) : callouts.length === 0 ? (
        <div className="bh-card p-8 text-center text-sm text-muted-foreground">
          No callouts triggered from the current data — nothing exceeded the review thresholds. This is a good sign, or more data may be needed.
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {callouts.map(c => (
            <div key={c.id} className={`bh-card p-4 border-l-4 ${SEV_CLS[c.category] ?? 'border-l-btn-primary'}`}>
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="bh-metric-label">{c.category}</span>
                <span className={`text-[0.65rem] font-semibold px-2 py-0.5 rounded-full ${CONF_CLS[c.confidence]}`}>
                  {c.confidence} confidence
                </span>
              </div>
              <div className="text-sm font-semibold text-foreground mb-1">{c.title}</div>
              <div className="text-xs text-muted-foreground mb-2">
                <span className="font-medium text-foreground">{c.plant}</span> · {c.scope} · {c.dateRange}
              </div>
              <div className="text-xs text-muted-foreground mb-1"><span className="font-semibold text-foreground">Why it matters:</span> {c.why}</div>
              <div className="text-xs text-muted-foreground mb-1"><span className="font-semibold text-foreground">Suggested action:</span> {c.action}</div>
              <div className="text-xs text-muted-foreground"><span className="font-semibold text-foreground">Investigate in:</span> {c.related}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
