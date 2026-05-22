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
import {
  overallStats,
  plantSummaries,
  deviceSummaries,
  weeklyPlantSummaries,
  weeklyDeviceMatrix,
} from './data/aggregations'
import type { ColorChangeEvent, FilterState, EnergyRow, DowntimeEvent, OEERecord } from './data/types'
import { getCalendarDate } from './utils/dates'

type Tab = 'changeover' | 'tagging' | 'oee' | 'energy' | 'energy-uptime'

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
  diagnostics?: OEEDiagnostics
}

function getDefaultFilters(): FilterState {
  const today = new Date()
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
  return {
    dateFrom: getCalendarDate(thirtyDaysAgo),
    dateTo: getCalendarDate(today),
    plant: 'All',
    device: 'All',
    threshold: 45,
    changeoverType: 'All',
  }
}

function fmtTimestamp(iso: string | null): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  )
}

const TABS: { id: Tab; label: string; badge?: string }[] = [
  { id: 'changeover', label: 'Changeover' },
  { id: 'tagging', label: 'Tagging & Downtime' },
  { id: 'oee', label: 'OEE Trends' },
  { id: 'energy-uptime', label: 'Energy vs Uptime' },
  { id: 'energy', label: 'Energy & Cost', badge: 'Executive' },
]

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('changeover')
  const [allEvents, setAllEvents] = useState<ColorChangeEvent[]>([])
  const [avgEnergyRows, setAvgEnergyRows] = useState<EnergyRow[]>([])
  const [energyUsageRows, setEnergyUsageRows] = useState<EnergyRow[]>([])
  const [downtimeEvents, setDowntimeEvents] = useState<DowntimeEvent[]>([])
  const [oeeRecords, setOEERecords] = useState<OEERecord[]>([])
  const [complianceTarget, setComplianceTarget] = useState(99.5)
  const [filters, setFilters] = useState<FilterState>(getDefaultFilters())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dataStatus, setDataStatus] = useState<DataStatus | null>(null)
  const [uploadFeedback, setUploadFeedback] = useState<UploadFeedback | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Load all data from API ─────────────────────────────────────────────────
  // Defined as useCallback so AuthGate can call it again after login.
  const loadAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [issuesRes, energyRes, energyUsageRes, statusRes, downtimeRes, oeeRes] = await Promise.all([
        apiFetch('/api/data/issues'),
        apiFetch('/api/data/energy/average'), // 401 here is expected if not energy-authed
        apiFetch('/api/data/energy/usage'),   // non-gated; used by Energy vs Uptime tab
        apiFetch('/api/status'),
        apiFetch('/api/data/downtime'),
        apiFetch('/api/data/oee'),
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
        setFilters(f => ({ ...f, dateFrom: dates[0], dateTo: dates[dates.length - 1] }))
      }

      // Load energy data only if the energy session token is already valid.
      if (energyRes.ok) {
        const energyData = await energyRes.json()
        setAvgEnergyRows(energyData.rows as EnergyRow[])
      }

      // Non-gated energy usage (kWh without cost data) — always load if main auth passes.
      if (energyUsageRes.ok) {
        const usageData = await energyUsageRes.json()
        setEnergyUsageRows(usageData.rows as EnergyRow[])
      }

      // Load downtime events
      if (downtimeRes.ok) {
        const downtimeData = await downtimeRes.json()
        const dEvents: DowntimeEvent[] = (downtimeData.events as any[]).map(e => ({
          ...e,
          start_dt: new Date(e.start_dt),
          end_dt: new Date(e.end_dt),
        }))
        setDowntimeEvents(dEvents)
      }

      // Load OEE records
      if (oeeRes.ok) {
        const oeeData = await oeeRes.json()
        setOEERecords(oeeData.records as OEERecord[])
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
      setAvgEnergyRows(data.rows as EnergyRow[])
      const statusRes = await apiFetch('/api/status')
      if (statusRes.ok) setDataStatus(await statusRes.json())
    } catch { /* non-fatal — energy data loads when gate reopens */ }
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
      setFilters(f => ({ ...f, dateFrom: dates[0], dateTo: dates[dates.length - 1] }))
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

    try {
      const res = await apiFetch('/api/upload', { method: 'POST', body: formData })
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Upload failed') }
      const result = await res.json() as UploadFeedback
      setUploadFeedback(result)
      if (result.type === 'issues') await refreshIssues()
      else if (result.type === 'energy_average') {
        await Promise.all([refreshEnergy(), refreshEnergyUsage()])
      } else if (result.type === 'oee') await refreshOEE()
      await refreshStatus()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [refreshIssues, refreshEnergy, refreshEnergyUsage, refreshStatus])

  // ── Derived data ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => allEvents.filter(e => {
    if (e.calendar_date < filters.dateFrom || e.calendar_date > filters.dateTo) return false
    if (filters.plant !== 'All' && e.plant !== filters.plant) return false
    if (filters.device !== 'All' && e.device !== filters.device) return false
    if (filters.changeoverType !== 'All' && e.changeover_type !== filters.changeoverType) return false
    return true
  }), [allEvents, filters])

  const stats = useMemo(() => overallStats(filtered), [filtered])
  const plantData = useMemo(() => plantSummaries(filtered), [filtered])
  const deviceData = useMemo(() => deviceSummaries(filtered), [filtered])
  const weeklyPlantData = useMemo(() => weeklyPlantSummaries(filtered), [filtered])
  const heatmapData = useMemo(() => weeklyDeviceMatrix(filtered), [filtered])

  const hasAnyData = allEvents.length > 0 || avgEnergyRows.length > 0 || energyUsageRows.length > 0

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
          <div className="max-w-dashboard mx-auto px-6">
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
                  <label className="inline-flex items-center gap-2 cursor-pointer rounded-md bg-btn-primary text-btn-primary-foreground hover:bg-btn-primary-accent px-3.5 py-1.5 text-sm font-medium transition-colors">
                    {uploading ? 'Uploading…' : 'Upload CSV'}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv"
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
          <div className="max-w-dashboard mx-auto px-6 flex items-end gap-1 border-t border-border-muted">
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
          <div className="max-w-dashboard mx-auto px-4 sm:px-6 mt-3">
            <div
              className={`rounded-md border px-4 py-3 text-sm ${
                uploadFeedback.rowsAdded > 0
                  ? 'border-success bg-success/5 text-success'
                  : 'border-warning bg-warning/5 text-warning'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="text-foreground">
                  <span className="font-semibold">{uploadFeedback.fileName}</span>
                  {' — '}
                  <span className="font-semibold">
                    {uploadFeedback.rowsAdded.toLocaleString()} records added
                  </span>
                  {uploadFeedback.duplicatesSkipped > 0 && (
                    <span className="text-muted-foreground">
                      , {uploadFeedback.duplicatesSkipped.toLocaleString()} duplicates skipped
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
        <main className="max-w-dashboard mx-auto px-4 sm:px-6 py-7">
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
                      <KPICards stats={stats} threshold={filters.threshold} events={filtered} />
                      <NeedsAttention
                        events={filtered}
                        deviceData={deviceData}
                        plantData={plantData}
                        weeklyPlantData={weeklyPlantData}
                        threshold={filters.threshold}
                      />
                      <PlantComparison data={plantData} threshold={filters.threshold} />
                      <WeeklyPlantSummary data={weeklyPlantData} events={filtered} />
                      <DeviceDrilldown deviceData={deviceData} heatmapData={heatmapData} events={filtered} threshold={filters.threshold} />
                      <TrendView events={filtered} threshold={filters.threshold} />
                      <ExportButtons
                        events={filtered}
                        plantData={plantData}
                        weeklyPlantData={weeklyPlantData}
                        deviceData={deviceData}
                        heatmapData={heatmapData}
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
                <EnergyUptimeDashboard energyRows={energyUsageRows} downtimeEvents={downtimeEvents} />
              )}

              {/* ── Energy Tab (executive-gated) ──────────────────────────── */}
              {activeTab === 'energy' && (
                <EnergyGate onAuth={loadEnergy}>
                  {avgEnergyRows.length > 0 ? (
                    <EnergyDashboard avgRows={avgEnergyRows} deviceData={deviceData} />
                  ) : (
                    <div className="text-center py-20 text-muted-foreground">
                      No energy data available. Upload an energy CSV.
                    </div>
                  )}
                </EnergyGate>
              )}
            </>
          )}
        </main>
      </div>
    </AuthGate>
  )
}
