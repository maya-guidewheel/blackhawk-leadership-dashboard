import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
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
      <div className="min-h-screen" style={{ backgroundColor: 'var(--color-background)' }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header style={{ backgroundColor: 'var(--color-primary)' }}>
          {/* Top bar */}
          <div className="max-w-dashboard mx-auto px-6 flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              {/* Customer logo */}
              <div
                className="flex items-center justify-center rounded-md shrink-0"
                style={{ background: '#ffffff', padding: '5px 10px', height: 52 }}
              >
                <img
                  src="/blackhawk_molding_logo.jpg"
                  alt="Blackhawk Molding"
                  style={{ height: 42, width: 'auto', objectFit: 'contain', display: 'block' }}
                />
              </div>
              {/* Divider */}
              <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.2)' }} />
              <div>
                <div className="text-[0.6rem] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  Powered by Guidewheel
                </div>
                <h1 className="text-sm font-bold tracking-wide text-white leading-tight">
                  Leadership Dashboard
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {lastUpdatedText && (
                <span className="text-xs opacity-40 hidden md:inline">{lastUpdatedText}</span>
              )}
              <label
                className="text-white text-sm px-4 py-1.5 rounded cursor-pointer font-medium transition-opacity hover:opacity-90"
                style={{ backgroundColor: uploading ? '#6b7280' : 'var(--color-accent)' }}
              >
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
            </div>
          </div>

          {/* Tab bar */}
          <div className="max-w-dashboard mx-auto px-6 flex items-end gap-1">
            {TABS.map(tab => {
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className="relative flex items-center gap-2 px-5 py-2.5 text-sm font-medium transition-colors focus:outline-none"
                  style={{
                    color: isActive ? '#ffffff' : 'rgba(255,255,255,0.45)',
                    borderBottom: isActive
                      ? '2px solid var(--color-accent)'
                      : '2px solid transparent',
                    marginBottom: -1,
                  }}
                >
                  {tab.label}
                  {tab.badge && (
                    <span
                      className="text-[0.55rem] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{
                        background: isActive ? 'rgba(255,105,0,0.25)' : 'rgba(255,255,255,0.1)',
                        color: isActive ? 'var(--color-accent)' : 'rgba(255,255,255,0.35)',
                      }}
                    >
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
              className="rounded-lg px-4 py-3 text-sm"
              style={{
                background: uploadFeedback.rowsAdded > 0 ? '#f0fdf4' : '#fffbeb',
                border: `1px solid ${uploadFeedback.rowsAdded > 0 ? '#bbf7d0' : '#fde68a'}`,
                color: uploadFeedback.rowsAdded > 0 ? '#166534' : '#92400e',
              }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold">{uploadFeedback.fileName}</span>
                  {' — '}
                  <span className="font-bold">
                    {uploadFeedback.rowsAdded.toLocaleString()} records added
                  </span>
                  {uploadFeedback.duplicatesSkipped > 0 && (
                    <span className="opacity-70">
                      , {uploadFeedback.duplicatesSkipped.toLocaleString()} duplicates skipped
                    </span>
                  )}
                  <span className="ml-2 text-xs opacity-60">({uploadFeedback.type.replace(/_/g, ' ')})</span>
                </div>
                <button onClick={() => setUploadFeedback(null)} className="ml-4 opacity-50 hover:opacity-100 font-bold text-lg leading-none shrink-0">×</button>
              </div>
              {uploadFeedback.rowsAdded === 0 && uploadFeedback.type === 'oee' && uploadFeedback.diagnostics && (
                <div className="mt-2 text-xs space-y-1 opacity-80">
                  <div><span className="font-semibold">Detected format:</span> {uploadFeedback.diagnostics.format} ({uploadFeedback.diagnostics.rowsRead} rows read)</div>
                  <div>
                    <span className="font-semibold">Columns found:</span>{' '}
                    {uploadFeedback.diagnostics.headersFound.length > 0
                      ? uploadFeedback.diagnostics.headersFound.join(', ')
                      : '(none detected)'}
                  </div>
                  {uploadFeedback.diagnostics.format === 'production' && (
                    <div><span className="font-semibold">Expected columns:</span> Device, Scheduled Time, OEE</div>
                  )}
                  {uploadFeedback.diagnostics.format === 'simple' && (
                    <div><span className="font-semibold">Expected columns:</span> Machine, Date, OEE</div>
                  )}
                  {uploadFeedback.diagnostics.sampleIssues.length > 0 && (
                    <div>
                      <span className="font-semibold">Parse issues:</span>{' '}
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
            <div className="text-center py-20" style={{ color: 'var(--color-muted)' }}>Loading data…</div>
          ) : !hasAnyData && !loading ? (
            <div className="text-center py-20">
              <p className="mb-2 text-lg font-semibold" style={{ color: 'var(--color-text)' }}>No data loaded yet</p>
              <p className="mb-6 text-sm" style={{ color: 'var(--color-muted)' }}>Upload a Guidewheel CSV to get started.</p>
              {error && <p className="mt-2 text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>}
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 px-4 py-2 rounded text-sm" style={{ background: '#fef2f2', color: 'var(--color-danger)', border: '1px solid #fecaca' }}>
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
                    <div className="text-center py-20" style={{ color: 'var(--color-muted)' }}>
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
                    <div className="text-center py-20" style={{ color: 'var(--color-muted)' }}>
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
