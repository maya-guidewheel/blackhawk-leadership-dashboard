import { useState, useEffect } from 'react'
import { apiFetch } from '../utils/api'
import { normalizeDateOnly, formatServerTimestamp, formatUtcTooltip } from '../utils/dates'
import type { EnergyRow, DowntimeEvent, OEERecord, RuntimeRecord, ColorChangeEvent } from '../data/types'

interface Props {
  dataStatus: {
    issues: { count: number; lastUpdated: string | null }
    energy_average: { count: number; lastUpdated: string | null }
    energy_max: { count: number; lastUpdated: string | null }
    downtime_events: { count: number; lastUpdated: string | null }
    oee_data: { count: number; lastUpdated: string | null }
  } | null
  energyRows: EnergyRow[]
  runtimeRecords: RuntimeRecord[]
  oeeRecords: OEERecord[]
  downtimeEvents: DowntimeEvent[]
  allEvents: ColorChangeEvent[]
}

interface IngestionEntry {
  id: number
  file_name: string
  table_name: string
  rows_added: number
  duplicates_skipped: number
  rows_updated?: number
  rows_unchanged?: number
  ingested_at: string
}

interface DatasetRanges {
  issues: { min: string | null; max: string | null; n: number }
  energy_average: { min: string | null; max: string | null; n: number }
  downtime_events: { min: string | null; max: string | null; n: number }
  oee_data: { min: string | null; max: string | null; n: number }
  runtime_data: { min: string | null; max: string | null; n: number }
}

const cardCls = 'bg-card border border-border rounded-xl p-5'
const thCls = 'text-[0.7rem] font-bold uppercase tracking-[0.06em] text-muted-foreground px-3 py-2 border-b border-border text-left whitespace-nowrap'
const tdCls = 'px-3 py-2 text-[0.8rem] text-foreground border-b border-border'

// Server timestamps are UTC; render in the viewer's local timezone (with zone label).
function fmtDate(iso: string | null): string {
  return formatServerTimestamp(iso, '—')
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${ok ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
      <span className={`w-1.5 h-1.5 rounded-full inline-block ${ok ? 'bg-success' : 'bg-warning'}`} />
      {label}
    </span>
  )
}

const TABLE_LABELS: Record<string, string> = {
  issues: 'Changeover / Issues',
  energy_average: 'Energy (kWh)',
  energy_max: 'Energy (Max Power)',
  downtime_events: 'Downtime / Tagging',
  oee_data: 'OEE / Production',
  runtime_data: 'Runtime / Uptime Trends',
}

