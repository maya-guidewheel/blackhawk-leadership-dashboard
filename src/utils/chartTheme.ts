// Shared recharts styling helpers — keep visual conventions in one place
// so every chart in the app stays consistent with the GW palette.

export const chartColors = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
] as const

export function chartColor(index: number): string {
  return chartColors[index % chartColors.length]
}

// Common axis tick style — pass directly to <XAxis tick={...} /> / <YAxis tick={...} />
export const axisTick = {
  fontSize: 11,
  fill: 'var(--chart-axis-label)',
} as const

// Common Tooltip contentStyle
export const tooltipStyle = {
  fontSize: 12,
  background: 'var(--chart-tooltip-bg)',
  border: '1px solid var(--chart-tooltip-border)',
  borderRadius: 6,
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
  color: 'var(--color-foreground)',
} as const

export const tooltipCursorFill = 'var(--color-background-accent)'

export const gridStroke = 'var(--chart-grid-line)'

// Semantic chart colors for OEE-style metric overlays
export const oeeColors = {
  availability: 'var(--oee-availability)',
  performance:  'var(--oee-performance)',
  quality:      'var(--oee-quality)',
  overall:      'var(--oee-overall)',
} as const

// Status tones (used in PlantComparison dots, NeedsAttention badges)
export const statusColors = {
  good: 'var(--color-success)',
  warn: 'var(--color-warning)',
  bad:  'var(--color-danger)',
} as const
