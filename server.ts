import express, { type Request, type Response, type NextFunction } from 'express'
import Database from 'better-sqlite3'
import multer from 'multer'
import { createHash, timingSafeEqual, randomBytes } from 'node:crypto'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import rateLimit from 'express-rate-limit'
import compression from 'compression'
import { parseCSV, parseEnergyCSV } from './src/data/parser'
import type { ColorChangeEvent, EnergyRow } from './src/data/types'

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
`)

// ── Schema Migrations ──────────────────────────────────────────────────────
try {
  db.exec("ALTER TABLE issues ADD COLUMN changeover_type TEXT NOT NULL DEFAULT 'Color Change'")
} catch { /* column already exists */ }

// ── Prepared Statements ────────────────────────────────────────────────────
const stmts = {
  insertIssue: db.prepare(`
    INSERT OR IGNORE INTO issues
      (row_hash, start_dt, end_dt, duration, device, plant, changeover_type, status,
       calendar_date, week_start, tags, comments)
    VALUES
      (@row_hash, @start_dt, @end_dt, @duration, @device, @plant, @changeover_type, @status,
       @calendar_date, @week_start, @tags, @comments)
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
    INSERT INTO ingestion_log (file_name, table_name, rows_added, duplicates_skipped)
    VALUES (@file_name, @table_name, @rows_added, @duplicates_skipped)
  `),
  getIssues: db.prepare('SELECT * FROM issues ORDER BY calendar_date, device'),
  getEnergyAvg: db.prepare('SELECT machine, date, kwh FROM energy_average ORDER BY machine, date'),
  statsIssues: db.prepare('SELECT COUNT(*) as n, MAX(ingested_at) as last FROM issues'),
  statsEnergyAvg: db.prepare('SELECT COUNT(*) as n, MAX(ingested_at) as last FROM energy_average'),
  statsEnergyMax: db.prepare('SELECT COUNT(*) as n, MAX(ingested_at) as last FROM energy_max'),
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

// ── Energy Session Store ───────────────────────────────────────────────────
// Opaque tokens issued by POST /api/auth/energy; validated by requireEnergyAuth.
// In-memory; tokens survive process lifetime (12 h expiry matches client sessionStorage).
const energySessions = new Map<string, number>() // token → expiry ms

// ── Ingestion ──────────────────────────────────────────────────────────────
function ingestIssues(csvText: string, fileName: string) {
  const events = parseCSV(csvText)
  let rowsAdded = 0
  let duplicatesSkipped = 0

  db.transaction(() => {
    for (const e of events) {
      const hash = rowHash(`${e.start_dt.toISOString()}|${e.device}`)
      const r = stmts.insertIssue.run({
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
      })
      r.changes > 0 ? rowsAdded++ : duplicatesSkipped++
    }
  })()

  stmts.logIngestion.run({
    file_name: hashFileName(fileName),
    table_name: 'issues',
    rows_added: rowsAdded,
    duplicates_skipped: duplicatesSkipped,
  })
  return { rowsAdded, duplicatesSkipped, total: events.length }
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

// ── Express App ────────────────────────────────────────────────────────────
const app = express()

// Trust Railway's reverse proxy so rate limiting uses the real client IP.
app.set('trust proxy', 1)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB — realistic CSV ceiling
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
  res.json({
    issues: { count: issues.n, lastUpdated: issues.last },
    energy_average: { count: avg.n, lastUpdated: avg.last },
    energy_max: { count: max.n, lastUpdated: max.last },
  })
})

// ── API: Get Issues ─────────────────────────────────────────────────────────
app.get('/api/data/issues', (_req, res) => {
  const rows = stmts.getIssues.all() as any[]
  const events: ColorChangeEvent[] = rows.map(r => ({
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
  }))
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

// ── API: Upload ─────────────────────────────────────────────────────────────
app.post('/api/upload', uploadLimiter, upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' })
    return
  }

  const csvText = req.file.buffer.toString('utf-8')
  const fileName = req.file.originalname
  const typeHint = (req.body?.type as string | undefined) || ''

  const cleanFirst = csvText.replace(/^﻿/, '').split('\n')[0].toLowerCase()
  let type: 'issues' | 'energy_average' | 'energy_max'

  if (typeHint === 'energy_max' || fileName.toLowerCase().includes('max')) {
    type = 'energy_max'
  } else if (
    typeHint === 'energy_average' ||
    typeHint === 'energy' ||
    cleanFirst.includes('energy kwh') ||
    fileName.toLowerCase().includes('average') ||
    fileName.toLowerCase().includes('energy')
  ) {
    type = 'energy_average'
  } else {
    type = 'issues'
  }

  try {
    const result =
      type === 'issues'
        ? ingestIssues(csvText, fileName)
        : ingestEnergy(csvText, fileName, type)
    res.json({ ...result, type, fileName })
  } catch (err: unknown) {
    // Log full error server-side; return generic message to client.
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
