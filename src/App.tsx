import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { PageHeader } from '@safigen/fd-gw-ui/page-header'
import { apiFetch, clearAuth } from './utils/api'
import AuthGate from './auth/AuthGate'
import EnergyGate from './auth/EnergyGate'
import GlobalFilters from './components/GlobalFilters'
import KPICards from './components/KPICards'
import PlantComparison from './components/PlantComparison'
import WeeklyPlantSummary from './components/WeeklyPlantSummary'
import DeviceDrilldown from './components/DeviceDrilldown'
import TrendView from './components/TrendView'
import NeedsAttention from './components/NeedsAttention'
import ExportButtons from './components/ExportButtons'
import EnergyDashboard from './components/EnergyDashboard'
import TaggingDashboard from './components/TaggingDashboard'
import OEETrends from './components/OEETrends'
import EnergyUptimeDashboard from './components/EnergyUptimeDashboard'
import { ErrorBoundary } from './components/ErrorBoundary'
import DataManagement from './components/DataManagement'
import ManagerCallouts from './components/ManagerCallouts'
import JobColorChangeRatio from './components/JobColorChangeRatio'
import {
  overallStats,
  plantSummaries,
  deviceSummaries,
  weeklyPlantSummaries,
  weeklyDeviceMatrix,
} from './data/aggregations'
import type { ColorChangeEvent, FilterState, EnergyRow, DowntimeEvent, OEERecord, RuntimeRecord } from './data/types'
import { DEFAULT_TARGETS, targetForType } from './data/targets'
import { getCalendarDate, formatServerTimestamp } from './utils/dates'

type Tab = 'changeover' | 'tagging' | 'oee' | 'energy' | 'energy-uptime' | 'data' | 'callouts'

interface DataStatus {
  issues: { count: number; lastUpdated: string | null }
  energy_average: { count: number; lastUpdated: string | null }
  energy_max: { count: number; lastUpdated: string | null }
  downtime_events: { count: number; lastUpdated: string | null }
  oee_data: { count: number; lastUpdated: string | null }
}

interface OEEDiagnostics {
  format: string
  headersFound: string[]
  rowsRead: number
  sampleIssues: string[]
}

interface UploadFeedback {
  fileName: string
  type: string
  rowsAdded: number
  duplicatesSkipped: number
  rowsUpdated?: number
  rowsUnchanged?: number
  changeoversAdded?: number
  changeoversRemoved?: number
  dataMin?: string
  dataMax?: string
  fileType?: string
  sheetUsed?: string
  diagnostics?: OEEDiagnostics
  runtimeDiagnostics?: {
    rowsRead: number
    validRows: number
    devicesFound: string[]
    plantsFound: string[]
    shiftsFound: string[]
    dateMin: string
    dateMax: string
    skippedReasons: string[]
  }
  issuesDiagnostics?: {
    rowsRead: number
    changeoverEvents: number
    excludedNonChangeover: number
    skippedInvalid: number
    topExcludedTags: { tag: string; count: number }[]
    dateMin: string
    dateMax: string
    tagsFound: string[]
    machinesFound: string[]
    plantsFound: string[]
    inserted?: number
    updated?: number
    unchanged?: number
    changeoversAdded?: number
    changeoversRemoved?: number
  }
  routing?: {
    type: string
    filenameSignal: string
    headerSignal: string
    winningParser: string
    rejected: string[]
  }
}

// Rey (Jul 15 2026): the Changeover tab should default to the current calendar
// year, not the full history. Start = Jan 1 of the current year; end = today.
// On data load this is clamped to the available data range (see loadAll).
function startOfCurrentYear(): string {
  return `${new Date().getFullYear()}-01-01`
}

function getDefaultFilters(): FilterState {
  const today = new Date()
  return {
    dateFrom: startOfCurrentYear(),
    dateTo: getCalendarDate(today),
    plant: 'All',
    devices: [],
    targets: { ...DEFAULT_TARGETS },
    changeoverType: 'All',
  }
}

