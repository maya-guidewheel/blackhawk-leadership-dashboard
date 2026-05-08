export interface RawRow {
  Start: string
  End: string
  'Duration (minutes)': string
  Devices: string
  Status: string
  Type: string
  'Alert Type': string
  'Time to Acknowledge (TTA)': string
  Action: string
  Assignees: string
  Tags: string
  Comments: string
  Changelog: string
}

export interface ColorChangeEvent {
  start_dt: Date
  end_dt: Date
  duration: number
  device: string
  plant: string
  changeover_type: string
  status: string
  calendar_date: string
  week_start: string
  tags: string
  comments: string
}

export interface StatsSummary {
  count: number
  avg: number
  median: number
  p90: number
  total: number
  fastest: number
  slowest: number
  fastestEvent?: ColorChangeEvent
  slowestEvent?: ColorChangeEvent
}

export interface PlantSummary extends StatsSummary {
  plant: string
}

export interface DeviceSummary extends StatsSummary {
  device: string
  plant: string
}

export interface WeeklyPlantRow extends StatsSummary {
  plant: string
  week_start: string
}

export interface WeeklyDeviceCell {
  device: string
  week_start: string
  avg: number
  total: number
  count: number
}

export interface FilterState {
  dateFrom: string
  dateTo: string
  plant: string
  device: string
  threshold: number
  changeoverType: string
}

export interface EnergyRow {
  machine: string
  date: string
  kWh: number
}

export interface EnergyRates {
  Sparks: number
  Addison: number
  Mayflower: number
}

export interface EnergyMachineSummary {
  machine: string
  plant: string
  totalKWh: number
  productionKWh: number
  idleKWh: number
  totalCost: number
  idleCost: number
  activeDays: number
  idleDays: number
  avgDailyKWh: number
}

export interface EnergyPlantSummary {
  plant: string
  totalKWh: number
  totalCost: number
  idleKWh: number
  idleCost: number
  machineCount: number
  avgCostPerMachine: number
}