export default function DataManagement({ dataStatus, energyRows, runtimeRecords, oeeRecords, downtimeEvents, allEvents }: Props) {
  const [log, setLog] = useState<IngestionEntry[]>([])
  const [ranges, setRanges] = useState<DatasetRanges | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch('/api/data/ingestion-log')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.log) setLog(data.log)
        if (data?.ranges) setRanges(data.ranges)
      })
      .finally(() => setLoading(false))
  }, [])

  // Derive date ranges from in-memory data for cross-check. Energy dates are
  // normalized so a stray Excel decimal can never surface as a "date".
  const energyDatesSorted = energyRows.map(r => normalizeDateOnly(r.date)).filter((d): d is string => !!d).sort()
  const energyRange = energyDatesSorted.length > 0
    ? { min: energyDatesSorted[0], max: energyDatesSorted[energyDatesSorted.length - 1] }
    : null
  const runtimeRange = runtimeRecords.length > 0
    ? { min: runtimeRecords.map(r => r.date).sort()[0], max: runtimeRecords.map(r => r.date).sort().reverse()[0] }
    : null
  const oeeRange = oeeRecords.length > 0
    ? { min: oeeRecords.map(r => r.date).sort()[0], max: oeeRecords.map(r => r.date).sort().reverse()[0] }
    : null
  const downtimeRange = downtimeEvents.length > 0
    ? { min: downtimeEvents.map(e => e.calendar_date).sort()[0], max: downtimeEvents.map(e => e.calendar_date).sort().reverse()[0] }
    : null
  const issuesRange = allEvents.length > 0
    ? { min: allEvents.map(e => e.calendar_date).sort()[0], max: allEvents.map(e => e.calendar_date).sort().reverse()[0] }
    : null

  // Energy vs runtime overlap
  const energyRuntimeOverlap = energyRange && runtimeRange
    ? { min: [energyRange.min, runtimeRange.min].sort().reverse()[0], max: [energyRange.max, runtimeRange.max].sort()[0] }
    : null
  const noOverlap = energyRuntimeOverlap && energyRuntimeOverlap.min > energyRuntimeOverlap.max

  return (
    <div className="space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className={cardCls}>
        <h2 className="text-base font-semibold mb-1 text-foreground">Data &amp; Calculations</h2>
        <p className="text-sm text-muted-foreground">
          Transparency view for every uploaded dataset — what is loaded, what each tab needs, and whether required data is present or missing.
          No values are fabricated. <span className="text-foreground font-medium">Issues / Downtime re-uploads update existing events (upsert)</span> when tags/status/details change and recalculate changeover classification; exact unchanged rows are skipped. Energy, OEE and Runtime uploads insert new rows and skip exact duplicates.
        </p>
      </div>

      {/* ── Dataset Inventory ─────────────────────────────────────────── */}
      <div className={cardCls}>
        <h3 className="text-sm font-semibold mb-3 text-foreground">Dataset Inventory</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>{['Dataset', 'Records loaded', 'Earliest date', 'Latest date', 'Status', 'Used by'].map(h => <th key={h} className={thCls}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {[
                {
                  name: 'Issues / Downtime (all events)', records: downtimeEvents.length, range: downtimeRange,
                  ok: downtimeEvents.length > 0, tabs: 'Tagging & Downtime'
                },
                {
                  name: 'Changeover (tagged issues only)', records: allEvents.length, range: issuesRange,
                  ok: allEvents.length > 0, tabs: 'Changeover'
                },
                {
                  name: 'Energy (kWh)', records: energyRows.length, range: energyRange,
                  ok: energyRows.length > 0, tabs: 'Energy vs Uptime, Energy & Cost'
                },
                {
                  name: 'Runtime / Trends', records: runtimeRecords.length, range: runtimeRange,
                  ok: runtimeRecords.length > 0, tabs: 'Energy vs Uptime'
                },
                {
                  name: 'OEE / Production', records: oeeRecords.length, range: oeeRange,
                  ok: oeeRecords.length > 0, tabs: 'OEE Trends'
                },
              ].map(row => (
                <tr key={row.name}>
                  <td className={`${tdCls} font-medium`}>{row.name}</td>
                  <td className={tdCls}>{row.records.toLocaleString()}</td>
                  <td className={tdCls}>{row.range?.min ?? '—'}</td>
                  <td className={tdCls}>{row.range?.max ?? '—'}</td>
                  <td className={tdCls}><StatusBadge ok={row.ok} label={row.ok ? 'Loaded' : 'Missing'} /></td>
                  <td className={`${tdCls} text-muted-foreground text-xs`}>{row.tabs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs mt-3 text-muted-foreground">
          Dates come from the actual loaded records, not upload metadata. <span className="font-medium text-foreground">Issues / Downtime (all events)</span> reflects every loaded issue; <span className="font-medium text-foreground">Changeover (tagged issues only)</span> reflects just events tagged Change-Color/foam/label or Change Job — so its latest date can be earlier if the most recent issues are not changeovers.
        </p>
      </div>

      {/* ── Tab Requirements Matrix ────────────────────────────────────── */}
      <div className={cardCls}>
        <h3 className="text-sm font-semibold mb-3 text-foreground">Tab Requirements</h3>
        <div className="space-y-3">
          {[
            {
              tab: 'Changeover', needs: 'Issues / changeover data',
              ok: allEvents.length > 0,
              detail: issuesRange ? `${issuesRange.min} to ${issuesRange.max} · ${allEvents.length.toLocaleString()} events` : 'Not loaded. Upload a Guidewheel issues CSV.',
            },
            {
              tab: 'Tagging & Downtime', needs: 'Issues / downtime data',
              ok: downtimeEvents.length > 0,
              detail: downtimeRange ? `${downtimeRange.min} to ${downtimeRange.max} · ${downtimeEvents.length.toLocaleString()} events` : 'Not loaded. Upload a Guidewheel issues CSV.',
            },
            {
              tab: 'OEE Trends', needs: 'Production / OEE export (CSV or XLSX)',
              ok: oeeRecords.length > 0,
              detail: oeeRange
                ? `${oeeRange.min} to ${oeeRange.max} · ${oeeRecords.length.toLocaleString()} records`
                : 'Not loaded. Upload the Guidewheel production/OEE CSV (semicolon-delimited). Columns required: Machine, From, To, OEE.',
            },
            {
              tab: 'Energy vs Uptime', needs: 'Energy data + Runtime/Trends data',
              ok: energyRows.length > 0 && runtimeRecords.length > 0,
              detail: (() => {
                const parts = []
                if (energyRows.length > 0) parts.push(`Energy: ${energyRange?.min} to ${energyRange?.max}`)
                else parts.push('Energy: missing — upload energy CSV')
                if (runtimeRecords.length > 0) parts.push(`Runtime: ${runtimeRange?.min} to ${runtimeRange?.max}`)
                else parts.push('Runtime: missing — upload Guidewheel Trends XLSX')
                if (energyRuntimeOverlap && !noOverlap) parts.push(`Overlap: ${energyRuntimeOverlap.min} to ${energyRuntimeOverlap.max}`)
                if (noOverlap) parts.push('WARNING: energy and runtime datasets do not overlap')
                return parts.join(' · ')
              })(),
            },
            {
              tab: 'Energy & Cost', needs: 'Energy data (executive password required)',
              ok: energyRows.length > 0,
              detail: energyRange ? `${energyRange.min} to ${energyRange.max} · ${energyRows.length.toLocaleString()} rows` : 'Not loaded.',
            },
          ].map(item => (
            <div key={item.tab} className="rounded-lg border border-border px-4 py-3">
              <div className="flex items-center gap-3 mb-1">
                <span className="text-sm font-medium text-foreground">{item.tab}</span>
                <StatusBadge ok={item.ok} label={item.ok ? 'Data available' : 'Data missing'} />
              </div>
              <div className="text-xs text-muted-foreground mb-1"><span className="font-semibold text-foreground">Needs:</span> {item.needs}</div>
              <div className="text-xs text-muted-foreground">{item.detail}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Data Gap Warnings ─────────────────────────────────────────── */}
      {(() => {
        const warnings: string[] = []
        if (energyRows.length === 0) warnings.push('Energy data is not loaded. Energy vs Uptime and Energy & Cost tabs require energy data.')
        if (runtimeRecords.length === 0) warnings.push('Runtime data is not loaded. Energy vs Uptime will estimate runtime from downtime data instead of actual runtime hours.')
        if (oeeRecords.length === 0) warnings.push('OEE data is not loaded. Upload the Guidewheel production CSV (columns: Machine, From, To, OEE, Availability, Performance, Quality).')
        if (noOverlap) warnings.push(`Energy data (${energyRange?.min} to ${energyRange?.max}) and runtime data (${runtimeRange?.min} to ${runtimeRange?.max}) do not overlap. Energy vs Uptime analysis will produce no results.`)
        if (energyRange && runtimeRange && !noOverlap && energyRange.max < runtimeRange.max) {
          warnings.push(`Runtime data extends to ${runtimeRange.max} but energy data only goes to ${energyRange.max}. Dates after ${energyRange.max} cannot be analyzed.`)
        }
        if (warnings.length === 0) return null
        return (
          <div className={cardCls}>
            <h3 className="text-sm font-semibold mb-3 text-foreground">Data Gap Warnings</h3>
            <div className="space-y-2">
              {warnings.map((w, i) => (
                <div key={i} className="rounded px-3 py-2 text-xs bg-warning/5 border border-warning/30 text-warning">{w}</div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* ── Upload History ─────────────────────────────────────────────── */}
      <div className={cardCls}>
        <h3 className="text-sm font-semibold mb-3 text-foreground">
          Upload History
          {log.length > 0 && <span className="ml-2 text-xs text-muted-foreground font-normal">(most recent 200)</span>}
        </h3>
        <div className="rounded-lg px-4 py-3 mb-3 text-xs bg-btn-primary/5 border border-btn-primary/20 text-foreground">
          Reuploading a Guidewheel Issues export <span className="font-semibold">refreshes existing issue records</span> when tags/status/details changed. Exact duplicate rows are skipped, but updated duplicate events overwrite the older dashboard record — and changeover classification is recalculated, so an event that loses its changeover tag drops out of Changeover analysis (and one that gains a valid changeover tag is added).
        </div>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : log.length === 0 ? (
          <div className="text-sm text-muted-foreground">No upload history found.</div>
        ) : (
          <div className="overflow-x-auto" style={{ maxHeight: 400, overflowY: 'auto' }}>
            <table className="w-full">
              <thead className="sticky top-0 bg-card z-10">
                <tr>{['Uploaded at', 'Dataset', 'Inserted', 'Updated', 'Unchanged', 'File (hashed)'].map(h => <th key={h} className={thCls}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {log.map(entry => {
                  const unchanged = entry.rows_unchanged ?? entry.duplicates_skipped
                  const updated = entry.rows_updated ?? 0
                  return (
                    <tr key={entry.id}>
                      <td className={tdCls} title={formatUtcTooltip(entry.ingested_at)}>{fmtDate(entry.ingested_at)}</td>
                      <td className={tdCls}>{TABLE_LABELS[entry.table_name] ?? entry.table_name}</td>
                      <td className={`${tdCls} ${entry.rows_added > 0 ? 'text-success font-medium' : 'text-muted-foreground'}`}>{entry.rows_added.toLocaleString()}</td>
                      <td className={`${tdCls} ${updated > 0 ? 'text-btn-primary font-medium' : 'text-muted-foreground'}`}>{updated.toLocaleString()}</td>
                      <td className={tdCls}>{unchanged.toLocaleString()}</td>
                      <td className={`${tdCls} font-mono text-xs text-muted-foreground`}>{entry.file_name}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs mt-3 text-muted-foreground">
          File names are stored as SHA-256 hashes for privacy. Original names are shown in the upload banner when you upload a file.
          <span className="font-semibold text-foreground"> Inserted</span> = brand-new events · <span className="font-semibold text-foreground">Updated</span> = existing events whose Guidewheel details changed · <span className="font-semibold text-foreground">Unchanged</span> = exact duplicates skipped. Re-uploading the same data never double-counts.
        </p>
      </div>

      {/* ── Dataset ranges from server (cross-check) ──────────────────── */}
      {ranges && (
        <div className={cardCls}>
          <h3 className="text-sm font-semibold mb-3 text-foreground">Server Dataset Summary</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>{['Dataset', 'Records', 'Earliest', 'Latest'].map(h => <th key={h} className={thCls}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {Object.entries(ranges).map(([key, val]) => (
                  <tr key={key}>
                    <td className={`${tdCls} font-medium`}>{TABLE_LABELS[key] ?? key}</td>
                    <td className={tdCls}>{val.n.toLocaleString()}</td>
                    <td className={tdCls}>{val.min ?? '—'}</td>
                    <td className={tdCls}>{val.max ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Calculation notes ─────────────────────────────────────────── */}
      <div className={cardCls}>
        <h3 className="text-sm font-semibold mb-3 text-foreground">Calculation Notes</h3>
        <div className="space-y-2 text-xs text-muted-foreground">
          <div><span className="font-semibold text-foreground">Deduplication &amp; upsert:</span> Every record has a stable key — Issues/Downtime use sha256(event start + device); energy/OEE/runtime use their natural keys. <span className="text-foreground">Issues/Downtime re-uploads UPSERT</span>: a new event inserts, an existing event with changed tags/status/duration updates in place (changeover classification is recalculated), and an exact-match event is skipped. Other datasets insert new rows and skip exact duplicates. Re-uploading never double-counts.</div>
          <div><span className="font-semibold text-foreground">Energy vs Uptime:</span> kWh/runtime hour = daily energy ÷ daily runtime. Runtime is from the Guidewheel Trends XLSX (sum of shift hours per device per day) when loaded, otherwise estimated as 24h minus recorded downtime. No cost, pricing, or labor rates appear on this tab. Energy is read from <code>energy_average</code> table — same data as the Executive Energy tab.</div>
          <div><span className="font-semibold text-foreground">Runtime endpoint:</span> <code>/api/data/runtime</code> reads the <code>runtime_data</code> table. <strong>Energy endpoint:</strong> <code>/api/data/energy/usage</code> reads the <code>energy_average</code> table.</div>
          <div><span className="font-semibold text-foreground">Tagging compliance:</span> An event is "tagged" when its tags field is non-empty and is not a placeholder value like "No Tag", "n/a", etc. Duration-weighted compliance counts tagged minutes as a % of all downtime minutes.</div>
          <div><span className="font-semibold text-foreground">Double-tagging:</span> Flagged when the same tag string appears more than once in a single event's tags field. Does not affect the overall downtime total (the event is still counted once). Affects tag-level analysis if the issue count per tag is reported separately.</div>
          <div><span className="font-semibold text-foreground">Plant mapping:</span> Device prefix determines plant — 1xxx = Addison, 2xxx = Mayflower, 3xxx = Sparks.</div>
          <div><span className="font-semibold text-foreground">OEE format:</span> Accepts the Guidewheel production export (semicolon-delimited, columns: Machine, From, To, OEE, Availability, Performance, Quality). OEE values may be 0–100 or 0–1 (auto-normalized). The tab will show a clear message if OEE data is missing or if a file was misdetected as a different type.</div>
          <div><span className="font-semibold text-foreground">Runtime XLSX format:</span> Guidewheel Trends wide-format export. Column headers follow the pattern <code>{"DayName Mon D YYYY - Shift (Plant) (Runtime hrs)"}</code>. Each device row contains runtime hours per shift per day. Parser sums across shifts to produce daily totals per device.</div>
        </div>
      </div>

    </div>
  )
}