// Default Changeover range once data is loaded: start at Jan 1 of the current
// year (clamped forward if data begins later so we never select outside the
// data), end at the latest loaded date.
function defaultRangeForData(sortedDates: string[]): { dateFrom: string; dateTo: string } {
  const dataMin = sortedDates[0]
  const dataMax = sortedDates[sortedDates.length - 1]
  const yearStart = startOfCurrentYear()
  // Clamp the start forward to dataMin if the year starts before any data.
  let from = yearStart > dataMin ? yearStart : dataMin
  // Guard: if the current year begins after all available data (e.g. only
  // prior-year data loaded), fall back to showing the full range.
  if (from > dataMax) from = dataMin
  return { dateFrom: from, dateTo: dataMax }
}

// Server timestamps are UTC; render them in the viewer's local timezone.
function fmtTimestamp(iso: string | null): string {
  return formatServerTimestamp(iso, 'never')
}

const TABS: { id: Tab; label: string; badge?: string }[] = [
  { id: 'changeover', label: 'Changeover' },
  { id: 'tagging', label: 'Tagging & Downtime' },
  { id: 'oee', label: 'OEE Trends' },
  { id: 'energy-uptime', label: 'Energy vs Uptime' },
  { id: 'energy', label: 'Energy & Cost', badge: 'Executive' },
  { id: 'data', label: 'Data & Calculations' },
  { id: 'callouts', label: 'Manager Callouts' },
]

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('changeover')
  const [allEvents, setAllEvents] = useState<ColorChangeEvent[]>([])
  const [avgEnergyRows, setAvgEnergyRows] = useState<EnergyRow[]>([])
  const [energyUsageRows, setEnergyUsageRows] = useState<EnergyRow[]>([])
  const [downtimeEvents, setDowntimeEvents] = useState<DowntimeEvent[]>([])
  const [oeeRecords, setOEERecords] = useState<OEERecord[]>([])
  const [runtimeRecords, setRuntimeRecords] = useState<RuntimeRecord[]>([])
  const [complianceTarget, setComplianceTarget] = useState(99.5)
  const [filters, setFilters] = useState<FilterState>(getDefaultFilters())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dataStatus, setDataStatus] = useState<DataStatus | null>(null)
  const [uploadFeedback, setUploadFeedback] = useState<UploadFeedback | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadType, setUploadType] = useState('auto')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Load all data from API ─────────────────────────────────────────────────
  // Defined as useCallback so AuthGate can call it again after login.
  const loadAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [issuesRes, energyRes, energyUsageRes, statusRes, downtimeRes, oeeRes, runtimeRes] = await Promise.all([
        apiFetch('/api/data/issues'),
        apiFetch('/api/data/energy/average'), // 401 here is expected if not energy-authed
        apiFetch('/api/data/energy/usage'),   // non-gated; used by Energy vs Uptime tab
        apiFetch('/api/status'),
        apiFetch('/api/data/downtime'),
        apiFetch('/api/data/oee'),
        apiFetch('/api/data/runtime'),
      ])

      // 401 on issues or status means main auth is stale.
      // Energy average 401 is acceptable — user hasn't passed EnergyGate yet.
      if (issuesRes.status === 401 || statusRes.status === 401) {
        setLoading(false)
        return
      }

      if (!issuesRes.ok || !statusRes.ok) {
        const codes = [issuesRes.status, statusRes.status].join('/')
        throw new Error(`Server error (HTTP ${codes})`)
      }

      const [issuesData, statusData] = await Promise.all([
        issuesRes.json(),
        statusRes.json() as Promise<DataStatus>,
      ])

      const events: ColorChangeEvent[] = (issuesData.events as any[]).map(e => ({
        ...e,
        start_dt: new Date(e.start_dt),
        end_dt: new Date(e.end_dt),
      }))

      setAllEvents(events)
      setDataStatus(statusData as DataStatus)

      if (events.length > 0) {
        const dates = events.map(e => e.calendar_date).sort()
        setFilters(f => ({ ...f, ...defaultRangeForData(dates) }))
      }

      // Load energy data only if the energy session token is already valid.
      if (energyRes.ok) {
        const energyData = await energyRes.json()
        setAvgEnergyRows(Array.isArray(energyData?.rows) ? energyData.rows : [])
      }

      // Non-gated energy usage (kWh without cost data) — always load if main auth passes.
      if (energyUsageRes.ok) {
        const usageData = await energyUsageRes.json()
        setEnergyUsageRows(Array.isArray(usageData?.rows) ? usageData.rows : [])
      }

      // Load downtime events
      if (downtimeRes.ok) {
        const downtimeData = await downtimeRes.json()
        const rawEvents = Array.isArray(downtimeData?.events) ? downtimeData.events : []
        const dEvents: DowntimeEvent[] = rawEvents.map((e: any) => ({
          ...e,
          start_dt: new Date(e.start_dt),
          end_dt: new Date(e.end_dt),
        }))
        setDowntimeEvents(dEvents)
      }

      // Load OEE records
      if (oeeRes.ok) {
        const oeeData = await oeeRes.json()
        setOEERecords(Array.isArray(oeeData?.records) ? oeeData.records : [])
      }

      // Load runtime records
      if (runtimeRes.ok) {
        const runtimeData = await runtimeRes.json()
        setRuntimeRecords(Array.isArray(runtimeData?.records) ? runtimeData.records : [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the server.')
    } finally {
      setLoading(false)
    }
  }, [])

  // Called by EnergyGate after the executive password is accepted.
  const loadEnergy = useCallback(async () => {
    try {
      const res = await apiFetch('/api/data/energy/average')
      if (!res.ok) return
      const data = await res.json()
      setAvgEnergyRows(Array.isArray(data?.rows) ? data.rows : [])
      const statusRes = await apiFetch('/api/status')
      if (statusRes.ok) setDataStatus(await statusRes.json())
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  // Reset data state when auth expires so stale content doesn't flash on re-login.
  useEffect(() => {
    function onAuthExpired() {
      setAllEvents([])
      setAvgEnergyRows([])
      setEnergyUsageRows([])
      setDowntimeEvents([])
      setOEERecords([])
      setRuntimeRecords([])
      setDataStatus(null)
      setError('')
      setLoading(true)
      clearAuth()
    }
    window.addEventListener('auth:expired', onAuthExpired)
    return () => window.removeEventListener('auth:expired', onAuthExpired)
  }, [])

  // ── Refresh helpers ────────────────────────────────────────────────────────
  const refreshDowntime = useCallback(async () => {
    const res = await apiFetch('/api/data/downtime')
    if (!res.ok) return
    const data = await res.json()
    const dEvents: DowntimeEvent[] = (data.events as any[]).map(e => ({
      ...e,
      start_dt: new Date(e.start_dt),
      end_dt: new Date(e.end_dt),
    }))
    setDowntimeEvents(dEvents)
  }, [])

  const refreshOEE = useCallback(async () => {
    const res = await apiFetch('/api/data/oee')
    if (!res.ok) return
    const data = await res.json()
    setOEERecords(data.records as OEERecord[])
  }, [])

  const refreshIssues = useCallback(async () => {
    const res = await apiFetch('/api/data/issues')
    const data = await res.json()
    const events: ColorChangeEvent[] = (data.events as any[]).map(e => ({
      ...e,
      start_dt: new Date(e.start_dt),
      end_dt: new Date(e.end_dt),
    }))
    setAllEvents(events)
    if (events.length > 0) {
      const dates = events.map(e => e.calendar_date).sort()
      setFilters(f => ({ ...f, ...defaultRangeForData(dates) }))
    }
    // Also refresh downtime since issues CSV also ingests downtime
    await refreshDowntime()
  }, [refreshDowntime])

  const refreshEnergy = useCallback(async () => {
    const res = await apiFetch('/api/data/energy/average')
    if (!res.ok) return
    const data = await res.json()
    setAvgEnergyRows(data.rows as EnergyRow[])
  }, [])

  const refreshEnergyUsage = useCallback(async () => {
    const res = await apiFetch('/api/data/energy/usage')
    if (!res.ok) return
    const data = await res.json()
    setEnergyUsageRows(data.rows as EnergyRow[])
  }, [])

  const refreshRuntime = useCallback(async () => {
    const res = await apiFetch('/api/data/runtime')
    if (!res.ok) return
    const data = await res.json()
    setRuntimeRecords(data.records as RuntimeRecord[])
  }, [])

  const refreshStatus = useCallback(async () => {
    const res = await apiFetch('/api/status')
    setDataStatus(await res.json())
  }, [])

  // ── Upload handler ─────────────────────────────────────────────────────────
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadFeedback(null)

    const formData = new FormData()
    formData.append('file', file)
    // Manual override for recovery from a wrong auto-detect (otherwise auto-routed).
    if (uploadType !== 'auto') formData.append('type', uploadType)

    try {
      const res = await apiFetch('/api/upload', { method: 'POST', body: formData })
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Upload failed') }
      const result = await res.json() as UploadFeedback
      setUploadFeedback(result)
      if (result.type === 'issues') await refreshIssues()
      else if (result.type === 'energy_average') {
        await Promise.all([refreshEnergy(), refreshEnergyUsage()])
      } else if (result.type === 'oee') await refreshOEE()
      else if (result.type === 'runtime') await refreshRuntime()
      await refreshStatus()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [uploadType, refreshIssues, refreshEnergy, refreshEnergyUsage, refreshRuntime, refreshStatus])

  // ── Derived data ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => allEvents.filter(e => {
    if (e.calendar_date < filters.dateFrom || e.calendar_date > filters.dateTo) return false
    if (filters.plant !== 'All' && e.plant !== filters.plant) return false
    // Empty devices array = All Machines; otherwise the event's device must be selected.
    if (filters.devices.length > 0 && !filters.devices.includes(e.device)) return false
    if (filters.changeoverType !== 'All' && e.changeover_type !== filters.changeoverType) return false
    return true
  }), [allEvents, filters])

  const stats = useMemo(() => overallStats(filtered), [filtered])
  const plantData = useMemo(() => plantSummaries(filtered), [filtered])
  const deviceData = useMemo(() => deviceSummaries(filtered), [filtered])
  const weeklyPlantData = useMemo(() => weeklyPlantSummaries(filtered), [filtered])
  const heatmapData = useMemo(() => weeklyDeviceMatrix(filtered), [filtered])

  // Reference-line target for the weekly-trend chart. A single line only makes
  // sense when one changeover type is in view (targets differ by type); if the
  // filtered set mixes types we omit the line rather than mislead.
  const trendTarget = useMemo(() => {
    if (filters.changeoverType !== 'All') return targetForType(filters.changeoverType, filters.targets)
    const types = new Set(filtered.map(e => e.changeover_type))
    return types.size === 1 ? targetForType([...types][0], filters.targets) : undefined
  }, [filtered, filters.changeoverType, filters.targets])

  const hasAnyData = allEvents.length > 0 || avgEnergyRows.length > 0 || energyUsageRows.length > 0

  // Best available energy rows for Energy vs Uptime (use executive data if loaded, else non-gated)
  const bestEnergyRows = avgEnergyRows.length > 0 ? avgEnergyRows : energyUsageRows

  // Re-fetch energyUsageRows when switching to the energy-uptime tab and data is missing
  useEffect(() => {
    if (activeTab === 'energy-uptime' && energyUsageRows.length === 0 && avgEnergyRows.length === 0) {
      refreshEnergyUsage()
    }
  }, [activeTab, energyUsageRows.length, avgEnergyRows.length, refreshEnergyUsage])

  // Last-updated text shown in header (context-aware)
  const lastUpdatedText = (() => {
    if (activeTab === 'energy') {
      return dataStatus?.energy_average.lastUpdated
        ? `Energy updated ${fmtTimestamp(dataStatus.energy_average.lastUpdated)}`
        : null
    }
    if (activeTab === 'tagging') {
      return dataStatus?.downtime_events.lastUpdated
        ? `Downtime updated ${fmtTimestamp(dataStatus.downtime_events.lastUpdated)} · ${(dataStatus.downtime_events.count ?? 0).toLocaleString()} events`
        : null
    }
    if (activeTab === 'oee') {
      return dataStatus?.oee_data.lastUpdated
        ? `OEE updated ${fmtTimestamp(dataStatus.oee_data.lastUpdated)} · ${(dataStatus.oee_data.count ?? 0).toLocaleString()} records`
        : null
    }
    return dataStatus?.issues.lastUpdated
      ? `Updated ${fmtTimestamp(dataStatus.issues.lastUpdated)} · ${(dataStatus?.issues.count ?? 0).toLocaleString()} records`
      : null
  })()

  return (
    <AuthGate onLogin={loadAll}>
      <div className="min-h-screen bg-background">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="bg-card border-b border-border">
          <div className="px-6">
            <PageHeader
              title="Leadership Dashboard"
              subtitle="Powered by Guidewheel"
              withSeparator={false}
              primaryAction={
                <>
                  {lastUpdatedText && (
                    <span className="text-xs text-muted-foreground hidden md:inline">
                      {lastUpdatedText}
                    </span>
                  )}
                  {/* Dataset override — leave on Auto-detect normally; force a type to
                      recover from a wrong guess (e.g. re-upload an Issues file as Issues). */}
                  <select
                    value={uploadType}
                    onChange={e => setUploadType(e.target.value)}
                    title="Dataset type — Auto-detect from headers, or force a type to recover from a wrong guess"
                    className="text-xs rounded-md bg-background border border-border text-foreground px-2 py-1.5"
                  >
                    <option value="auto">Auto-detect</option>
                    <option value="issues">Force: Issues / Downtime</option>
                    <option value="energy_average">Force: Energy (kWh)</option>
                    <option value="oee">Force: OEE / Production</option>
                  </select>
                  <label className="inline-flex items-center gap-2 cursor-pointer rounded-md bg-btn-primary text-btn-primary-foreground hover:bg-btn-primary-accent px-3.5 py-1.5 text-sm font-medium transition-colors" title="Supported files: CSV, XLSX">
                    {uploading ? 'Uploading…' : 'Upload CSV / XLSX'}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      onChange={handleFileUpload}
                      disabled={uploading}
                      className="hidden"
                    />
                  </label>
                </>
              }
            />
          </div>

          {/* Tab bar */}
          <div className="px-6 flex items-end gap-1 border-t border-border-muted">
            {TABS.map(tab => {
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none -mb-px ${
                    isActive
                      ? 'text-foreground border-b-2 border-btn-primary'
                      : 'text-muted-foreground border-b-2 border-transparent hover:text-foreground'
                  }`}
                >
                  {tab.label}
                  {tab.badge && (
                    <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                      isActive
                        ? 'bg-btn-primary/10 text-btn-primary'
                        : 'bg-background-accent text-subtle-foreground'
                    }`}>
                      {tab.badge}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </header>

        {/* ── Upload feedback banner ──────────────────────────────────────── */}
        {uploadFeedback && (
          <div className="px-4 sm:px-6 mt-3">
            <div
              className={`rounded-md border px-4 py-3 text-sm ${
                (uploadFeedback.rowsAdded > 0 || (uploadFeedback.rowsUpdated ?? 0) > 0)
                  ? 'border-success bg-success/5 text-success'
                  : 'border-warning bg-warning/5 text-warning'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="text-foreground">
                  <span className="font-semibold">{uploadFeedback.fileName}</span>
                  {' — '}
                  <span className="font-semibold">
                    {uploadFeedback.rowsAdded.toLocaleString()} inserted
                  </span>
                  {(uploadFeedback.rowsUpdated ?? 0) > 0 && (
                    <span className="font-semibold">
                      , {(uploadFeedback.rowsUpdated ?? 0).toLocaleString()} updated
                    </span>
                  )}
                  {(uploadFeedback.rowsUnchanged ?? uploadFeedback.duplicatesSkipped) > 0 && (
                    <span className="text-muted-foreground">
                      , {(uploadFeedback.rowsUnchanged ?? uploadFeedback.duplicatesSkipped).toLocaleString()} unchanged
                    </span>
                  )}
                  {(uploadFeedback.changeoversRemoved ?? 0) + (uploadFeedback.changeoversAdded ?? 0) > 0 && (
                    <span className="text-muted-foreground">
                      , {((uploadFeedback.changeoversAdded ?? 0) + (uploadFeedback.changeoversRemoved ?? 0)).toLocaleString()} changeovers reclassified
                    </span>
                  )}
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({uploadFeedback.type.replace(/_/g, ' ')})
                  </span>
                </div>
                <button
                  onClick={() => setUploadFeedback(null)}
                  className="text-muted-foreground hover:text-foreground text-lg leading-none shrink-0"
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </div>
              {/* Routing diagnostics — explains WHY this dataset/parser was chosen */}
              {uploadFeedback.routing && (
                <div className="mt-2 text-xs text-muted-foreground border-t border-border/50 pt-2">
                  <div>
                    <span className="font-semibold text-foreground">Routed to:</span> {uploadFeedback.routing.winningParser}
                  </div>
                  <div>
                    <span className="font-semibold text-foreground">Header signal:</span> {uploadFeedback.routing.headerSignal}
                    {' · '}<span className="font-semibold text-foreground">Filename signal:</span> {uploadFeedback.routing.filenameSignal}
                  </div>
                  {uploadFeedback.routing.rejected.length > 0 && (
                    <div><span className="font-semibold text-foreground">Rejected:</span> {uploadFeedback.routing.rejected.join(' · ')}</div>
                  )}
                  {/* Misclassification guard: filename says Issues but routed to Energy */}
                  {uploadFeedback.routing.filenameSignal === 'issues' && uploadFeedback.type.startsWith('energy') && (
                    <div className="mt-1 rounded px-2 py-1 bg-danger/10 text-danger font-medium">
                      ⚠ This file looks like an Issues export but was routed to Energy. Re-upload and choose “Issues” if this is wrong.
                    </div>
                  )}
                </div>
              )}
              {uploadFeedback.rowsAdded === 0 && (uploadFeedback.rowsUpdated ?? 0) === 0 && uploadFeedback.duplicatesSkipped > 0 && uploadFeedback.dataMin && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Existing dataset: <span className="font-medium text-foreground">{uploadFeedback.dataMin}</span> to <span className="font-medium text-foreground">{uploadFeedback.dataMax}</span>. Data is current — no changed records to apply.
                </div>
              )}
              {uploadFeedback.type === 'runtime' && uploadFeedback.runtimeDiagnostics && (
                <div className="mt-2 text-xs space-y-1 text-muted-foreground">
                  <div><span className="font-semibold text-foreground">File type:</span> {uploadFeedback.fileType?.toUpperCase() ?? 'XLSX'} · <span className="font-semibold text-foreground">Sheet:</span> {uploadFeedback.sheetUsed ?? 'entry'}</div>
                  <div><span className="font-semibold text-foreground">Rows read:</span> {uploadFeedback.runtimeDiagnostics.rowsRead} · <span className="font-semibold text-foreground">Valid records:</span> {uploadFeedback.runtimeDiagnostics.validRows}</div>
                  {uploadFeedback.runtimeDiagnostics.dateMin && (
                    <div><span className="font-semibold text-foreground">Date range:</span> {uploadFeedback.runtimeDiagnostics.dateMin} to {uploadFeedback.runtimeDiagnostics.dateMax}</div>
                  )}
                  {uploadFeedback.runtimeDiagnostics.plantsFound.length > 0 && (
                    <div><span className="font-semibold text-foreground">Plants:</span> {uploadFeedback.runtimeDiagnostics.plantsFound.join(', ')}</div>
                  )}
                  {uploadFeedback.runtimeDiagnostics.devicesFound.length > 0 && (
                    <div><span className="font-semibold text-foreground">Devices:</span> {uploadFeedback.runtimeDiagnostics.devicesFound.length} found</div>
                  )}
                  {uploadFeedback.runtimeDiagnostics.shiftsFound.length > 0 && (
                    <div><span className="font-semibold text-foreground">Shifts:</span> {uploadFeedback.runtimeDiagnostics.shiftsFound.join(', ')}</div>
                  )}
                  {uploadFeedback.runtimeDiagnostics.skippedReasons.length > 0 && (
                    <div><span className="font-semibold text-foreground">Skipped:</span> {uploadFeedback.runtimeDiagnostics.skippedReasons.join(' · ')}</div>
                  )}
                </div>
              )}
              {uploadFeedback.type === 'issues' && uploadFeedback.issuesDiagnostics && (
                <div className="mt-2 text-xs space-y-1 text-muted-foreground">
                  <div>
                    <span className="font-semibold text-foreground">Rows read:</span> {uploadFeedback.issuesDiagnostics.rowsRead.toLocaleString()}
                    {' · '}<span className="font-semibold text-foreground">Inserted:</span> {(uploadFeedback.issuesDiagnostics.inserted ?? uploadFeedback.rowsAdded).toLocaleString()}
                    {' · '}<span className="font-semibold text-foreground">Updated:</span> {(uploadFeedback.issuesDiagnostics.updated ?? uploadFeedback.rowsUpdated ?? 0).toLocaleString()}
                    {' · '}<span className="font-semibold text-foreground">Unchanged:</span> {(uploadFeedback.issuesDiagnostics.unchanged ?? uploadFeedback.rowsUnchanged ?? 0).toLocaleString()}
                    {uploadFeedback.issuesDiagnostics.skippedInvalid > 0 && (
                      <>{' · '}<span className="font-semibold text-foreground">Invalid skipped:</span> {uploadFeedback.issuesDiagnostics.skippedInvalid.toLocaleString()}</>
                    )}
                  </div>
                  <div>
                    <span className="font-semibold text-foreground">Changeovers in file:</span> {uploadFeedback.issuesDiagnostics.changeoverEvents.toLocaleString()}
                    {' · '}<span className="font-semibold text-foreground">Reclassified in:</span> {(uploadFeedback.issuesDiagnostics.changeoversAdded ?? 0).toLocaleString()}
                    {' · '}<span className="font-semibold text-foreground">Reclassified out:</span> {(uploadFeedback.issuesDiagnostics.changeoversRemoved ?? 0).toLocaleString()}
                  </div>
                  {uploadFeedback.issuesDiagnostics.dateMin && (
                    <div><span className="font-semibold text-foreground">Date range:</span> {uploadFeedback.issuesDiagnostics.dateMin} to {uploadFeedback.issuesDiagnostics.dateMax}</div>
                  )}
                  <div>
                    <span className="font-semibold text-foreground">Coverage:</span> {uploadFeedback.issuesDiagnostics.plantsFound.join(', ') || '—'}
                    {' · '}{uploadFeedback.issuesDiagnostics.machinesFound.length} machines
                    {' · '}{uploadFeedback.issuesDiagnostics.tagsFound.length} distinct tags
                  </div>
                  {uploadFeedback.issuesDiagnostics.topExcludedTags.length > 0 && (
                    <div>
                      <span className="font-semibold text-foreground">Top excluded tags:</span>{' '}
                      {uploadFeedback.issuesDiagnostics.topExcludedTags.slice(0, 6).map(t => `${t.tag} (${t.count})`).join(', ')}
                    </div>
                  )}
                  <div className="italic">Only "Change-Color/foam/label" and "Change Job" tags count as changeovers.</div>
                </div>
              )}
              {uploadFeedback.rowsAdded === 0 && uploadFeedback.type === 'oee' && uploadFeedback.diagnostics && (
                <div className="mt-2 text-xs space-y-1 text-muted-foreground">
                  <div><span className="font-semibold text-foreground">Detected format:</span> {uploadFeedback.diagnostics.format} ({uploadFeedback.diagnostics.rowsRead} rows read)</div>
                  <div>
                    <span className="font-semibold text-foreground">Columns found:</span>{' '}
                    {uploadFeedback.diagnostics.headersFound.length > 0
                      ? uploadFeedback.diagnostics.headersFound.join(', ')
                      : '(none detected)'}
                  </div>
                  {uploadFeedback.diagnostics.format === 'production' && (
                    <div><span className="font-semibold text-foreground">Expected columns:</span> Device, Scheduled Time, OEE</div>
                  )}
                  {uploadFeedback.diagnostics.format === 'simple' && (
                    <div><span className="font-semibold text-foreground">Expected columns:</span> Machine, Date, OEE</div>
                  )}
                  {uploadFeedback.diagnostics.sampleIssues.length > 0 && (
                    <div>
                      <span className="font-semibold text-foreground">Parse issues:</span>{' '}
                      {uploadFeedback.diagnostics.sampleIssues.join(' · ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Main content ────────────────────────────────────────────────── */}
        <main className="px-4 sm:px-6 py-7">
          {loading ? (
            <div className="text-center py-20 text-muted-foreground">Loading data…</div>
          ) : !hasAnyData && !loading ? (
            <div className="text-center py-20">
              <p className="mb-2 text-lg font-semibold text-foreground">No data loaded yet</p>
              <p className="mb-6 text-sm text-muted-foreground">Upload a Guidewheel CSV to get started.</p>
              {error && <p className="mt-2 text-sm text-danger">{error}</p>}
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 rounded-md border border-danger bg-danger/5 px-4 py-2 text-sm text-danger">
                  {error}
                </div>
              )}

              {/* ── Changeover Tab ────────────────────────────────────────── */}
              {activeTab === 'changeover' && (
                <>
                  {allEvents.length > 0 ? (
                    <>
                      <GlobalFilters filters={filters} onChange={setFilters} events={allEvents} filteredCount={filtered.length} />
                      <KPICards stats={stats} targets={filters.targets} events={filtered} />
                      <NeedsAttention
                        events={filtered}
                        deviceData={deviceData}
                        plantData={plantData}
                        weeklyPlantData={weeklyPlantData}
                        targets={filters.targets}
                      />
                      <PlantComparison data={plantData} />
                      <WeeklyPlantSummary data={weeklyPlantData} events={filtered} />
                      <DeviceDrilldown deviceData={deviceData} heatmapData={heatmapData} events={filtered} targets={filters.targets} />
                      <TrendView events={filtered} threshold={trendTarget} />
                      <ExportButtons
                        events={filtered}
                        plantData={plantData}
                        weeklyPlantData={weeklyPlantData}
                        deviceData={deviceData}
                        heatmapData={heatmapData}
                      />
                      {/* Job-to-Color-Change Ratio — bottom of Changeover tab only */}
                      <JobColorChangeRatio
                        changeoverEvents={filtered}
                        oeeRecords={oeeRecords}
                        filters={filters}
                      />
                    </>
                  ) : (
                    <div className="text-center py-20 text-muted-foreground">
                      No changeover data available. Upload a Guidewheel issues CSV.
                    </div>
                  )}
                </>
              )}

              {/* ── Tagging & Downtime Tab ────────────────────────────────── */}
              {activeTab === 'tagging' && (
                <TaggingDashboard
                  events={downtimeEvents}
                  complianceTarget={complianceTarget}
                  onTargetChange={setComplianceTarget}
                />
              )}

              {/* ── OEE Trends Tab ────────────────────────────────────────── */}
              {activeTab === 'oee' && (
                <OEETrends records={oeeRecords} />
              )}

              {/* ── Energy vs Uptime Tab (no energy gate) ────────────────── */}
              {activeTab === 'energy-uptime' && (
                <ErrorBoundary fallbackLabel="Energy vs Uptime tab">
                  <EnergyUptimeDashboard
                    energyRows={bestEnergyRows}
                    downtimeEvents={downtimeEvents}
                    runtimeRecords={runtimeRecords}
                  />
                </ErrorBoundary>
              )}

              {/* ── Data & Calculations Tab ───────────────────────────────── */}
              {activeTab === 'data' && (
                <DataManagement
                  dataStatus={dataStatus}
                  energyRows={bestEnergyRows}
                  runtimeRecords={runtimeRecords}
                  oeeRecords={oeeRecords}
                  downtimeEvents={downtimeEvents}
                  allEvents={allEvents}
                />
              )}

              {/* ── Energy Tab (executive-gated) ──────────────────────────── */}
              {activeTab === 'energy' && (
                <EnergyGate onAuth={loadEnergy}>
                  {avgEnergyRows.length > 0 ? (
                    <EnergyDashboard
                      avgRows={avgEnergyRows}
                      deviceData={deviceData}
                      downtimeEvents={downtimeEvents}
                      runtimeRecords={runtimeRecords}
                      lastUpdated={dataStatus?.energy_average.lastUpdated ?? null}
                    />
                  ) : (
                    <div className="text-center py-20 text-muted-foreground">
                      No energy data available. Upload an energy CSV.
                    </div>
                  )}
                </EnergyGate>
              )}

              {/* ── Manager Callouts Tab ──────────────────────────────────── */}
              {activeTab === 'callouts' && (
                <ManagerCallouts
                  changeoverEvents={allEvents}
                  downtimeEvents={downtimeEvents}
                  runtimeRecords={runtimeRecords}
                  oeeRecords={oeeRecords}
                />
              )}
            </>
          )}
        </main>
      </div>
    </AuthGate>
  )
}
