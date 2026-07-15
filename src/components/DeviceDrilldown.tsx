import { useState } from "react";
import type {
  DeviceSummary,
  WeeklyDeviceCell,
  ColorChangeEvent,
  ChangeoverTargets,
} from "../data/types";
import { formatShortDate, formatDuration } from "../utils/dates";
import { targetForType } from "../data/targets";
import { trackEvent } from "../analytics/posthog";
import DrilldownPanel from "./DrilldownPanel";

interface Props {
  deviceData: DeviceSummary[];
  heatmapData: WeeklyDeviceCell[];
  events: ColorChangeEvent[];
  targets: ChangeoverTargets;
}

type MetricKey = "avg" | "total" | "count";

function getCellColor(value: number, max: number): string {
  if (max === 0) return "bg-slate-50";
  const ratio = value / max;
  if (ratio > 0.8) return "bg-red-400 text-white";
  if (ratio > 0.6) return "bg-orange-300";
  if (ratio > 0.4) return "bg-yellow-200";
  if (ratio > 0.2) return "bg-green-200";
  return "bg-green-100";
}

function dotColor(p90: number, threshold: number): string {
  if (p90 <= threshold) return "text-success";
  if (p90 <= threshold * 1.25) return "text-warning";
  return "text-danger";
}

export default function DeviceDrilldown({
  deviceData,
  heatmapData,
  events,
  targets,
}: Props) {
  const [metric, setMetric] = useState<MetricKey>("avg");
  const [drillDevice, setDrillDevice] = useState<string | null>(null);

  if (deviceData.length === 0) return null;

  const devices = [...new Set(heatmapData.map((d) => d.device))].sort();
  const weeks = [...new Set(heatmapData.map((d) => d.week_start))].sort();
  const cellMap = new Map(
    heatmapData.map((d) => [`${d.device}||${d.week_start}`, d]),
  );
  const allValues = heatmapData.map((d) => d[metric]);
  const maxVal = allValues.length > 0 ? Math.max(...allValues) : 0;

  function openDeviceDrilldown(device: string) {
    trackEvent("drilldown_device", { device });
    setDrillDevice(device);
  }

  const baseBtnCls =
    "px-2.5 py-1 text-xs rounded font-medium transition-colors border";
  const activeBtnCls =
    "bg-btn-primary text-btn-primary-foreground border-btn-primary";
  const inactiveBtnCls =
    "bg-background-accent text-muted-foreground border-border";

  return (
    <section className="mb-8">
      <h2 className="bh-section-title">Machine / Device Drilldown</h2>

      {/* Device summary table */}
      <div className="bh-card overflow-hidden mb-4">
        <div className="overflow-x-auto">
          <table className="bh-table">
            <thead>
              <tr className="text-left">
                <th>Device</th>
                <th>Plant</th>
                <th>Type</th>
                <th className="text-right">Target</th>
                <th className="text-right">Count</th>
                <th className="text-right">Avg</th>
                <th className="text-right">Median</th>
                <th className="text-right">P90</th>
                <th className="text-right">Fastest</th>
                <th className="text-right">Slowest</th>
              </tr>
            </thead>
            <tbody>
              {deviceData.map((d) => {
                const target = targetForType(d.changeover_type, targets);
                return (
                  <tr
                    key={d.device}
                    className="cursor-pointer"
                    onClick={() => openDeviceDrilldown(d.device)}
                  >
                    <td className="font-mono text-xs font-semibold">
                      <span className={`mr-2 ${dotColor(d.p90, target)}`}>
                        ●
                      </span>
                      {d.device}
                    </td>
                    <td>{d.plant}</td>
                    <td className="text-xs text-muted-foreground">{d.changeover_type}</td>
                    <td className="text-right text-muted-foreground">≤ {formatDuration(target)}</td>
                    <td className="text-right">{d.count}</td>
                    <td className="text-right">{formatDuration(d.avg)}</td>
                    <td className="text-right">{formatDuration(d.median)}</td>
                    <td className="text-right">{formatDuration(d.p90)}</td>
                    <td className="text-right">{formatDuration(d.fastest)}</td>
                    <td className="text-right">{formatDuration(d.slowest)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Heatmap */}
      <div className="bh-card p-4 overflow-x-auto">
        <div className="flex items-center gap-4 mb-3">
          <p className="bh-metric-label">Weekly Heatmap</p>
          <div className="flex gap-1.5">
            {(["avg", "total", "count"] as MetricKey[]).map((m) => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={`${baseBtnCls} ${metric === m ? activeBtnCls : inactiveBtnCls}`}
              >
                {m === "avg"
                  ? "Avg Duration"
                  : m === "total"
                    ? "Total Time"
                    : "Count"}
              </button>
            ))}
          </div>
        </div>

        {weeks.length > 0 && (
          <table className="text-xs w-full">
            <thead>
              <tr>
                <th className="px-2 py-1 text-left font-semibold text-muted-foreground">
                  Device
                </th>
                {weeks.map((w) => (
                  <th
                    key={w}
                    className="px-2 py-1 font-semibold whitespace-nowrap text-muted-foreground"
                  >
                    {formatShortDate(w)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device}>
                  <td className="px-2 py-1 font-mono font-semibold whitespace-nowrap">
                    {device}
                  </td>
                  {weeks.map((week) => {
                    const cell = cellMap.get(`${device}||${week}`);
                    const val = cell ? cell[metric] : null;
                    return (
                      <td
                        key={week}
                        className={`px-2 py-1 text-center rounded-sm ${
                          val !== null
                            ? getCellColor(val, maxVal)
                            : "text-slate-300"
                        }`}
                      >
                        {val !== null
                          ? metric === "count"
                            ? val
                            : formatDuration(val)
                          : "–"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
          <span>Low</span>
          <div className="w-4 h-3 bg-green-100 rounded" />
          <div className="w-4 h-3 bg-green-200 rounded" />
          <div className="w-4 h-3 bg-yellow-200 rounded" />
          <div className="w-4 h-3 bg-orange-300 rounded" />
          <div className="w-4 h-3 bg-red-400 rounded" />
          <span>High</span>
        </div>
      </div>

      {drillDevice && (
        <DrilldownPanel
          title={`Device: ${drillDevice}`}
          events={events.filter((e) => e.device === drillDevice)}
          onClose={() => setDrillDevice(null)}
        />
      )}
    </section>
  );
}
