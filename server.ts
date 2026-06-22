import express, { type Request, type Response, type NextFunction } from 'express'
import Database from 'better-sqlite3'
import multer from 'multer'
import { createHash, timingSafeEqual, randomBytes } from 'node:crypto'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import rateLimit from 'express-rate-limit'
import compression from 'compression'
import { parseEnergyCSV, parseOEECSV, parseIssueRows, summarizeIssues, detectCsvDataset } from './src/data/parser'
import type { OEEDiagnostics, ParsedIssueRow } from './src/data/parser'
import type { ColorChangeEvent, EnergyRow, RuntimeRecord } from './src/data/types'
import { classifyChangeover } from './src/data/changeover'
import { normalizeDateOnly } from './src/utils/dates'

// CJS-interop require — used for the xlsx package (CommonJS module)
const _require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let XLSX: any = null
try {
  XLSX = _require('xlsx')
  console.log('[server] xlsx loaded, version:', XLSX.version)
} catch {
  console.warn('[server] xlsx not available — Excel uploads disabled')
}

// ── Environment ────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PORT = parseInt(process.env.PORT || '3001', 10)
const DB_PATH = process.env.DB_PATH || join(__dirname, 'blackhawk.db')

// Ensure DB directory exists (handles /data/ on Railway volume)
mkdirSync(dirname(DB_PATH), { recursive: true })

