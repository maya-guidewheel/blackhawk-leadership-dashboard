import type { ColorChangeEvent } from '../data/types'
import { formatDate } from '../utils/dates'

interface Props {
  title: string
  events: ColorChangeEvent[]
  onClose: () => void
}

function r(n: number): string {
  return (Math.round(n * 10) / 10).toString()
}

export default function DrilldownPanel({ title, events, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-16 overflow-y-auto">
      <div className="bh-card shadow-2xl w-full max-w-4xl mx-4 mb-16 overflow-hidden">
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <h3 className="font-semibold text-sm text-white">{title}</h3>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white text-xl leading-none transition-colors"
          >
            &times;
          </button>
        </div>
        <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
          <table className="bh-table">
            <thead>
              <tr className="text-left">
                <th>Plant</th>
                <th>Device</th>
                <th>Start</th>
                <th>End</th>
                <th className="text-right">Duration (min)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {events
                .sort((a, b) => a.start_dt.getTime() - b.start_dt.getTime())
                .map((e, i) => (
                  <tr key={i}>
                    <td>{e.plant}</td>
                    <td className="font-mono text-xs">{e.device}</td>
                    <td className="text-xs">{formatDate(e.start_dt)}</td>
                    <td className="text-xs">{formatDate(e.end_dt)}</td>
                    <td className="text-right font-semibold">{r(e.duration)}</td>
                    <td className="text-xs">{e.status}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {events.length === 0 && (
            <p className="text-center py-8" style={{ color: 'var(--color-muted)' }}>No events</p>
          )}
        </div>
      </div>
    </div>
  )
}
