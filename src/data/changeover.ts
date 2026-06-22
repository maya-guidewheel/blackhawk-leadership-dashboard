// ── Centralized Changeover Classification ────────────────────────────────────
// SINGLE SOURCE OF TRUTH for deciding whether a downtime issue is a changeover.
//
// Only two tag categories count as changeovers. Everything else (No Product,
// No Labor, Planned, Maintenance, etc.) is downtime — NOT a changeover.
//
// This module is intentionally dependency-free so it can be imported by both the
// browser bundle (parser.ts) and the Node server (server.ts) without pulling in
// date-fns or other heavy deps.

// Human-readable allowed tags (exact source spelling). Easy to audit.
export const ALLOWED_CHANGEOVER_TAGS = ['Change-Color/foam/label', 'Change Job'] as const

// Canonical forms used for matching. canonicalizeTag() maps any acceptable
// punctuation/spacing variant onto one of these. We deliberately keep this set
// tiny so unrelated downtime tags can never match.
const ALLOWED_CANONICAL: Record<string, (typeof ALLOWED_CHANGEOVER_TAGS)[number]> = {
  'change color foam label': 'Change-Color/foam/label',
  'change job': 'Change Job',
}

// Lowercase, then collapse every run of non-alphanumeric characters to a single
// space and trim. This treats "Change-Color/foam/label", "change color/foam/label",
// and "Change-Color / Foam / Label" as the same tag, while keeping "change", "job",
// "no product", "no labor" etc. clearly distinct (they canonicalize to different
// strings and are not in ALLOWED_CANONICAL).
export function canonicalizeTag(tag: string): string {
  return (tag || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// Split a raw Guidewheel tags string into individual tag parts.
export function splitTags(tags: string): string[] {
  return (tags || '')
    .split(/[,;|\n\r]+/)
    .map(t => t.trim())
    .filter(Boolean)
}

export interface ChangeoverClassification {
  isChangeover: boolean
  matchedTag: string | null      // the raw tag part (as written) that qualified
  matchedCategory: string | null // the canonical allowed tag it matched
}

// Classify an issue by its raw tags string. An issue is a changeover only if at
// least one of its tags matches an allowed changeover tag. All tags are preserved
// upstream for audit display — this function never mutates the tags.
export function classifyChangeover(tags: string): ChangeoverClassification {
  for (const part of splitTags(tags)) {
    const category = ALLOWED_CANONICAL[canonicalizeTag(part)]
    if (category) {
      return { isChangeover: true, matchedTag: part, matchedCategory: category }
    }
  }
  return { isChangeover: false, matchedTag: null, matchedCategory: null }
}

// Convenience boolean helper.
export function isChangeoverTag(tags: string): boolean {
  return classifyChangeover(tags).isChangeover
}
