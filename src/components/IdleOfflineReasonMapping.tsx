import { useMemo } from 'react'
import type { DowntimeEvent, EnergyRow } from '../data/types'
import { getMachineTypeKey, MACHINE_TYPE_LABELS } from '../data/energyAggregations'
import { splitTags, classifyChangeover } from '../data/changeover'

interface Props {
  downtimeEvents: DowntimeEvent[]
  energyRows: EnergyRow[]
  idleThreshold: number
  noiseFloor: number
  dateFrom: string
  dateTo: string
  plantFilter: string
  selectedMachineTypes: Set<string>
}

const NOISE = 1

// Machine state inferred from that machine's energy on the event day:
//   off      → below noise floor (machine effectively off / offline)
//   idle/on  → drawing power but under the productive threshold
//   on/prod  → at or above the productive threshold
//   unknown  → no energy reading for that machine-day
type State = 'off' | 'idleOn' | 'prodOn' | 'unknown'

function fmtDur(min: number): string {
  if (min < 60) return `${Math.round(min)}m`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

interface TagRow {
  tag: string
  count: number
  totalMin: number
  idleOnMin: number
  offMin: number
  unknownMin: number
  plants: string[]
  machineTypes: string[]
  topMachines: { device: string; min: number }[]
  isChangeover: boolean
  flags: string[]
}

export default function IdleOfflineReasonMapping({
  downtimeEvents, energyRows, idleThreshold, noiseFloor,
  dateFrom, dateTo, plantFilter, selectedMachineTypes,
}: Props) {
  // machine|date → kWh for that day
  const energyMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of energyRows) {
      if (!r?.machine || !r?.date) continue
      m.set(`${r.machine}|${r.date}`, (m.get(`${r.machine}|${r.date}`) ?? 0) + (r.kWh ?? 0))
    }
    return m
  }, [energyRows])

  const allTypes = selectedMachineTypes.has('M') && selectedMachineTypes.has('K') && selectedMachineTypes.has('L')

  // Apply the same date/plant/machine-type filters the Energy tab uses.
  const events = useMemo(() => downtimeEvents.filter(e => {
    if (dateFrom && e.calendar_date < dateFrom) return false
    if (dateTo && e.calendar_date > dateTo) return false
    if (plantFilter !== 'All' && e.plant !== plantFilter) return false
    if (!allTypes && !selectedMachineTypes.has(getMachineTypeKey(e.device))) return false
    return true
  }), [downtimeEvents, dateFrom, dateTo, plantFilter, allTypes, selectedMachineTypes])

  const floor = noiseFloor || NOISE

  function stateFor(device: string, date: string): State {
    const kwh = energyMap.get(`${device}|${date}`)
    if (kwh === undefined) return 'unknown'
    if (kwh < floor) return 'off'
    if (kwh < idleThreshold) return 'idleOn'
    return 'prodOn'
  }

  const tagRows = useMemo<TagRow[]>(() => {
    const map = new Map<string, {
      count: number; totalMin: number; idleOnMin: number; offMin: number; unknownMin: number
      plants: Set<string>; types: Set<string>; perMachine: Map<string, number>; isChangeover: boolean
    }>()

    for (const e of events) {
      const tags = splitTags(e.tags)
      if (tags.length === 0) continue
      const st = stateFor(e.device, e.calendar_date)
      // Attribute the event's duration to EACH of its tags (a tagging view).
      for (const tag of tags) {
        let agg = map.get(tag)
        if (!agg) {
          agg = { count: 0, totalMin: 0, idleOnMin: 0, offMin: 0, unknownMin: 0, plants: new Set(), types: new Set(), perMachine: new Map(), isChangeover: classifyChangeover(tag).isChangeover }
          map.set(tag, agg)
        }
        agg.count++
        agg.totalMin += e.duration
        if (st === 'idleOn' || st === 'prodOn') agg.idleOnMin += e.duration
        else if (st === 'off') agg.offMin += e.duration
        else agg.unknownMin += e.duration
        agg.plants.add(e.plant)
        const tk = getMachineTypeKey(e.device)
        if (tk !== 'other') agg.types.add(MACHINE_TYPE_LABELS[tk])
        agg.perMachine.set(e.device, (agg.perMachine.get(e.device) ?? 0) + e.duration)
      }
    }

    const rows: TagRow[] = []
    for (const [tag, agg] of map.entries()) {
      const topMachines = Array.from(agg.perMachine.entries())
        .map(([device, min]) => ({ device, min }))
        .sort((a, b) => b.min - a.min)
        .slice(0, 3)
      const onShare = agg.totalMin > 0 ? agg.idleOnMin / agg.totalMin : 0
      const lower = tag.toLowerCase()
      const flags: string[] = []
      // Suspicious combos — only when the data shows machine-on time for the tag.
      if (agg.idleOnMin > 0 && onShare >= 0.25) {
        if (lower.includes('no labor')) flags.push('“No Labor” logged while machine was drawing power (idle/on) — may indicate tagging/state mismatch')
        else if (lower.includes('no product')) flags.push('“No Product” logged while machine was drawing power (idle/on) — requires manager review')
        else if (lower.includes('planned')) flags.push('“Planned” used during machine-on idle periods — confirm whether downtime was truly planned')
        else if (agg.isChangeover) flags.push('Changeover tag during machine-on time — verify the changeover state')
      }
      rows.push({
        tag, count: agg.count, totalMin: agg.totalMin,
        idleOnMin: agg.idleOnMin, offMin: agg.offMin, unknownMin: agg.unknownMin,
        plants: Array.from(agg.plants).sort(),
        machineTypes: Array.from(agg.types).sort(),
        topMachines, isChangeover: agg.isChangeover, flags,
      })
    }
    return rows.sort((a, b) => b.totalMin - a.totalMin)
  }, [events]) // eslint-disable-line react-hooks/exhaustive-deps

  const cardCls = 'bh-card p-4'
  const hasEnergy = energyRows.length > 0
  const flagged = tagRows.filter(r => r.flags.length > 0)

  return (
    <section className="mb-6">
      <h3 className="bh-section-title mb-1">Idle vs Offline Reason-Code Mapping</h3>
      <p className="text-[0.7rem] text-muted-foreground -mt-2 mb-3">
        {dateFrom && dateTo ? `${dateFrom} – ${dateTo}` : 'All dates'} · {plantFilter === 'All' ? 'All Plants' : plantFilter} · {events.length.toLocaleString()} tagged events
      </p>

      <div className="bh-card p-3 mb-3 text-xs text-muted-foreground border-l-4 border-l-btn-primary bg-btn-primary/5">
        <span className="font-semibold text-foreground">Investigative view.</span> Machine state is inferred from that machine's daily energy:
        <span className="text-foreground"> Off/offline</span> &lt; {floor} kWh/day · <span className="text-foreground">Idle/on</span> {floor}–{idleThreshold} kWh/day · <span className="text-foreground">On/productive</span> ≥ {idleThreshold} kWh/day.
        Flags are <span className="text-foreground">potential review items</span>, not confirmed errors — they require manager review.
      </div>

      {!hasEnergy ? (
        <div className={`${cardCls} text-center text-sm text-muted-foreground py-8`}>
          Energy data is needed to infer machine state. Idle vs offline mapping requires energy readings for the selected machines/dates.
        </div>
      ) : events.length === 0 ? (
        <div className={`${cardCls} text-center text-sm text-muted-foreground py-8`}>
          No tagged downtime events in the selected range/filters.
        </div>
      ) : (
        <>
          {flagged.length > 0 && (
            <div className="bh-card p-3 mb-3 border-l-4 border-l-warning bg-warning/5">
              <div className="text-sm font-semibold text-warning mb-1">Potential review items ({flagged.length})</div>
              <ul className="text-xs text-muted-foreground space-y-0.5">
                {flagged.slice(0, 6).map(r => (
                  <li key={r.tag}>• <span className="font-medium text-foreground">{r.tag}</span>: {r.flags[0]}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="bh-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="bh-table">
                <thead>
                  <tr className="text-left">
                    <th>Reason Code / Tag</th>
                    <th>Plants</th>
                    <th>Machine Types</th>
                    <th className="text-right">Events</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Idle/On</th>
                    <th className="text-right">Off</th>
                    <th className="text-right">Unknown</th>
                    <th>Top Machines</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {tagRows.map(r => (
                    <tr key={r.tag} className={r.flags.length > 0 ? 'bg-warning/5' : ''}>
                      <td className="font-medium">
                        {r.tag}
                        {r.isChangeover && <span className="ml-1 text-[0.6rem] px-1 py-0.5 rounded bg-btn-primary/10 text-btn-primary">changeover</span>}
                      </td>
                      <td className="text-xs text-muted-foreground">{r.plants.join(', ') || '—'}</td>
                      <td className="text-xs text-muted-foreground">{r.machineTypes.join(', ') || '—'}</td>
                      <td className="text-right">{r.count.toLocaleString()}</td>
                      <td className="text-right">{fmtDur(r.totalMin)}</td>
                      <td className="text-right">{r.idleOnMin > 0 ? fmtDur(r.idleOnMin) : '—'}</td>
                      <td className="text-right">{r.offMin > 0 ? fmtDur(r.offMin) : '—'}</td>
                      <td className="text-right text-muted-foreground">{r.unknownMin > 0 ? fmtDur(r.unknownMin) : '—'}</td>
                      <td className="text-xs font-mono text-muted-foreground">
                        {r.topMachines.map(m => m.device).join(', ') || '—'}
                      </td>
                      <td className="text-xs">
                        {r.flags.length > 0
                          ? <span className="text-warning" title={r.flags.join(' · ')}>⚠ Potential review item</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs mt-2 text-muted-foreground">
            “Unknown” = no energy reading for that machine on the event day, so state could not be inferred. Mapping is for investigation only and does not prove operator error.
          </p>
        </>
      )}
    </section>
  )
}
