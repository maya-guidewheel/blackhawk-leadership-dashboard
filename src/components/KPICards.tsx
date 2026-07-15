import type { StatsSummary, ColorChangeEvent, ChangeoverTargets } from '../data/types'
import { formatDuration } from '../utils/dates'
import { isOnTarget } from '../data/targets'

interface Props {
  stats: StatsSummary
  targets: ChangeoverTargets
  events: ColorChangeEvent[]
}

export default function KPICards({ stats, targets, events }: Props) {
  // On-target uses each event's own per-type target (color 45 / roll 10 / foam 10).
  const onTargetCount = events.filter(e => isOnTarget(e, targets)).length
  const overTargetCount = events.length - onTargetCount
  const onTargetPct = events.length > 0
    ? Math.round((onTargetCount / events.length) * 100)
    : 0

  const pctColorClass = onTargetPct >= 90
    ? 'text-success'
    : onTargetPct >= 70
    ? 'text-warning'
    : 'text-danger'

  const metricCards: { label: string; value: string; suffix?: string; colorClass?: string }[] = [
    { label: 'Total Changeovers', value: stats.count.toLocaleString() },
    { label: '% On Target', value: `${onTargetPct}%`, colorClass: pctColorClass },
    { label: 'Over Target', value: overTargetCount.toLocaleString(), colorClass: overTargetCount > 0 ? 'text-danger' : 'text-success' },
    { label: 'Average Duration', value: formatDuration(stats.avg) },
    { label: 'Cumulative Duration', value: formatDuration(stats.total) },
    { label: 'Median Duration', value: formatDuration(stats.median) },
    { label: '90th Percentile', value: formatDuration(stats.p90) },
    { label: 'Fastest Event', value: formatDuration(stats.fastest) },
    { label: 'Slowest Event', value: formatDuration(stats.slowest) },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-7">
      {metricCards.map(c => (
        <div
          key={c.label}
          className="rounded-lg border border-border bg-card p-4 transition-shadow hover:shadow-sm"
        >
          <div className="bh-metric-label mb-2">{c.label}</div>
          <div className="flex items-baseline gap-1">
            <span className={`text-2xl font-semibold leading-none ${c.colorClass ?? 'text-foreground'}`}>
              {c.value}
            </span>
            {c.suffix && (
              <span className="text-xs font-medium text-muted-foreground">
                {c.suffix.trim()}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
