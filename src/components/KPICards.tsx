import type { StatsSummary, ColorChangeEvent } from '../data/types'

interface Props {
  stats: StatsSummary
  threshold: number
  events: ColorChangeEvent[]
}

function fmt(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString()
}

export default function KPICards({ stats, threshold, events }: Props) {
  const onTargetPct = events.length > 0
    ? Math.round((events.filter(e => e.duration <= threshold).length / events.length) * 100)
    : 0

  const pctColor = onTargetPct >= 90
    ? 'var(--color-success, #16a34a)'
    : onTargetPct >= 70
    ? '#d97706'
    : 'var(--color-danger)'

  const metricCards: { label: string; value: string; suffix?: string; color?: string }[] = [
    { label: 'Total Changeovers', value: fmt(stats.count) },
    { label: '% On Target', value: `${onTargetPct}%`, color: pctColor },
    { label: 'Average Duration', value: fmt(stats.avg), suffix: ' min' },
    { label: 'Median Duration', value: fmt(stats.median), suffix: ' min' },
    { label: '90th Percentile', value: fmt(stats.p90), suffix: ' min' },
    { label: 'Fastest Event', value: fmt(stats.fastest), suffix: ' min' },
    { label: 'Slowest Event', value: fmt(stats.slowest), suffix: ' min' },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-7">
      {metricCards.map(c => (
        <div key={c.label} className="bh-card p-4">
          <div
            className="text-[0.65rem] font-bold uppercase tracking-wider mb-2 leading-tight"
            style={{ color: 'var(--color-muted)' }}
          >
            {c.label}
          </div>
          <div className="flex items-baseline gap-0.5">
            <span
              className="text-2xl font-bold leading-none"
              style={{ color: c.color ?? 'var(--color-primary)' }}
            >
              {c.value}
            </span>
            {c.suffix && (
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>
                {c.suffix}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
