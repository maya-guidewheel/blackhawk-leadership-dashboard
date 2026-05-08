import type { ColorChangeEvent, PlantSummary, DeviceSummary, WeeklyPlantRow, WeeklyDeviceCell } from '../data/types'
import {
  exportFilteredEvents,
  exportPlantSummary,
  exportWeeklyPlantSummary,
  exportDeviceSummary,
  exportDeviceWeeklyMatrix,
} from '../utils/exports'
import { trackEvent } from '../analytics/posthog'

interface Props {
  events: ColorChangeEvent[]
  plantData: PlantSummary[]
  weeklyPlantData: WeeklyPlantRow[]
  deviceData: DeviceSummary[]
  heatmapData: WeeklyDeviceCell[]
}

export default function ExportButtons({ events, plantData, weeklyPlantData, deviceData, heatmapData }: Props) {
  function doExport(name: string, fn: () => void) {
    trackEvent('export_clicked', { export_type: name })
    fn()
  }

  return (
    <section className="mb-8">
      <h2 className="bh-section-title">Exports</h2>
      <div className="flex flex-wrap gap-2">
        <ExportBtn label="Filtered Events" onClick={() => doExport('filtered_events', () => exportFilteredEvents(events))} />
        <ExportBtn label="Plant Summary" onClick={() => doExport('plant_summary', () => exportPlantSummary(plantData))} />
        <ExportBtn label="Weekly Plant Summary" onClick={() => doExport('weekly_plant_summary', () => exportWeeklyPlantSummary(weeklyPlantData))} />
        <ExportBtn label="Device Summary" onClick={() => doExport('device_summary', () => exportDeviceSummary(deviceData))} />
        <ExportBtn label="Device Weekly Matrix" onClick={() => doExport('device_weekly_matrix', () => exportDeviceWeeklyMatrix(heatmapData))} />
      </div>
    </section>
  )
}

function ExportBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="bh-btn-ghost">
      &#8595; {label} CSV
    </button>
  )
}
