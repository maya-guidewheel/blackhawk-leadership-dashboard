import { useMemo } from 'react'
import type { ColorChangeEvent, OEERecord, FilterState } from '../data/types'
import { getPlantForMachine } from '../data/energyAggregations'

interface Props {
  // Already changeover-tagged + filtered to the active Changeover-tab range.
  changeoverEvents: ColorChangeEvent[]
  oeeRecords: OEERecord[]
  filters: FilterState
}

const cardCls = 'bh-card p-4'

function ratio(a: number, b: number): string {
  if (b <= 0) return '—'
  return (a / b).toFixed(2)
}

export default function JobColorChangeRatio({ changeoverEvents, oeeRecords, filters }: Props) {
  // OEE/production records in the active date + plant scope.
  const oeeInScope = useMemo(() => oeeRecords.filter(r => {
    if (!r?.date) return false
    if (filters.dateFrom && r.date < filters.dateFrom) return false
    if (filters.dateTo && r.date > filters.dateTo) return false
    if (filters.plant !== 'All' && getPlantForMachine(r.machine) !== filters.plant) return false
    return true
  }), [oeeRecords, filters])

  const colorChanges = changeoverEvents.length
  const productionRuns = oeeInScope.length
  const uniqueBatches = useMemo(() => {
    const s = new Set<string>()
    for (const r of oeeInScope) if (r.batch && r.batch.trim()) s.add(r.batch.trim())
    return s.size
  }, [oeeInScope])
  const hasBatch = uniqueBatches > 0

  // "Jobs" = distinct batch/job numbers when present, else production runs (sessions).
  const jobs = hasBatch ? uniqueBatches : productionRuns
  const jobLabel = hasBatch ? 'Unique job / batch numbers' : 'Production runs (sessions)'

  // Per-plant breakdown.
  const byPlant = useMemo(() => {
    const plants = ['Addison', 'Mayflower', 'Sparks']
    return plants.map(plant => {
      const cc = changeoverEvents.filter(e => e.plant === plant).length
      const recs = oeeInScope.filter(r => getPlantForMachine(r.machine) === plant)
      const batches = new Set<string>()
      for (const r of recs) if (r.batch && r.batch.trim()) batches.add(r.batch.trim())
      const j = hasBatch ? batches.size : recs.length
      return { plant, colorChanges: cc, jobs: j }
    }).filter(r => r.colorChanges > 0 || r.jobs > 0)
  }, [changeoverEvents, oeeInScope, hasBatch])

  const rangeLabel = `${filters.dateFrom || '—'} to ${filters.dateTo || '—'} · ${filters.plant === 'All' ? 'All Plants' : filters.plant}`

  return (
    <section className="mb-6">
      <h3 className="bh-section-title mb-1">Job-to-Color-Change Ratio</h3>
      <p className="text-[0.7rem] text-muted-foreground -mt-2 mb-3">{rangeLabel}</p>

      <div className="bh-card p-3 mb-3 text-xs text-muted-foreground border-l-4 border-l-btn-primary bg-btn-primary/5">
        How many production jobs run per logged color change / change job — a low ratio (few jobs per color change)
        can indicate scheduling is forcing frequent color changes. Color changes use only valid changeover tags
        (<span className="text-foreground">Change-Color/foam/label</span>, <span className="text-foreground">Change Job</span>). No costs shown.
      </div>

      {oeeRecords.length === 0 ? (
        <div className={`${cardCls} text-center text-sm text-muted-foreground py-8`}>
          {colorChanges > 0
            ? <>Changeover data loaded (<span className="font-semibold text-foreground">{colorChanges.toLocaleString()}</span> color changes). <span className="text-foreground">Job/batch data needed for ratio</span> — upload Production/OEE data with batch/job numbers to populate this section.</>
            : <>Job/batch data is required to calculate job-to-color-change ratio. Upload Production/OEE data with batch/job number, and Issues data with changeover tags.</>}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <div className={cardCls}>
              <div className="bh-metric-label mb-1">{jobLabel}</div>
              <div className="text-2xl font-bold text-foreground">{jobs.toLocaleString()}</div>
              {!hasBatch && <div className="text-[0.65rem] mt-0.5 text-warning">Batch numbers not in export — using session count</div>}
            </div>
            <div className={cardCls}>
              <div className="bh-metric-label mb-1">Color changes logged</div>
              <div className="text-2xl font-bold text-foreground">{colorChanges.toLocaleString()}</div>
            </div>
            <div className={cardCls}>
              <div className="bh-metric-label mb-1">Jobs per color change</div>
              <div className="text-2xl font-bold text-btn-primary">{ratio(jobs, colorChanges)}</div>
            </div>
            <div className={cardCls}>
              <div className="bh-metric-label mb-1">Color changes per job</div>
              <div className="text-2xl font-bold text-foreground">{ratio(colorChanges, jobs)}</div>
            </div>
          </div>

          {!hasBatch && (
            <div className="bh-card p-3 mb-3 text-xs text-warning border border-warning/30 bg-warning/5">
              Production data is loaded but contains no batch/job numbers, so jobs are approximated by production sessions.
              Upload a Production/OEE export that includes a Batch/Job column for an exact job-to-color-change ratio.
            </div>
          )}

          {byPlant.length > 0 && (
            <div className="bh-card overflow-hidden">
              <div className="bh-sub-header"><h3>By Plant</h3></div>
              <div className="overflow-x-auto">
                <table className="bh-table">
                  <thead>
                    <tr className="text-left">
                      <th>Plant</th>
                      <th className="text-right">{hasBatch ? 'Jobs/Batches' : 'Production Runs'}</th>
                      <th className="text-right">Color Changes</th>
                      <th className="text-right">Jobs / Color Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byPlant.map(r => (
                      <tr key={r.plant}>
                        <td>{r.plant}</td>
                        <td className="text-right">{r.jobs.toLocaleString()}</td>
                        <td className="text-right">{r.colorChanges.toLocaleString()}</td>
                        <td className="text-right font-semibold text-btn-primary">{ratio(r.jobs, r.colorChanges)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <p className="text-xs mt-2 text-muted-foreground">
            Color changes counted only from valid changeover tags. Job/batch counts come from uploaded Production/OEE data. No values are fabricated.
          </p>
        </>
      )}
    </section>
  )
}
