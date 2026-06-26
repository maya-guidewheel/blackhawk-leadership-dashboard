import type { EnergyRow, EnergyRates, EnergyMachineSummary, EnergyPlantSummary } from './types'

export function getPlantForMachine(machine: string): string {
  switch (machine.charAt(0)) {
    case '1': return 'Addison'
    case '2': return 'Mayflower'
    case '3': return 'Sparks'
    default: return 'Unknown'
  }
}

// Blackhawk device nomenclature: 1st char = plant (1/2/3), 2nd char = machine
// type letter (M = Molding, K = Kleen Peel, L = Liners). Returns the type KEY.
// Falls back to a scan if the 2nd char isn't a known type letter so unusual
// names still classify consistently with the rest of the dashboard.
export function getMachineTypeKey(machine: string): 'M' | 'K' | 'L' | 'other' {
  const u = (machine || '').toUpperCase()
  const second = u.charAt(1)
  if (second === 'M' || second === 'K' || second === 'L') return second
  if (u.includes('M')) return 'M'
  if (u.includes('K')) return 'K'
  if (u.includes('L')) return 'L'
  return 'other'
}

export const MACHINE_TYPE_LABELS: Record<'M' | 'K' | 'L', string> = {
  M: 'Molding',
  K: 'Kleen Peel',
  L: 'Liners',
}

const NOISE_FLOOR_KWH = 1

export function computeEnergyByMachine(
  rows: EnergyRow[],
  rates: EnergyRates,
  idleThresholdKWh: number
): EnergyMachineSummary[] {
  const byMachine = new Map<string, EnergyRow[]>()
  for (const row of rows) {
    const arr = byMachine.get(row.machine) || []
    arr.push(row)
    byMachine.set(row.machine, arr)
  }

  const result: EnergyMachineSummary[] = []
  for (const [machine, machineRows] of byMachine.entries()) {
    const plant = getPlantForMachine(machine)
    const rate = rates[plant as keyof EnergyRates] ?? 0.09

    let productionKWh = 0
    let idleKWh = 0
    let activeDays = 0
    let idleDays = 0
    let offlineDays = 0

    // Day-level state classification (same thresholds as Energy vs Uptime):
    //   productive/online  → kWh ≥ idle threshold
    //   idle               → noise floor < kWh < idle threshold
    //   offline/off        → kWh ≤ noise floor
    for (const row of machineRows) {
      if (row.kWh >= idleThresholdKWh) {
        productionKWh += row.kWh
        activeDays++
      } else if (row.kWh > NOISE_FLOOR_KWH) {
        idleKWh += row.kWh
        idleDays++
      } else {
        offlineDays++
      }
    }

    const totalKWh = productionKWh + idleKWh
    result.push({
      machine,
      plant,
      totalKWh,
      productionKWh,
      idleKWh,
      totalCost: totalKWh * rate,
      idleCost: idleKWh * rate,
      activeDays,
      idleDays,
      offlineDays,
      avgDailyKWh: machineRows.length > 0 ? totalKWh / machineRows.length : 0,
    })
  }

  return result.sort((a, b) => b.totalCost - a.totalCost)
}

export function computeEnergyByPlant(
  machineSummaries: EnergyMachineSummary[]
): EnergyPlantSummary[] {
  const byPlant = new Map<string, EnergyMachineSummary[]>()
  for (const m of machineSummaries) {
    const arr = byPlant.get(m.plant) || []
    arr.push(m)
    byPlant.set(m.plant, arr)
  }

  return Array.from(byPlant.entries())
    .map(([plant, machines]) => {
      const totalKWh = machines.reduce((s, m) => s + m.totalKWh, 0)
      const totalCost = machines.reduce((s, m) => s + m.totalCost, 0)
      const idleKWh = machines.reduce((s, m) => s + m.idleKWh, 0)
      const idleCost = machines.reduce((s, m) => s + m.idleCost, 0)
      const machineCount = machines.length
      return {
        plant,
        totalKWh,
        totalCost,
        idleKWh,
        idleCost,
        machineCount,
        avgCostPerMachine: machineCount > 0 ? totalCost / machineCount : 0,
      }
    })
    .sort((a, b) => b.totalCost - a.totalCost)
}
