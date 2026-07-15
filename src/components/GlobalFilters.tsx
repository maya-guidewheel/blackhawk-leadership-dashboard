import { useMemo, useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { format } from 'date-fns'
import type { FilterState, ColorChangeEvent, ChangeoverTargets } from '../data/types'
import { trackEvent } from '../analytics/posthog'

interface Props {
  filters: FilterState
  onChange: (f: FilterState) => void
  events: ColorChangeEvent[]
  filteredCount: number
}

function fmtDateLabel(iso: string): string {
  try {
    return format(new Date(iso + 'T00:00:00'), 'MMM d, yyyy')
  } catch {
    return iso
  }
}

function startOfCurrentYear(): string {
  return `${new Date().getFullYear()}-01-01`
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

// ── Multi-select machine dropdown ────────────────────────────────────────────
// Compact button + checkbox popover. An empty `selected` array means All Machines.
function MachineMultiSelect({
  options,
  selected,
  onChange,
  inputClass,
}: {
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
  inputClass: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // The menu is rendered in a portal on document.body (so no ancestor's
  // overflow:hidden can clip it). It's positioned as a fixed element anchored
  // to the trigger button's on-screen rect.
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      // Ignore clicks inside the trigger wrapper or the portalled menu itself.
      if (ref.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    // Anchor the fixed menu to the button and keep it aligned on scroll/resize.
    function reposition() {
      const btn = ref.current?.getBoundingClientRect()
      if (btn) setMenuPos({ top: btn.bottom + 4, left: btn.left, width: btn.width })
    }
    reposition()
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  // Drop any selected devices that aren't available under the current plant.
  const validSelected = selected.filter(s => options.includes(s))

  const summary =
    validSelected.length === 0
      ? 'All Machines'
      : validSelected.length === 1
      ? validSelected[0]
      : `${validSelected.length} machines`

  function toggle(device: string) {
    const next = validSelected.includes(device)
      ? validSelected.filter(d => d !== device)
      : [...validSelected, device]
    onChange(next)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`${inputClass} flex items-center justify-between gap-2 min-w-[10rem] text-left`}
        title="Select one or more machines"
      >
        <span className="truncate">{summary}</span>
        <span className="text-muted-foreground text-[0.6rem]">▼</span>
      </button>
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] w-64 max-h-72 overflow-auto rounded-md border border-border bg-card shadow-lg"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-border sticky top-0 bg-card">
            <button
              type="button"
              onClick={() => onChange([])}
              className={`text-xs font-semibold ${validSelected.length === 0 ? 'text-btn-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {validSelected.length === 0 ? '✓ All Machines' : 'All Machines'}
            </button>
            {validSelected.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-[0.65rem] font-semibold underline text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>
          <ul className="py-1">
            {options.map(d => {
              const checked = validSelected.includes(d)
              return (
                <li key={d}>
                  <label className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-background-accent">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(d)}
                    />
                    <span className="font-mono text-xs">{d}</span>
                  </label>
                </li>
              )
            })}
            {options.length === 0 && (
              <li className="px-3 py-2 text-xs text-muted-foreground">No machines in scope</li>
            )}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  )
}

export default function GlobalFilters({ filters, onChange, events, filteredCount }: Props) {
  const plants = ['All', ...new Set(events.map(e => e.plant))].sort()
  // Machine options honor the active plant filter.
  const deviceOptions = useMemo(() => [...new Set(
    events
      .filter(e => filters.plant === 'All' || e.plant === filters.plant)
      .map(e => e.device)
  )].sort(), [events, filters.plant])

  const minDate = useMemo(() => {
    if (events.length === 0) return ''
    return events.map(e => e.calendar_date).sort()[0]
  }, [events])

  const maxDate = useMemo(() => {
    if (events.length === 0) return ''
    const dates = events.map(e => e.calendar_date).sort()
    return dates[dates.length - 1]
  }, [events])

  const noDataInRange = Boolean(
    minDate && maxDate && events.length > 0 &&
    (filters.dateTo < minDate || filters.dateFrom > maxDate)
  )
  const dateBeforeData = !noDataInRange && Boolean(minDate && filters.dateFrom < minDate)
  const dateExceedsData = !noDataInRange && Boolean(maxDate && filters.dateTo > maxDate)

  function update(partial: Partial<FilterState>) {
    const next = { ...filters, ...partial }
    trackEvent('filter_changed', partial)
    onChange(next)
  }

  function updateTargets(partial: Partial<ChangeoverTargets>) {
    update({ targets: { ...filters.targets, ...partial } })
  }

  // Reset to the Changeover-tab default: start of the current year (clamped to
  // available data) through the latest loaded date, all machines/plants/types.
  function resetAll() {
    const yearStart = startOfCurrentYear()
    let from = minDate && yearStart > minDate ? yearStart : (minDate || filters.dateFrom)
    if (maxDate && from > maxDate) from = minDate || filters.dateFrom
    onChange({
      ...filters,
      dateFrom: from,
      dateTo: maxDate || filters.dateTo,
      plant: 'All',
      devices: [],
      changeoverType: 'All',
    })
  }

  const CHANGEOVER_TYPES = ['All', 'Color Change', 'Foam Change', 'Roll Change']

  const selectedDevices = filters.devices.filter(d => deviceOptions.includes(d))
  const isFiltered = filters.plant !== 'All' || selectedDevices.length > 0 || filters.changeoverType !== 'All'

  const inputClass = 'border border-border rounded px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 bg-card'
  const labelClass = 'bh-metric-label mb-1 block'

  // Show up to 4 machine names individually; collapse the rest into a count.
  const MAX_MACHINE_CHIPS = 4
  const shownMachines = selectedDevices.slice(0, MAX_MACHINE_CHIPS)
  const extraMachines = selectedDevices.length - shownMachines.length

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
            onClear={filters.plant !== 'All' ? () => update({ plant: 'All', devices: [] }) : undefined}
          />
          {selectedDevices.length === 0 ? (
            <Chip label="All Machines" />
          ) : (
            <>
              {shownMachines.map(d => (
                <Chip
                  key={d}
                  label={d}
                  active
                  onClear={() => update({ devices: selectedDevices.filter(x => x !== d) })}
                />
              ))}
              {extraMachines > 0 && <Chip label={`+${extraMachines} more`} active />}
              <button
                onClick={() => update({ devices: [] })}
                className="text-[0.65rem] font-semibold underline text-muted-foreground"
              >
                Clear machines
              </button>
            </>
          )}
          <Chip
            label={filters.changeoverType === 'All' ? 'All Types' : filters.changeoverType}
            active={filters.changeoverType !== 'All'}
            onClear={filters.changeoverType !== 'All' ? () => update({ changeoverType: 'All' }) : undefined}
          />
          <Chip label={`Targets: Color ≤${filters.targets.color} · Roll ≤${filters.targets.roll} · Foam ≤${filters.targets.foam} min`} />
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
            min={minDate || undefined}
            max={maxDate || undefined}
          />
        </div>
        <div>
          <label className={labelClass}>To</label>
          <input
            type="date"
            value={filters.dateTo}
            onChange={e => update({ dateTo: e.target.value })}
            className={inputClass}
            min={minDate || undefined}
            max={maxDate || undefined}
          />
        </div>
        {(minDate || maxDate) && (
          <div className="flex flex-col justify-end">
            <div className="text-[0.65rem] font-semibold px-2.5 py-1.5 rounded bg-btn-primary/10 text-btn-primary">
              Available data: {fmtDateLabel(minDate)} – {fmtDateLabel(maxDate)}
            </div>
          </div>
        )}
        <div>
          <label className={labelClass}>Plant</label>
          <select
            value={filters.plant}
            onChange={e => update({ plant: e.target.value, devices: [] })}
            className={inputClass}
          >
            {plants.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>Machines</label>
          <MachineMultiSelect
            options={deviceOptions}
            selected={filters.devices}
            onChange={devices => update({ devices })}
            inputClass={inputClass}
          />
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

        {/* Per-type targets — Rey (Jul 15): color 45, roll 10, foam 10 (foam TBC). */}
        <div>
          <label className={labelClass}>Color target (min)</label>
          <input
            type="number"
            value={filters.targets.color}
            onChange={e => updateTargets({ color: Number(e.target.value) || 0 })}
            className={`${inputClass} w-20`}
            min={1}
          />
        </div>
        <div>
          <label className={labelClass}>Roll target (min)</label>
          <input
            type="number"
            value={filters.targets.roll}
            onChange={e => updateTargets({ roll: Number(e.target.value) || 0 })}
            className={`${inputClass} w-20`}
            min={1}
          />
        </div>
        <div>
          <label className={labelClass}>Foam target (min)</label>
          <input
            type="number"
            value={filters.targets.foam}
            onChange={e => updateTargets({ foam: Number(e.target.value) || 0 })}
            className={`${inputClass} w-20`}
            min={1}
          />
        </div>
      </div>

      <div className="px-4 pb-3 -mt-1 text-[0.65rem] text-muted-foreground">
        Targets apply per changeover type: color changes are compared to the Color target, roll and foam changes to their own.
        Machines with an unrecognized type fall back to the Color target.
      </div>

      {noDataInRange && (
        <div className="px-4 pb-3 text-xs font-semibold text-danger">
          No data available for the selected date range. Available data is {fmtDateLabel(minDate)} to {fmtDateLabel(maxDate)}.
        </div>
      )}
      {dateBeforeData && (
        <div className="px-4 pb-3 text-xs text-warning">
          ⚠ Selected start date is before available data. Displayed values begin on {fmtDateLabel(minDate)}.
        </div>
      )}
      {dateExceedsData && (
        <div className="px-4 pb-3 text-xs text-warning">
          ⚠ Selected end date is after latest uploaded data. Displayed values only reflect data through {fmtDateLabel(maxDate)}.
        </div>
      )}
    </div>
  )
}
