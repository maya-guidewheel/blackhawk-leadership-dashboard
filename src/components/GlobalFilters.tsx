import { useMemo } from 'react'
import { format } from 'date-fns'
import type { FilterState, ColorChangeEvent } from '../data/types'
import { trackEvent } from '../analytics/posthog'

interface Props {
  filters: FilterState
  onChange: (f: FilterState) => void
  events: ColorChangeEvent[]
  filteredCount: number
}

function fmtDateFull(iso: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    })
  } catch { return iso }
}

function fmtDateLabel(iso: string): string {
  try {
    return format(new Date(iso + 'T00:00:00'), 'MMM d, yyyy')
  } catch {
    return iso
  }
}

function Chip({
  label,
  active = false,
  onClear,
}: {
  label: string
  active?: boolean
  onClear?: () => void
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[0.7rem] font-semibold ${
        active
          ? 'bg-btn-primary text-btn-primary-foreground'
          : 'bg-btn-primary/10 text-btn-primary'
      }`}
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

export default function GlobalFilters({ filters, onChange, events, filteredCount }: Props) {
  const plants = ['All', ...new Set(events.map(e => e.plant))].sort()
  const devices = ['All', ...new Set(
    events
      .filter(e => filters.plant === 'All' || e.plant === filters.plant)
      .map(e => e.device)
  )].sort()

  const maxDate = useMemo(() => {
    if (events.length === 0) return ''
    const dates = events.map(e => e.calendar_date).sort()
    return dates[dates.length - 1]
  }, [events])

  const dateExceedsData = maxDate && filters.dateTo > maxDate

  function update(partial: Partial<FilterState>) {
    const next = { ...filters, ...partial }
    trackEvent('filter_changed', partial)
    onChange(next)
  }

  function resetAll() {
    const dates = events.map(e => e.calendar_date).sort()
    onChange({
      ...filters,
      dateFrom: dates[0] ?? filters.dateFrom,
      dateTo: dates[dates.length - 1] ?? filters.dateTo,
      plant: 'All',
      device: 'All',
      changeoverType: 'All',
    })
  }

  const CHANGEOVER_TYPES = ['All', 'Color Change', 'Foam Change', 'Roll Change']

  const isFiltered = filters.plant !== 'All' || filters.device !== 'All' || filters.changeoverType !== 'All'

  const inputClass = 'border border-border rounded px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 bg-card'
  const labelClass = 'bh-metric-label mb-1 block'

  return (
    <div className="bh-card mb-7 overflow-hidden border-l-[3px] border-l-btn-primary">
      {/* ── Summary header ─────────────────────────────────────────────── */}
      <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 bg-btn-primary/5 border-b border-btn-primary/15">
        <div className="flex items-center gap-2">
          <span className="bh-metric-label text-btn-primary">
            Current View
          </span>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-btn-primary text-btn-primary-foreground">
            {filteredCount.toLocaleString()} events
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Chip label={`${fmtDateLabel(filters.dateFrom)} – ${fmtDateLabel(filters.dateTo)}`} />
          <Chip
            label={filters.plant === 'All' ? 'All Plants' : filters.plant}
            active={filters.plant !== 'All'}
            onClear={filters.plant !== 'All' ? () => update({ plant: 'All', device: 'All' }) : undefined}
          />
          <Chip
            label={filters.device === 'All' ? 'All Machines' : filters.device}
            active={filters.device !== 'All'}
            onClear={filters.device !== 'All' ? () => update({ device: 'All' }) : undefined}
          />
          <Chip
            label={filters.changeoverType === 'All' ? 'All Types' : filters.changeoverType}
            active={filters.changeoverType !== 'All'}
            onClear={filters.changeoverType !== 'All' ? () => update({ changeoverType: 'All' }) : undefined}
          />
          <Chip label={`Target ≤ ${filters.threshold} min`} />
          {isFiltered && (
            <button
              onClick={resetAll}
              className="text-[0.65rem] font-semibold underline text-muted-foreground"
            >
              Reset filters
            </button>
          )}
        </div>
      </div>

      {/* ── Filter inputs ───────────────────────────────────────────────── */}
      <div className="px-4 py-3 flex flex-wrap gap-4 items-end">
        <div>
          <label className={labelClass}>From</label>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={e => update({ dateFrom: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>To</label>
          <input
            type="date"
            value={filters.dateTo}
            onChange={e => update({ dateTo: e.target.value })}
            className={inputClass}
          />
        </div>
        {maxDate && (
          <div className="flex flex-col justify-end">
            <div
              className={`text-[0.65rem] font-semibold px-2.5 py-1.5 rounded ${
                dateExceedsData ? 'bg-warning/10 text-warning' : 'bg-btn-primary/10 text-btn-primary'
              }`}
            >
              {dateExceedsData
                ? `⚠ Beyond data: current through ${fmtDateFull(maxDate)}`
                : `Data current through: ${fmtDateFull(maxDate)}`}
            </div>
          </div>
        )}
        <div>
          <label className={labelClass}>Plant</label>
          <select
            value={filters.plant}
            onChange={e => update({ plant: e.target.value, device: 'All' })}
            className={inputClass}
          >
            {plants.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>Machine</label>
          <select
            value={filters.device}
            onChange={e => update({ device: e.target.value })}
            className={inputClass}
          >
            {devices.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>Type</label>
          <select
            value={filters.changeoverType}
            onChange={e => update({ changeoverType: e.target.value })}
            className={inputClass}
          >
            {CHANGEOVER_TYPES.map(t => <option key={t} value={t}>{t === 'All' ? 'All Types' : t}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>Target (min)</label>
          <input
            type="number"
            value={filters.threshold}
            onChange={e => update({ threshold: Number(e.target.value) || 45 })}
            className={`${inputClass} w-20`}
            min={1}
          />
        </div>
      </div>
    </div>
  )
}
