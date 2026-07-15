// ── Per-Changeover-Type Targets ──────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for the "on-target" duration threshold, which differs
// by changeover type. Rey (Jul 15 2026 call):
//   • Color Change target = 45 min
//   • Roll Change  target = 10 min
//   • Foam Change  target = 10 min  (pending formal confirmation)
// Anything that classifies as Other / Unknown falls back to `other`.
//
// Kept dependency-free so it can be shared by every Changeover-tab component.

import type { ChangeoverTargets } from './types'

export const DEFAULT_TARGETS: ChangeoverTargets = {
  color: 45,
  roll: 10,
  foam: 10,
  other: 45,
}

// Resolve the target (minutes) for a given changeover_type. The type strings
// come from the parser (getChangeoverType): 'Color Change' | 'Roll Change' |
// 'Foam Change'. Anything else uses the Other/Unknown fallback so we never
// silently apply the color-change target to a roll or foam change.
export function targetForType(changeoverType: string, targets: ChangeoverTargets): number {
  switch (changeoverType) {
    case 'Color Change': return targets.color
    case 'Roll Change':  return targets.roll
    case 'Foam Change':  return targets.foam
    default:             return targets.other
  }
}

// An event is on target when its duration is within its own type's target.
export function isOnTarget(
  e: { duration: number; changeover_type: string },
  targets: ChangeoverTargets,
): boolean {
  return e.duration <= targetForType(e.changeover_type, targets)
}
