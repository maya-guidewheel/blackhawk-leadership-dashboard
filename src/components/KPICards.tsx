import type { StatsSummary, ColorChangeEvent } from '../data/types'
import { formatDuration } from '../utils/dates'

interface Props {
  stats: StatsSummary
  threshold: number
  events: ColorChangeEvent[]
}

export default function KPICards({ stats, threshold, events }: Props) {
  const onTargetPct = events.length > 0
    ? Math.round((events.filter(e => e.duration <= threshold).length / events.length) * 100)
    : 0

  const pctColorClass = onTargetPct >= 90
    ? 'text-success'
    : onTargetPct >= 70
    ? 'text-warning'
    : 'text-danger'

  const metricCards: { label: string; value: string; suffix?: string; colorClass?: string }[] = [
    { label: 'Total Changeovers', value: stats.count.toLocaleString() },
    { label: '% On Target', value: `${onTargetPct}%`, colorClass: pctColorClass },
    { label: 'Average Duration', value: formatDuration(stats.avg) },
    { label: 'Median Duration', value: formatDuration(stats.median) },
    { label: '90th Percentile', value: formatDuration(stats.p90) },
    { label: 'Fastest Event', value: formatDuration(stats.fastest) },
    { label: 'Slowest Event', value: formatDuration(stats.slowest) },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-7">
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