// ── Database ───────────────────────────────────────────────────────────────
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS issues (
    row_hash      TEXT PRIMARY KEY,
    start_dt      TEXT NOT NULL,
    end_dt        TEXT NOT NULL,
    duration      REAL NOT NULL,
    device        TEXT NOT NULL,
    plant         TEXT NOT NULL,
    status        TEXT,
    calendar_date TEXT NOT NULL,
    week_start    TEXT NOT NULL,
    tags          TEXT,
    comments      TEXT,
    ingested_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS energy_average (
    row_hash    TEXT PRIMARY KEY,
    machine     TEXT NOT NULL,
    date        TEXT NOT NULL,
    kwh         REAL NOT NULL,
    ingested_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS energy_max (
    row_hash    TEXT PRIMARY KEY,
    machine     TEXT NOT NULL,
    date        TEXT NOT NULL,
    kwh         REAL NOT NULL,
    ingested_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ingestion_log (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name          TEXT NOT NULL,
    table_name         TEXT NOT NULL,
    rows_added         INTEGER NOT NULL,
    duplicates_skipped INTEGER NOT NULL,
    ingested_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS downtime_events (
    row_hash      TEXT PRIMARY KEY,
    start_dt      TEXT NOT NULL,
    end_dt        TEXT NOT NULL,
    duration      REAL NOT NULL,
    device        TEXT NOT NULL,
    plant         TEXT NOT NULL,
    status        TEXT,
    calendar_date TEXT NOT NULL,
    week_start    TEXT NOT NULL,
    shift         TEXT NOT NULL,
    tags          TEXT,
    is_tagged     INTEGER NOT NULL DEFAULT 0,
    is_planned    INTEGER NOT NULL DEFAULT 0,
    comments      TEXT,
    ingested_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS oee_data (
    row_hash     TEXT PRIMARY KEY,
    machine      TEXT NOT NULL,
    date         TEXT NOT NULL,
    oee          REAL NOT NULL,
    availability REAL,
    performance  REAL,
    quality      REAL,
    ingested_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS runtime_data (
    row_hash    TEXT PRIMARY KEY,
    device      TEXT NOT NULL,
    date        TEXT NOT NULL,
    plant       TEXT NOT NULL,
    shift       TEXT NOT NULL,
    runtime_hrs REAL NOT NULL,
    runtime_pct REAL,
    ingested_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`)

// ── Schema Migrations ──────────────────────────────────────────────────────
try {
  db.exec("ALTER TABLE issues ADD COLUMN changeover_type TEXT NOT NULL DEFAULT 'Color Change'")
} catch { /* column already exists */ }
// is_changeover: 1 if the row's tags include an allowed changeover tag, else 0.
// Backfilled from raw tags by runChangeoverReclassify() on startup. NULL means
// "not yet classified" and is treated as not-a-changeover until backfill runs.
try {
  db.exec('ALTER TABLE issues ADD COLUMN is_changeover INTEGER')
} catch { /* column already exists */ }
// changeover_match_tag: the raw tag that qualified the row (for audit display).
try {
  db.exec('ALTER TABLE issues ADD COLUMN changeover_match_tag TEXT')
} catch { /* column already exists */ }
// Upsert audit columns. created_at = original ingested_at (never overwritten);
// updated_at + source_file refresh every time a re-upload changes the row.
for (const tbl of ['issues', 'downtime_events']) {
  try { db.exec(`ALTER TABLE ${tbl} ADD COLUMN updated_at TEXT`) } catch { /* exists */ }
  try { db.exec(`ALTER TABLE ${tbl} ADD COLUMN source_file TEXT`) } catch { /* exists */ }
}
// ingestion_log gains insert/update/unchanged breakdown so the Data Management
// tab can show refresh behavior, not just "duplicates skipped".
try { db.exec('ALTER TABLE ingestion_log ADD COLUMN rows_updated INTEGER NOT NULL DEFAULT 0') } catch { /* exists */ }
try { db.exec('ALTER TABLE ingestion_log ADD COLUMN rows_unchanged INTEGER NOT NULL DEFAULT 0') } catch { /* exists */ }

// ── Prepared Statements ────────────────────────────────────────────────────
const stmts = {
  // Upsert key = sha256(start_dt ISO | device). See ingestIssues() for rationale.
  selectIssue: db.prepare('SELECT * FROM issues WHERE row_hash = @row_hash'),
  insertIssue: db.prepare(`
    INSERT INTO issues
      (row_hash, start_dt, end_dt, duration, device, plant, changeover_type, status,
       calendar_date, week_start, tags, comments, is_changeover, changeover_match_tag,
       updated_at, source_file)
    VALUES
      (@row_hash, @start_dt, @end_dt, @duration, @device, @plant, @changeover_type, @status,
       @calendar_date, @week_start, @tags, @comments, @is_changeover, @changeover_match_tag,
       datetime('now'), @source_file)
  `),
  // Update mutable Guidewheel fields on re-upload. ingested_at (created_at) is
  // intentionally NOT touched so original-import time is preserved.
  updateIssue: db.prepare(`
    UPDATE issues SET
      end_dt = @end_dt, duration = @duration, plant = @plant,
      changeover_type = @changeover_type, status = @status, calendar_date = @calendar_date,
      week_start = @week_start, tags = @tags, comments = @comments,
      is_changeover = @is_changeover, changeover_match_tag = @changeover_match_tag,
      updated_at = datetime('now'), source_file = @source_file
    WHERE row_hash = @row_hash
  `),
  insertEnergyAvg: db.prepare(`
    INSERT OR IGNORE INTO energy_average (row_hash, machine, date, kwh)
    VALUES (@row_hash, @machine, @date, @kwh)
  `),
  insertEnergyMax: db.prepare(`
    INSERT OR IGNORE INTO energy_max (row_hash, machine, date, kwh)
    VALUES (@row_hash, @machine, @date, @kwh)
  `),
  logIngestion: db.prepare(`
    INSERT INTO ingestion_log (file_name, table_name, rows_added, duplicates_skipped, rows_updated, rows_unchanged)
    VALUES (@file_name, @table_name, @rows_added, @duplicates_skipped, @rows_updated, @rows_unchanged)
  `),
  selectDowntime: db.prepare('SELECT * FROM downtime_events WHERE row_hash = @row_hash'),
  insertDowntime: db.prepare(`
    INSERT INTO downtime_events
      (row_hash, start_dt, end_dt, duration, device, plant, status,
       calendar_date, week_start, shift, tags, is_tagged, is_planned, comments,
       updated_at, source_file)
    VALUES
      (@row_hash, @start_dt, @end_dt, @duration, @device, @plant, @status,
       @calendar_date, @week_start, @shift, @tags, @is_tagged, @is_planned, @comments,
       datetime('now'), @source_file)
  `),
  updateDowntime: db.prepare(`
    UPDATE downtime_events SET
      end_dt = @end_dt, duration = @duration, plant = @plant, status = @status,
      calendar_date = @calendar_date, week_start = @week_start, shift = @shift,
      tags = @tags, is_tagged = @is_tagged, is_planned = @is_planned, comments = @comments,
      updated_at = datetime('now'), source_file = @source_file
    WHERE row_hash = @row_hash
  `),
  insertOEE: db.prepare(`
    INSERT OR IGNORE INTO oee_data
      (row_hash, machine, date, oee, availability, performance, quality)
    VALUES
      (@row_hash, @machine, @date, @oee, @availability, @performance, @quality)
  `),
  // Changeover analysis reads ONLY rows whose tags qualify as a changeover.
  // is_changeover = 1 is enforced here so misclassified historical rows (e.g. the
  // 2K2-01 "No Product / No Labor" event) can never reach any changeover view.
  getIssues: db.prepare('SELECT * FROM issues WHERE is_changeover = 1 ORDER BY calendar_date, device'),
  getEnergyAvg: db.prepare('SELECT machine, date, kwh FROM energy_average ORDER BY machine, date'),
  getDowntime: db.prepare('SELECT * FROM downtime_events ORDER BY calendar_date, device'),
  getOEE: db.prepare('SELECT * FROM oee_data ORDER BY machine, date'),
  statsIssues: db.prepare('SELECT COUNT(*) as n, MAX(ingested_at) as last FROM issues WHERE is_changeover = 1'),
  statsEnergyAvg: db.prepare('SELECT COUNT(*) as n, MAX(ingested_at) as last FROM energy_average'),
  statsEnergyMax: db.prepare('SELECT COUNT(*) as n, MAX(ingested_at) as last FROM energy_max'),
  statsDowntime: db.prepare('SELECT COUNT(*) as n, MAX(ingested_at) as last FROM downtime_events'),
  statsOEE: db.prepare('SELECT COUNT(*) as n, MAX(ingested_at) as last FROM oee_data'),
  getSetting: db.prepare('SELECT value FROM settings WHERE key = @key'),
  setSetting: db.prepare(`
    INSERT OR REPLACE INTO settings (key, value, updated_at)
    VALUES (@key, @value, datetime('now'))
  `),
  insertRuntime: db.prepare(`
    INSERT OR IGNORE INTO runtime_data (row_hash, device, date, plant, shift, runtime_hrs, runtime_pct)
    VALUES (@row_hash, @device, @date, @plant, @shift, @runtime_hrs, @runtime_pct)
  `),
  getRuntime: db.prepare('SELECT device, date, plant, shift, runtime_hrs, runtime_pct FROM runtime_data ORDER BY device, date'),
  statsRuntime: db.prepare('SELECT COUNT(*) as n, MAX(ingested_at) as last FROM runtime_data'),
}

// ── Helpers ────────────────────────────────────────────────────────────────
function rowHash(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

// Store only a short hash of the original filename so upload paths / identifying
// strings are not persisted verbatim in ingestion_log.
function hashFileName(name: string): string {
  return createHash('sha256').update(name).digest('hex').slice(0, 12)
}

// Timing-safe string comparison to guard against timing attacks on auth.
function safeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

// ── Runtime XLSX Parser ────────────────────────────────────────────────────
// Parses Guidewheel "Trends" wide-format xlsx exports.
// Column headers: "{Day} {Mon} {D} {YYYY} - {Shift} ({Plant}) (Runtime hrs)"
//             OR: "{Day} {Mon} {D} {YYYY} - {Shift} - {Plant} (Runtime hrs)"
// Row 0 = headers, Column 0 = "Device".

export interface RuntimeDiagnostics {
  fileType: string
  sheetUsed: string
  rowsRead: number
  validRows: number
  devicesFound: string[]
  plantsFound: string[]
  shiftsFound: string[]
  dateMin: string
  dateMax: string
  skippedReasons: string[]
}

const MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

function parseRuntimeHeader(header: string): { date: string; shift: string; plant: string; metric: 'pct' | 'hrs' | 'min' } | null {
  // Remove metric suffix: "(Runtime %)", "(Runtime hrs)", "(Runtime min)"
  const metricMatch = header.match(/\(Runtime\s+(hrs|%|min)\)\s*$/i)
  if (!metricMatch) return null
  const metricRaw = metricMatch[1].toLowerCase()
  const metric: 'pct' | 'hrs' | 'min' = metricRaw === 'hrs' ? 'hrs' : metricRaw === '%' ? 'pct' : 'min'

  // Strip the metric suffix (find " (Runtime" and take everything before)
  const idx = header.lastIndexOf(' (Runtime')
  if (idx < 0) return null
  const withoutMetric = header.slice(0, idx).trim()

  // Match date prefix: "Thu Jan 1 2026 - ..."
  const dateMatch = withoutMetric.match(
    /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d+)\s+(\d{4})\s+-\s+(.+)$/i
  )
  if (!dateMatch) return null
  const [, month, day, year, shiftPlant] = dateMatch
  const mm = MONTH_MAP[month.toLowerCase()]
  if (!mm) return null
  const date = `${year}-${mm}-${day.padStart(2, '0')}`

  // Pattern 1: "1st Shift (Addison)" — plant in trailing parens
  const parenPlant = shiftPlant.match(/^(.+?)\s+\((Addison|Mayflower|Sparks)\)\s*$/i)
  if (parenPlant) {
    return { date, shift: parenPlant[1].trim(), plant: parenPlant[2], metric }
  }
  // Pattern 2: "24 hrs shift - Sparks" — plant after last " - "
  const dashPlant = shiftPlant.match(/^(.+?)\s+-\s+(Addison|Mayflower|Sparks)\s*$/i)
  if (dashPlant) {
    return { date, shift: dashPlant[1].trim(), plant: dashPlant[2], metric }
  }
  return null
}

function normalizeShift(raw: string): string {
  const l = raw.toLowerCase()
  if (l.includes('1st') || l.includes('first')) return '1st Shift'
  if (l.includes('2nd') || l.includes('second')) return '2nd Shift'
  if (l.includes('3rd') || l.includes('third')) return '3rd Shift'
  if (l.includes('24')) return '24hr'
  return raw
}

function parseRuntimeXLSX(buffer: Buffer): { records: RuntimeRecord[]; diagnostics: RuntimeDiagnostics } {
  if (!XLSX) throw new Error('xlsx package not available — ensure xlsx is installed')

  const wb = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')

  // Parse column headers (row 0)
  type ColMeta = { col: number; date: string; shift: string; plant: string; metric: 'pct' | 'hrs' | 'min' }
  const columnMeta: (ColMeta | null)[] = []
  for (let c = 0; c <= range.e.c; c++) {
    if (c === 0) { columnMeta.push(null); continue }
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c })]
    if (!cell?.v) { columnMeta.push(null); continue }
    const parsed = parseRuntimeHeader(String(cell.v))
    columnMeta.push(parsed ? { col: c, ...parsed } : null)
  }

  // Only hrs columns are stored (most useful for energy normalisation)
  const hrsCols = columnMeta.filter((m): m is ColMeta => m !== null && m.metric === 'hrs')
  // Build a pct lookup: date|shift|plant → colIndex
  const pctLookup = new Map<string, number>()
  for (const m of columnMeta) {
    if (m && m.metric === 'pct') pctLookup.set(`${m.date}|${m.shift}|${m.plant}`, m.col)
  }

  const SKIP_DEVICES = new Set(['Total', 'Sum', 'total', 'sum', ''])
  const records: RuntimeRecord[] = []
  const skippedReasons: string[] = []
  let skippedDevice = 0

  const PLANT_MAP: Record<string, string> = { '1': 'Addison', '2': 'Mayflower', '3': 'Sparks' }

  for (let r = 1; r <= range.e.r; r++) {
    const devCell = ws[XLSX.utils.encode_cell({ r, c: 0 })]
    if (!devCell?.v) continue
    const device = String(devCell.v).trim()
    if (SKIP_DEVICES.has(device)) { skippedDevice++; continue }

    const devicePlant = PLANT_MAP[device.charAt(0)] ?? null
    if (!devicePlant) { skippedDevice++; continue }

    for (const cm of hrsCols) {
      // Only include columns that match this device's plant
      if (cm.plant.toLowerCase() !== devicePlant.toLowerCase()) continue
      const cell = ws[XLSX.utils.encode_cell({ r, c: cm.col })]
      if (!cell || cell.v === '' || cell.v === undefined || cell.v === null) continue
      const hrs = typeof cell.v === 'number' ? cell.v : parseFloat(String(cell.v))
      if (isNaN(hrs) || hrs < 0) continue

      let pct = 0
      const pctCol = pctLookup.get(`${cm.date}|${cm.shift}|${cm.plant}`)
      if (pctCol !== undefined) {
        const pctCell = ws[XLSX.utils.encode_cell({ r, c: pctCol })]
        if (pctCell && typeof pctCell.v === 'number') pct = pctCell.v
      }

      records.push({
        device,
        date: cm.date,
        plant: devicePlant,
        shift: normalizeShift(cm.shift),
        runtimeHrs: hrs,
        runtimePct: pct,
      })
    }
  }

  if (skippedDevice > 0) skippedReasons.push(`${skippedDevice} summary/unknown device rows skipped`)

  const devices = Array.from(new Set(records.map(r => r.device))).sort()
  const plants = Array.from(new Set(records.map(r => r.plant))).sort()
  const shifts = Array.from(new Set(records.map(r => r.shift))).sort()
  const dates = Array.from(new Set(records.map(r => r.date))).sort()

  return {
    records,
    diagnostics: {
      fileType: 'xlsx',
      sheetUsed: sheetName,
      rowsRead: range.e.r,
      validRows: records.length,
      devicesFound: devices,
      plantsFound: plants,
      shiftsFound: shifts,
      dateMin: dates[0] ?? '',
      dateMax: dates[dates.length - 1] ?? '',
      skippedReasons,
    },
  }
}

function ingestRuntime(buffer: Buffer, fileName: string) {
  const { records, diagnostics } = parseRuntimeXLSX(buffer)
  let rowsAdded = 0
  let duplicatesSkipped = 0

  db.transaction(() => {
    for (const r of records) {
      const hash = rowHash(`${r.device}|${r.date}|${r.shift}|${r.plant}`)
      const result = stmts.insertRuntime.run({
        row_hash: hash,
        device: r.device,
        date: r.date,
        plant: r.plant,
        shift: r.shift,
        runtime_hrs: r.runtimeHrs,
        runtime_pct: r.runtimePct,
      })
      result.changes > 0 ? rowsAdded++ : duplicatesSkipped++
    }
  })()

  stmts.logIngestion.run({
    file_name: hashFileName(fileName),
    table_name: 'runtime_data',
    rows_added: rowsAdded,
    duplicates_skipped: duplicatesSkipped,
    rows_updated: 0,
    rows_unchanged: duplicatesSkipped,
  })
  return { rowsAdded, duplicatesSkipped, total: records.length, diagnostics }
}

// ── Energy Session Store ───────────────────────────────────────────────────
// Opaque tokens issued by POST /api/auth/energy; validated by requireEnergyAuth.
// In-memory; tokens survive process lifetime (12 h expiry matches client sessionStorage).
const energySessions = new Map<string, number>() // token → expiry ms

// ── Ingestion ──────────────────────────────────────────────────────────────
// UPSERT KEY: sha256(start_dt ISO | device). Guidewheel issue exports carry no
// stable issue/event ID column, so the dedupe identity is the device plus the
// event start timestamp (an issue can't start twice on one device at the same
// instant). End time, duration, tags, status, comments and the derived
// changeover classification are all MUTABLE and refresh on re-upload — so when a
// tag is corrected in Guidewheel (e.g. 2K2-01 changeover → No Product/No Labor),
// re-uploading updates the existing row instead of skipping it as a duplicate.
function ingestIssues(csvText: string, fileName: string) {
  // ALL valid rows (not just changeovers) so a row that LOST its changeover tag
  // still reaches the upsert and gets reclassified out of the Changeover views.
  const rows = parseIssueRows(csvText)
  const src = hashFileName(fileName)

  let inserted = 0, updated = 0, unchanged = 0
  let changeoversAdded = 0, changeoversRemoved = 0

  db.transaction(() => {
    for (const e of rows) {
      const hash = rowHash(`${e.start_dt.toISOString()}|${e.device}`)
      const params = {
        row_hash: hash,
        start_dt: e.start_dt.toISOString(),
        end_dt: e.end_dt.toISOString(),
        duration: e.duration,
        device: e.device,
        plant: e.plant,
        changeover_type: e.changeover_type,
        status: e.status,
        calendar_date: e.calendar_date,
        week_start: e.week_start,
        tags: e.tags,
        comments: e.comments,
        is_changeover: e.is_changeover ? 1 : 0,
        changeover_match_tag: e.changeover_match_tag ?? null,
        source_file: src,
      }
      const existing = stmts.selectIssue.get({ row_hash: hash }) as Record<string, unknown> | undefined
      if (!existing) {
        stmts.insertIssue.run(params)
        inserted++
        if (e.is_changeover) changeoversAdded++
      } else {
        const wasChangeover = existing.is_changeover === 1
        // Re-upload updates only if a mutable field actually changed; otherwise
        // it is a true unchanged duplicate and is skipped.
        const changed =
          existing.end_dt !== params.end_dt ||
          existing.duration !== params.duration ||
          existing.plant !== params.plant ||
          (existing.changeover_type ?? '') !== params.changeover_type ||
          (existing.status ?? '') !== params.status ||
          existing.calendar_date !== params.calendar_date ||
          existing.week_start !== params.week_start ||
          (existing.tags ?? '') !== params.tags ||
          (existing.comments ?? '') !== params.comments ||
          (wasChangeover ? 1 : 0) !== params.is_changeover ||
          (existing.changeover_match_tag ?? null) !== params.changeover_match_tag
        if (changed) {
          stmts.updateIssue.run(params)
          updated++
          if (!wasChangeover && e.is_changeover) changeoversAdded++
          if (wasChangeover && !e.is_changeover) changeoversRemoved++
        } else {
          unchanged++
        }
      }
    }
  })()

  stmts.logIngestion.run({
    file_name: src, table_name: 'issues',
    rows_added: inserted, duplicates_skipped: unchanged,
    rows_updated: updated, rows_unchanged: unchanged,
  })

  // Upsert the same rows into downtime_events (full set; classification-agnostic).
  const downtimeResult = ingestDowntime(rows, fileName)

  // Audit summary (tags / plants / machines / date coverage) merged with the
  // insert/update/unchanged + reclassification counts from the upsert above.
  const summary = summarizeIssues(csvText)
  const issuesDiagnostics = { ...summary, inserted, updated, unchanged, changeoversAdded, changeoversRemoved }

  return {
    rowsAdded: inserted, rowsUpdated: updated, rowsUnchanged: unchanged, duplicatesSkipped: unchanged,
    changeoversAdded, changeoversRemoved, total: rows.length,
    downtime: downtimeResult, issuesDiagnostics,
  }
}

// Upsert pre-parsed rows into downtime_events using the same stable key.
function ingestDowntime(rows: ParsedIssueRow[], fileName: string) {
  const src = hashFileName(fileName)
  let inserted = 0, updated = 0, unchanged = 0

  db.transaction(() => {
    for (const e of rows) {
      const hash = rowHash(`${e.start_dt.toISOString()}|${e.device}`)
      const params = {
        row_hash: hash,
        start_dt: e.start_dt.toISOString(),
        end_dt: e.end_dt.toISOString(),
        duration: e.duration,
        device: e.device,
        plant: e.plant,
        status: e.status,
        calendar_date: e.calendar_date,
        week_start: e.week_start,
        shift: e.shift,
        tags: e.tags,
        is_tagged: e.is_tagged ? 1 : 0,
        is_planned: e.is_planned ? 1 : 0,
        comments: e.comments,
        source_file: src,
      }
      const existing = stmts.selectDowntime.get({ row_hash: hash }) as Record<string, unknown> | undefined
      if (!existing) {
        stmts.insertDowntime.run(params)
        inserted++
      } else {
        const changed =
          existing.end_dt !== params.end_dt ||
          existing.duration !== params.duration ||
          existing.plant !== params.plant ||
          (existing.status ?? '') !== params.status ||
          existing.calendar_date !== params.calendar_date ||
          existing.week_start !== params.week_start ||
          existing.shift !== params.shift ||
          (existing.tags ?? '') !== params.tags ||
          (existing.is_tagged === 1 ? 1 : 0) !== params.is_tagged ||
          (existing.is_planned === 1 ? 1 : 0) !== params.is_planned ||
          (existing.comments ?? '') !== params.comments
        if (changed) {
          stmts.updateDowntime.run(params)
          updated++
        } else {
          unchanged++
        }
      }
    }
  })()

  stmts.logIngestion.run({
    file_name: src, table_name: 'downtime_events',
    rows_added: inserted, duplicates_skipped: unchanged,
    rows_updated: updated, rows_unchanged: unchanged,
  })
  return { rowsAdded: inserted, rowsUpdated: updated, rowsUnchanged: unchanged, duplicatesSkipped: unchanged, total: rows.length }
}

function ingestOEE(csvText: string, fileName: string) {
  const { records, diagnostics } = parseOEECSV(csvText)
  let rowsAdded = 0
  let duplicatesSkipped = 0

  db.transaction(() => {
    for (const rec of records) {
      const hash = rec.session_key
        ? rowHash(rec.session_key)
        : rowHash(`${rec.machine}|${rec.date}`)
      const r = stmts.insertOEE.run({
        row_hash: hash,
        machine: rec.machine,
        date: rec.date,
        oee: rec.oee,
        availability: rec.availability,
        performance: rec.performance,
        quality: rec.quality,
      })
      r.changes > 0 ? rowsAdded++ : duplicatesSkipped++
    }
  })()

  stmts.logIngestion.run({
    file_name: hashFileName(fileName),
    table_name: 'oee_data',
    rows_added: rowsAdded,
    duplicates_skipped: duplicatesSkipped,
    rows_updated: 0,
    rows_unchanged: duplicatesSkipped,
  })
  return { rowsAdded, duplicatesSkipped, total: records.length, diagnostics }
}

function ingestEnergy(
  csvText: string,
  fileName: string,
  table: 'energy_average' | 'energy_max'
) {
  const rows = parseEnergyCSV(csvText)
  let rowsAdded = 0
  let duplicatesSkipped = 0
  const stmt = table === 'energy_average' ? stmts.insertEnergyAvg : stmts.insertEnergyMax

  db.transaction(() => {
    for (const r of rows) {
      const hash = rowHash(`${r.machine}|${r.date}`)
      const result = stmt.run({ row_hash: hash, machine: r.machine, date: r.date, kwh: r.kWh })
      result.changes > 0 ? rowsAdded++ : duplicatesSkipped++
    }
  })()

  stmts.logIngestion.run({
    file_name: hashFileName(fileName),
    table_name: table,
    rows_added: rowsAdded,
    duplicates_skipped: duplicatesSkipped,
    rows_updated: 0,
    rows_unchanged: duplicatesSkipped,
  })
  return { rowsAdded, duplicatesSkipped, total: rows.length }
}

// ── Startup Backfill ───────────────────────────────────────────────────────
const SEED_FILES = [
  { rel: 'Issues_All_Devices_2025-10-01_2026-02-13.csv', type: 'issues' as const },
  { rel: 'Issues_All_Devices_2026-01-18_2026-02-17.csv', type: 'issues' as const },
  { rel: 'Issues_All_Devices_2026-04-06_2026-04-24.csv', type: 'issues' as const },
  { rel: 'public/data/issues.sample.csv', type: 'issues' as const },
  { rel: 'public/data/energy_average.csv', type: 'energy_average' as const },
  { rel: 'public/data/energy_max.csv', type: 'energy_max' as const },
]

function runBackfill() {
  console.log('[backfill] ingesting seed files...')
  for (const src of SEED_FILES) {
    const fullPath = join(__dirname, src.rel)
    if (!existsSync(fullPath)) {
      console.log(`[backfill]   skip (not found): ${src.rel}`)
      continue
    }
    try {
      const text = readFileSync(fullPath, 'utf-8')
      const result =
        src.type === 'issues'
          ? ingestIssues(text, basename(src.rel))
          : ingestEnergy(text, basename(src.rel), src.type)
      console.log(
        `[backfill]   ${basename(src.rel)}: +${result.rowsAdded} added, ${result.duplicatesSkipped} skipped`
      )
    } catch (err) {
      console.error(`[backfill]   ERROR on ${src.rel}:`, err)
    }

  }
  console.log('[backfill] done.')
}

runBackfill()

// ── Downtime Backfill ──────────────────────────────────────────────────────
// Populate downtime_events from historical issues rows so Tagging & Downtime
// shows the same history as the Changeover tab without requiring a re-upload.
// Uses INSERT OR IGNORE so it is safe to run on every startup.
// shift is derived from start_dt hour (UTC, consistent with live ingestion path).
// is_tagged is stored as 0 but gets re-derived by isEffectivelyTaggedServer on read.
function runDowntimeBackfill() {
  const result = db.prepare(`
    INSERT OR IGNORE INTO downtime_events
      (row_hash, start_dt, end_dt, duration, device, plant, status,
       calendar_date, week_start, shift, tags, is_tagged, is_planned, comments)
    SELECT
      row_hash, start_dt, end_dt, duration, device, plant, status,
      calendar_date, week_start,
      CASE
        WHEN CAST(strftime('%H', start_dt) AS INTEGER) >= 6
         AND CAST(strftime('%H', start_dt) AS INTEGER) < 14 THEN '1st Shift'
        WHEN CAST(strftime('%H', start_dt) AS INTEGER) >= 14
         AND CAST(strftime('%H', start_dt) AS INTEGER) < 22 THEN '2nd Shift'
        ELSE '3rd Shift'
      END,
      tags,
      0,
      CASE WHEN LOWER(COALESCE(tags, '')) LIKE '%planned%' THEN 1 ELSE 0 END,
      comments
    FROM issues
  `).run()
  if (result.changes > 0) {
    console.log(`[downtime-backfill] migrated ${result.changes} rows from issues → downtime_events`)
  }
}

runDowntimeBackfill()

// ── Changeover Reclassification Backfill ─────────────────────────────────────
// Re-derive is_changeover / changeover_match_tag for EVERY row in the issues
// table from its raw tags, using the centralized classifier. This corrects rows
// that were ingested under older/looser logic (e.g. the 2K2-01 6h15m
// "No Product / No Labor" event) so they are excluded from all changeover views.
//
// Non-destructive: raw rows are preserved (tags, comments, durations) and the
// full downtime history remains in downtime_events. We only flip a flag.
function runChangeoverReclassify() {
  const rows = db.prepare('SELECT row_hash, tags, calendar_date FROM issues').all() as
    { row_hash: string; tags: string | null; calendar_date: string }[]
  if (rows.length === 0) return

  const update = db.prepare('UPDATE issues SET is_changeover = @flag, changeover_match_tag = @tag WHERE row_hash = @hash')

  let changeover = 0
  let excluded = 0
  const excludedTagCounts = new Map<string, number>()
  let dateMin = ''
  let dateMax = ''

  db.transaction(() => {
    for (const row of rows) {
      const c = classifyChangeover(row.tags || '')
      update.run({ flag: c.isChangeover ? 1 : 0, tag: c.matchedTag ?? null, hash: row.row_hash })
      if (c.isChangeover) {
        changeover++
      } else {
        excluded++
        for (const t of (row.tags || '').split(/[,;|\n\r]+/).map(s => s.trim()).filter(Boolean)) {
          excludedTagCounts.set(t, (excludedTagCounts.get(t) ?? 0) + 1)
        }
      }
      if (row.calendar_date) {
        if (!dateMin || row.calendar_date < dateMin) dateMin = row.calendar_date
        if (!dateMax || row.calendar_date > dateMax) dateMax = row.calendar_date
      }
    }
  })()

  const topExcluded = Array.from(excludedTagCounts.entries())
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([tag, n]) => `${tag} (${n})`)

  console.log('[changeover-reclassify] ───────────────────────────────────────')
  console.log(`[changeover-reclassify] total issues rows:        ${rows.length}`)
  console.log(`[changeover-reclassify] classified as changeover: ${changeover}`)
  console.log(`[changeover-reclassify] excluded (non-changeover): ${excluded}`)
  console.log(`[changeover-reclassify] date range:               ${dateMin || '—'} to ${dateMax || '—'}`)
  console.log(`[changeover-reclassify] top excluded tags:        ${topExcluded.join(', ') || '(none)'}`)
  console.log('[changeover-reclassify] ───────────────────────────────────────')
}

runChangeoverReclassify()

// ── Energy Date Normalization Backfill ───────────────────────────────────────
// Existing energy rows may hold dates as slash strings ("2026/06/18 08:18") or
// stray Excel time fractions ("0.2633…"). Normalize every date to YYYY-MM-DD and
// delete rows whose date cannot be interpreted as a real calendar date so the UI
// never shows a decimal "date". Runs every startup; idempotent.
function runEnergyDateBackfill() {
  for (const table of ['energy_average', 'energy_max'] as const) {
    const rows = db.prepare(`SELECT row_hash, date FROM ${table}`).all() as { row_hash: string; date: string }[]
    if (rows.length === 0) continue
    const update = db.prepare(`UPDATE ${table} SET date = @date WHERE row_hash = @hash`)
    const del = db.prepare(`DELETE FROM ${table} WHERE row_hash = @hash`)
    let fixed = 0
    let removed = 0
    db.transaction(() => {
      for (const row of rows) {
        const norm = normalizeDateOnly(row.date)
        if (!norm) { del.run({ hash: row.row_hash }); removed++; continue }
        if (norm !== row.date) { update.run({ date: norm, hash: row.row_hash }); fixed++ }
      }
    })()
    if (fixed > 0 || removed > 0) {
      console.log(`[energy-date-backfill] ${table}: ${fixed} dates normalized, ${removed} invalid rows removed`)
    }
  }
}

runEnergyDateBackfill()

// ── Energy Pollution Cleanup ─────────────────────────────────────────────────
// A prior bug routed semicolon-delimited Issues exports into the energy tables,
// where each issue row was misread as machine=<start timestamp>, date=<end
// timestamp>, kwh=<duration>. Those rows have a "machine" that is really a
// timestamp — it contains a slash, colon, or whitespace, which a real machine id
// (e.g. "2C5-01") never does. Delete ONLY those polluted rows; legitimate energy
// data is untouched. Idempotent; safe to run every startup.
function runEnergyPollutionCleanup() {
  for (const table of ['energy_average', 'energy_max'] as const) {
    const res = db.prepare(
      `DELETE FROM ${table} WHERE machine LIKE '%/%' OR machine LIKE '%:%' OR machine LIKE '% %'`
    ).run()
    if (res.changes > 0) {
      console.log(`[energy-pollution-cleanup] ${table}: removed ${res.changes} non-energy (Issues-misclassified) rows`)
    }
  }
}

runEnergyPollutionCleanup()

// ── Express App ────────────────────────────────────────────────────────────
const app = express()

// Trust Railway's reverse proxy so rate limiting uses the real client IP.
app.set('trust proxy', 1)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB — handles large xlsx runtime files
})
app.use(compression())
app.use(express.json())

// ── Auth Middleware ────────────────────────────────────────────────────────
// Validates Basic auth on all /api/* routes.
// Token = btoa('admin:' + password) set by AuthGate after successful client-side login.
// Server compares the password portion against VITE_PASSWORD (never sent to client).
function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const expectedPassword = process.env.VITE_PASSWORD
  if (!expectedPassword) {
    res.status(500).json({ error: 'Server authentication is not configured.' })
    return
  }
  const header = req.headers.authorization
  if (!header?.startsWith('Basic ')) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  let decoded: string
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8')
  } catch {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  // Format is "user:password" — take everything after the first colon.
  const colonIdx = decoded.indexOf(':')
  const password = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : decoded
  if (!safeCompare(password, expectedPassword)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  next()
}

// ── Rate Limiters ──────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
})

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many uploads. Please wait a moment.' },
})

// Health check — public, required by Railway orchestration.
app.get('/health', (_req, res) => res.sendStatus(200))

// Apply rate limiting and auth to all /api routes.
app.use('/api', apiLimiter, requireAuth)

// ── Energy Auth Middleware ─────────────────────────────────────────────────
// Validates the opaque energy token issued by POST /api/auth/energy.
// Applied to all /api/data/energy/* routes in addition to requireAuth.
function requireEnergyAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers['x-energy-token'] as string | undefined
  if (!token) {
    res.status(401).json({ error: 'Executive authorization required' })
    return
  }
  const expiry = energySessions.get(token)
  if (!expiry || Date.now() > expiry) {
    energySessions.delete(token)
    res.status(401).json({ error: 'Executive session expired' })
    return
  }
  next()
}

// ── API: Energy auth ───────────────────────────────────────────────────────
// Validates the executive energy password (separate from main password).
// Returns an opaque short-lived token the client sends on energy data requests.
// Sits behind the main requireAuth middleware so the caller must be logged in first.
app.post('/api/auth/energy', (req: Request, res: Response) => {
  const expectedPassword = process.env.VITE_ENERGY_PASSWORD
  if (!expectedPassword) {
    res.status(500).json({ error: 'Energy authentication is not configured.' })
    return
  }
  const { password } = req.body as { password?: string }
  if (!password || !safeCompare(password, expectedPassword)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  const token = randomBytes(32).toString('hex')
  energySessions.set(token, Date.now() + 12 * 60 * 60 * 1000)
  res.json({ ok: true, token })
})

// ── API: Status ─────────────────────────────────────────────────────────────
app.get('/api/status', (_req, res) => {
  const issues = stmts.statsIssues.get() as { n: number; last: string | null }
  const avg = stmts.statsEnergyAvg.get() as { n: number; last: string | null }
  const max = stmts.statsEnergyMax.get() as { n: number; last: string | null }
  const downtime = stmts.statsDowntime.get() as { n: number; last: string | null }
  const oee = stmts.statsOEE.get() as { n: number; last: string | null }
  res.json({
    issues: { count: issues.n, lastUpdated: issues.last },
    energy_average: { count: avg.n, lastUpdated: avg.last },
    energy_max: { count: max.n, lastUpdated: max.last },
    downtime_events: { count: downtime.n, lastUpdated: downtime.last },
    oee_data: { count: oee.n, lastUpdated: oee.last },
  })
})

// ── API: Admin Diagnostics ───────────────────────────────────────────────────
// Returns record counts and date ranges for all tables. Useful for debugging
// empty-tab issues after deployment/restart without needing DB access.
app.get('/api/admin/diagnostics', (_req, res) => {
  const issueStat = stmts.statsIssues.get() as { n: number; last: string | null }
  const avgStat = stmts.statsEnergyAvg.get() as { n: number; last: string | null }
  const maxStat = stmts.statsEnergyMax.get() as { n: number; last: string | null }
  const downtimeStat = stmts.statsDowntime.get() as { n: number; last: string | null }
  const oeeStat = stmts.statsOEE.get() as { n: number; last: string | null }
  const runtimeStat = stmts.statsRuntime.get() as { n: number; last: string | null }

  const issueDates = db.prepare('SELECT MIN(calendar_date) as min, MAX(calendar_date) as max FROM issues WHERE is_changeover = 1').get() as { min: string | null; max: string | null }
  const avgDates = db.prepare('SELECT MIN(date) as min, MAX(date) as max FROM energy_average').get() as { min: string | null; max: string | null }
  const downtimeDates = db.prepare('SELECT MIN(calendar_date) as min, MAX(calendar_date) as max FROM downtime_events').get() as { min: string | null; max: string | null }
  const oeeDates = db.prepare('SELECT MIN(date) as min, MAX(date) as max FROM oee_data').get() as { min: string | null; max: string | null }
  const runtimeDates = db.prepare('SELECT MIN(date) as min, MAX(date) as max FROM runtime_data').get() as { min: string | null; max: string | null }

  res.json({
    dbPath: process.env.NODE_ENV !== 'production' ? DB_PATH : '(hidden in production)',
    activeEnergySessions: energySessions.size,
    tables: {
      issues: { count: issueStat.n, lastIngested: issueStat.last, dateMin: issueDates.min, dateMax: issueDates.max },
      energy_average: { count: avgStat.n, lastIngested: avgStat.last, dateMin: avgDates.min, dateMax: avgDates.max },
      energy_max: { count: maxStat.n, lastIngested: maxStat.last },
      downtime_events: { count: downtimeStat.n, lastIngested: downtimeStat.last, dateMin: downtimeDates.min, dateMax: downtimeDates.max },
      oee_data: { count: oeeStat.n, lastIngested: oeeStat.last, dateMin: oeeDates.min, dateMax: oeeDates.max },
      runtime_data: { count: runtimeStat.n, lastIngested: runtimeStat.last, dateMin: runtimeDates.min, dateMax: runtimeDates.max },
    },
  })
})

// ── API: Energy Assumptions (persisted rates + idle threshold) ───────────────
const ENERGY_ASSUMPTIONS_KEY = 'energy_assumptions'
const DEFAULT_ENERGY_ASSUMPTIONS = { rates: { Sparks: 0.09, Addison: 0.10, Mayflower: 0.08 }, idleThreshold: 50 }

app.get('/api/settings/energy', (_req, res) => {
  const row = stmts.getSetting.get({ key: ENERGY_ASSUMPTIONS_KEY }) as { value: string } | undefined
  if (!row) { res.json(DEFAULT_ENERGY_ASSUMPTIONS); return }
  try {
    res.json(JSON.parse(row.value))
  } catch {
    res.json(DEFAULT_ENERGY_ASSUMPTIONS)
  }
})

app.post('/api/settings/energy', (req: Request, res: Response) => {
  const { rates, idleThreshold } = req.body as { rates?: Record<string, number>; idleThreshold?: number }
  if (!rates || typeof idleThreshold !== 'number' || idleThreshold < 1) {
    res.status(400).json({ error: 'Invalid energy assumptions payload.' }); return
  }
  for (const plant of ['Sparks', 'Addison', 'Mayflower']) {
    const v = rates[plant]
    if (typeof v !== 'number' || v < 0 || v > 10) {
      res.status(400).json({ error: `Invalid rate for ${plant}.` }); return
    }
  }
  stmts.setSetting.run({ key: ENERGY_ASSUMPTIONS_KEY, value: JSON.stringify({ rates, idleThreshold }) })
  res.json({ ok: true })
})

// ── API: Get Issues ─────────────────────────────────────────────────────────
app.get('/api/data/issues', (_req, res) => {
  const rows = stmts.getIssues.all() as any[]
  const events = rows.map(r => ({
    id: r.row_hash,
    start_dt: new Date(r.start_dt),
    end_dt: new Date(r.end_dt),
    duration: r.duration,
    device: r.device,
    plant: r.plant,
    changeover_type: r.changeover_type || 'Color Change',
    status: r.status || '',
    calendar_date: r.calendar_date,
    week_start: r.week_start,
    tags: r.tags || '',
    comments: r.comments || '',
    // Audit: which raw tag qualified this row as a changeover. Re-derived on read
    // so it is always consistent with the centralized classifier.
    changeover_match_tag: r.changeover_match_tag || classifyChangeover(r.tags || '').matchedTag || '',
  })) satisfies (ColorChangeEvent & { id: string })[]
  const stat = stmts.statsIssues.get() as { n: number; last: string | null }
  res.json({ events, total: events.length, lastUpdated: stat.last })
})

// ── API: Get Energy ─────────────────────────────────────────────────────────
app.get('/api/data/energy/average', requireEnergyAuth, (_req, res) => {
  const rows = stmts.getEnergyAvg.all() as any[]
  const result: EnergyRow[] = rows.map(r => ({ machine: r.machine, date: r.date, kWh: r.kwh }))
  const stat = stmts.statsEnergyAvg.get() as { n: number; last: string | null }
  res.json({ rows: result, total: result.length, lastUpdated: stat.last })
})

// Non-gated energy endpoint for Energy vs Uptime tab (kWh only, no cost data).
// Requires main auth but NOT executive energy auth — the tab shows efficiency
// metrics (kWh/runtime hour) which contain no pricing or cost information.
app.get('/api/data/energy/usage', (_req, res) => {
  const rows = stmts.getEnergyAvg.all() as any[]
  const result: EnergyRow[] = rows.map(r => ({ machine: r.machine, date: r.date, kWh: r.kwh }))
  const stat = stmts.statsEnergyAvg.get() as { n: number; last: string | null }
  res.json({ rows: result, total: result.length, lastUpdated: stat.last })
})

// Re-derive is_tagged from the tags string so existing rows with "No Tag" etc.
// are corrected without requiring a DB migration.
const UNTAGGED_SERVER = new Set([
  'no tag', 'no tags', 'not tagged', 'untagged', 'n/a', 'none', '-', 'undefined', 'null', '',
])
function isEffectivelyTaggedServer(tags: string): boolean {
  const trimmed = (tags || '').trim()
  if (!trimmed) return false
  const parts = trimmed.toLowerCase().split(/[,;|]+/).map(t => t.trim())
  return parts.some(t => t.length > 0 && !UNTAGGED_SERVER.has(t))
}

// ── API: Get Downtime Events ─────────────────────────────────────────────────
app.get('/api/data/downtime', (_req, res) => {
  const rows = stmts.getDowntime.all() as any[]
  const events = rows.map(r => {
    const tags = r.tags || ''
    return {
      start_dt: r.start_dt,
      end_dt: r.end_dt,
      duration: r.duration,
      device: r.device,
      plant: r.plant,
      status: r.status || '',
      calendar_date: r.calendar_date,
      week_start: r.week_start,
      shift: r.shift,
      tags,
      is_tagged: isEffectivelyTaggedServer(tags),
      is_planned: tags.toLowerCase().includes('planned'),
      comments: r.comments || '',
    }
  })
  const stat = stmts.statsDowntime.get() as { n: number; last: string | null }
  res.json({ events, total: events.length, lastUpdated: stat.last })
})

// ── API: Get OEE Data ────────────────────────────────────────────────────────
app.get('/api/data/oee', (_req, res) => {
  const rows = stmts.getOEE.all() as any[]
  const records = rows.map(r => ({
    machine: r.machine,
    date: r.date,
    oee: r.oee,
    availability: r.availability,
    performance: r.performance,
    quality: r.quality,
  }))
  const stat = stmts.statsOEE.get() as { n: number; last: string | null }
  res.json({ records, total: records.length, lastUpdated: stat.last })
})

// ── API: Get Runtime Data ────────────────────────────────────────────────────
app.get('/api/data/runtime', (_req, res) => {
  const rows = stmts.getRuntime.all() as any[]
  const records: RuntimeRecord[] = rows.map(r => ({
    device: r.device,
    date: r.date,
    plant: r.plant,
    shift: r.shift,
    runtimeHrs: r.runtime_hrs,
    runtimePct: r.runtime_pct ?? 0,
  }))
  const stat = stmts.statsRuntime.get() as { n: number; last: string | null }
  res.json({ records, total: records.length, lastUpdated: stat.last })
})

// ── API: Ingestion Log ───────────────────────────────────────────────────────
// Returns ingestion history for the Data Management tab. Hashed filenames are
// shown as-is (they are sha256 prefixes, not original names — clients that sent
// the upload get the original name back in the upload response).
app.get('/api/data/ingestion-log', (_req, res) => {
  const rows = db.prepare(
    'SELECT id, file_name, table_name, rows_added, duplicates_skipped, rows_updated, rows_unchanged, ingested_at FROM ingestion_log ORDER BY ingested_at DESC LIMIT 200'
  ).all() as { id: number; file_name: string; table_name: string; rows_added: number; duplicates_skipped: number; rows_updated: number; rows_unchanged: number; ingested_at: string }[]
  // Also return dataset date ranges for the inventory section
  const ranges = {
    issues: db.prepare('SELECT MIN(calendar_date) as min, MAX(calendar_date) as max, COUNT(*) as n FROM issues WHERE is_changeover = 1').get() as { min: string | null; max: string | null; n: number },
    energy_average: db.prepare('SELECT MIN(date) as min, MAX(date) as max, COUNT(*) as n FROM energy_average').get() as { min: string | null; max: string | null; n: number },
    downtime_events: db.prepare('SELECT MIN(calendar_date) as min, MAX(calendar_date) as max, COUNT(*) as n FROM downtime_events').get() as { min: string | null; max: string | null; n: number },
    oee_data: db.prepare('SELECT MIN(date) as min, MAX(date) as max, COUNT(*) as n FROM oee_data').get() as { min: string | null; max: string | null; n: number },
    runtime_data: db.prepare('SELECT MIN(date) as min, MAX(date) as max, COUNT(*) as n FROM runtime_data').get() as { min: string | null; max: string | null; n: number },
  }
  res.json({ log: rows, ranges })
})

// ── API: Upload ─────────────────────────────────────────────────────────────
app.post('/api/upload', uploadLimiter, upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' })
    return
  }

  const fileName = req.file.originalname
  const lowerName = fileName.toLowerCase()
  const typeHint = (req.body?.type as string | undefined) || ''

  // Detect Excel files by magic bytes (ZIP PK signature) or extension
  const isExcel = (
    (req.file.buffer[0] === 0x50 && req.file.buffer[1] === 0x4B &&
     req.file.buffer[2] === 0x03 && req.file.buffer[3] === 0x04) ||
    lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')
  )

  // ── Excel branch ──
  if (isExcel) {
    if (!XLSX) {
      res.status(500).json({ error: 'Excel upload is not available (xlsx package not installed on server). Please convert to CSV.' })
      return
    }
    try {
      // Determine Excel type — "runtime" (Guidewheel Trends) or "energy" (rare)
      // Peek at cell A1 to detect content type
      const wb = XLSX.read(req.file.buffer, { type: 'buffer', sheetRows: 2 })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const a1 = ws['A1']?.v ? String(ws['A1'].v).toLowerCase() : ''
      const b1 = ws['B1']?.v ? String(ws['B1'].v).toLowerCase() : ''

      let excelType: string
      if (a1 === 'device' && (b1.includes('runtime') || b1.includes('shift'))) {
        excelType = 'runtime'
      } else if (a1.includes('machine') || a1.includes('energy')) {
        excelType = 'energy_average'
      } else {
        excelType = typeHint || 'runtime' // default xlsx to runtime
      }

      if (excelType === 'runtime') {
        const { diagnostics: runtimeDiagnostics, ...rest } = ingestRuntime(req.file.buffer, fileName)
        res.json({ ...rest, runtimeDiagnostics, type: 'runtime', fileName, fileType: 'xlsx', sheetUsed: wb.SheetNames[0] })
        return
      }
      // Future: handle energy xlsx if needed
      res.status(400).json({ error: 'Excel file detected but content type not recognized. Expected a Guidewheel Trends runtime export.' })
    } catch (err: unknown) {
      console.error('[upload] Excel ingestion error:', err)
      res.status(500).json({ error: 'Excel upload failed. Check that the file is a valid Guidewheel Trends export.' })
    }
    return
  }

  // ── CSV branch ──
  const csvText = req.file.buffer.toString('utf-8')

  // Header-authoritative routing. Guidewheel Issues AND Energy exports are BOTH
  // semicolon-delimited, so we must inspect column HEADERS — not the delimiter —
  // to tell them apart. (Previously a semicolon-count heuristic misrouted Issues
  // files to Energy.) typeHint allows a manual reprocess override.
  const normalizedHint = typeHint === 'energy' ? 'energy_average' : typeHint
  const detection = detectCsvDataset(csvText, fileName, normalizedHint)
  const type = detection.type

  try {
    let result: Record<string, unknown>
    if (type === 'oee') {
      result = ingestOEE(csvText, fileName)
    } else if (type === 'issues') {
      result = ingestIssues(csvText, fileName)
    } else {
      result = ingestEnergy(csvText, fileName, type)
    }

    // Attach routing diagnostics so the user can see WHY a dataset was chosen.
    result = { ...result, routing: detection }

    // Always attach the live date range so the UI reflects the ACTUAL latest
    // loaded record (not upload metadata or filenames) — fixes "stuck through
    // May 22" reporting after a successful upload.
    if (type === 'energy_average' || type === 'energy_max') {
      const tbl = type === 'energy_average' ? 'energy_average' : 'energy_max'
      const dates = db.prepare(`SELECT MIN(date) as min, MAX(date) as max FROM ${tbl}`).get() as { min: string | null; max: string | null }
      result = { ...result, dataMin: dates.min, dataMax: dates.max }
    } else if (type === 'issues') {
      const dates = db.prepare('SELECT MIN(calendar_date) as min, MAX(calendar_date) as max FROM issues WHERE is_changeover = 1').get() as { min: string | null; max: string | null }
      result = { ...result, dataMin: dates.min, dataMax: dates.max }
    }

    res.json({ ...result, type, fileName, fileType: 'csv' })
  } catch (err: unknown) {
    console.error('[upload] ingestion error:', err)
    res.status(500).json({ error: 'Upload failed. Please check the file format and try again.' })
  }
})

// ── Static Files (production) ───────────────────────────────────────────────
const distPath = join(__dirname, 'dist')
if (existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get('*', (_req, res) => {
    res.sendFile(join(distPath, 'index.html'))
  })
}

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] listening on port ${PORT}`)
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[server] database: ${DB_PATH}`)
  }
  if (!process.env.VITE_PASSWORD) {
    console.warn('[server] WARNING: VITE_PASSWORD is not set — all /api requests will return 500')
  }
})
