import type { EnergyRow, EnergyRates, EnergyMachineSummary, EnergyPlantSummary } from './types'

export function getPlantForMachine(machine: string): string {
  switch (machine.charAt(0)) {
    case '1': return 'Addison'
    case '2': return 'Mayflower'
    case '3': return 'Sparks'
    default: return 'Unknown'
  }
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

    for (const row of machineRows) {
      if (row.kWh >= idleThresholdKWh) {
        productionKWh += row.kWh
        activeDays++
      } else if (row.kWh > NOISE_FLOOR_KWH) {
        idleKWh += row.kWh
        idleDays++
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
