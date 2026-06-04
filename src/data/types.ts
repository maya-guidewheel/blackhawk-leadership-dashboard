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

export interface DowntimeEvent {
  start_dt: Date
  end_dt: Date
  duration: number  // minutes
  device: string
  plant: string
  status: string
  calendar_date: string  // YYYY-MM-DD
  week_start: string     // YYYY-MM-DD
  shift: string          // '1st Shift' | '2nd Shift' | '3rd Shift'
  tags: string           // raw tags string
  is_tagged: boolean     // tags field is non-empty
  is_planned: boolean    // tags include 'planned' (case-insensitive)
  comments: string
}

export interface OEERecord {
  machine: string
  date: string           // YYYY-MM-DD
  oee: number            // 0-100
  availability: number | null
  performance: number | null
  quality: number | null
  session_key?: string   // stable dedup key for multi-session-per-day data (production CSV)
}

export interface RuntimeRecord {
  device: string
  date: string       // YYYY-MM-DD
  plant: string      // Addison | Mayflower | Sparks
  shift: string      // 1st Shift | 2nd Shift | 3rd Shift | 24hr
  runtimeHrs: number
  runtimePct: number
}
