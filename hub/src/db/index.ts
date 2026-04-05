import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config/index.js';
import { createLogger } from '../system/logger.js';

const log = createLogger('db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return _db;
}

export function initDb(): Database.Database {
  const dbPath = config.db.path;
  const dbDir = path.dirname(dbPath);

  // Ensure data directory exists
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    log.info({ dbDir }, 'Created database directory');
  }

  _db = new Database(dbPath, {
    // Verbose logging in dev
    verbose: config.server.isDev ? (msg) => log.trace({ sql: msg }, 'SQL') : undefined,
  });

  // Performance pragmas - safe for local SQLite use
  _db.pragma('journal_mode = WAL');
  _db.pragma('synchronous = NORMAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('cache_size = -16000'); // 16MB cache
  _db.pragma('temp_store = MEMORY');

  log.info({ path: dbPath }, 'Database connected');

  runMigrations(_db);

  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
    log.info('Database connection closed');
  }
}

// ─── Schema Migrations ────────────────────────────────────────────────────────

const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
      -- Rooms within a property
      CREATE TABLE IF NOT EXISTS rooms (
        id          TEXT    PRIMARY KEY,
        name        TEXT    NOT NULL,
        property_id TEXT    NOT NULL DEFAULT 'default-property',
        created_at  INTEGER NOT NULL DEFAULT (unixepoch())
      );

      -- Registered devices (ESP nodes)
      CREATE TABLE IF NOT EXISTS devices (
        id          TEXT    PRIMARY KEY,
        room_id     TEXT    REFERENCES rooms(id) ON DELETE SET NULL,
        type        TEXT    NOT NULL DEFAULT 'relay',   -- relay | ir | sensor
        name        TEXT,
        ip_address  TEXT,
        firmware_version TEXT,
        created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
      );

      -- Latest state per device (upserted on every change)
      CREATE TABLE IF NOT EXISTS states (
        device_id  TEXT    PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
        channel    INTEGER NOT NULL DEFAULT 0,          -- relay channel (0-3)
        state      TEXT    NOT NULL DEFAULT 'OFF',      -- ON | OFF
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      -- Device heartbeat / online tracking
      CREATE TABLE IF NOT EXISTS heartbeats (
        device_id   TEXT    PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
        last_seen   INTEGER NOT NULL DEFAULT (unixepoch()),
        online      INTEGER NOT NULL DEFAULT 1          -- 0 | 1
      );

      -- Full event history (append-only audit log)
      CREATE TABLE IF NOT EXISTS events (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        type      TEXT    NOT NULL,
        device_id TEXT,
        room_id   TEXT,
        payload   TEXT    NOT NULL DEFAULT '{}',        -- JSON
        timestamp INTEGER NOT NULL DEFAULT (unixepoch())
      );

      -- Scheduled automations
      CREATE TABLE IF NOT EXISTS schedules (
        id          TEXT    PRIMARY KEY,
        name        TEXT    NOT NULL,
        device_id   TEXT    REFERENCES devices(id) ON DELETE CASCADE,
        room_id     TEXT    REFERENCES rooms(id) ON DELETE CASCADE,
        action      TEXT    NOT NULL,                   -- JSON: {state: 'ON'|'OFF'}
        run_at      INTEGER NOT NULL,                   -- Unix epoch
        repeat_cron TEXT,                               -- optional cron expression
        enabled     INTEGER NOT NULL DEFAULT 1,
        last_run_at INTEGER,
        created_at  INTEGER NOT NULL DEFAULT (unixepoch())
      );

      -- Users (Google OAuth)
      CREATE TABLE IF NOT EXISTS users (
        id         TEXT    PRIMARY KEY,                 -- Google sub
        email      TEXT    NOT NULL UNIQUE,
        name       TEXT,
        picture    TEXT,
        role       TEXT    NOT NULL DEFAULT 'viewer',   -- admin | operator | viewer
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        last_login INTEGER
      );

      -- Guests (PMS integration)
      CREATE TABLE IF NOT EXISTS guests (
        id           TEXT    PRIMARY KEY,
        name         TEXT,
        room_id      TEXT    REFERENCES rooms(id) ON DELETE SET NULL,
        checkin_time INTEGER NOT NULL,
        checkout_time INTEGER,
        active       INTEGER NOT NULL DEFAULT 1,
        created_at   INTEGER NOT NULL DEFAULT (unixepoch())
      );

      -- Automations (trigger → action rules)
      CREATE TABLE IF NOT EXISTS automations (
        id         TEXT    PRIMARY KEY,
        name       TEXT    NOT NULL,
        trigger    TEXT    NOT NULL,                    -- JSON: trigger definition
        actions    TEXT    NOT NULL,                    -- JSON: array of actions
        enabled    INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      -- Idempotency keys to deduplicate events
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        key        TEXT    PRIMARY KEY,                 -- deviceId:timestamp
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      -- ── Indexes ───────────────────────────────────────────────────────────────
      CREATE INDEX IF NOT EXISTS idx_devices_room_id    ON devices(room_id);
      CREATE INDEX IF NOT EXISTS idx_events_type        ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_device_id   ON events(device_id);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp   ON events(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_schedules_run_at   ON schedules(run_at) WHERE enabled = 1;
      CREATE INDEX IF NOT EXISTS idx_guests_room_active ON guests(room_id, active);
      CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys(created_at);
    `,
  },
];

function runMigrations(db: Database.Database): void {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  const getApplied = db.prepare<[], { version: number }>(
    'SELECT version FROM _migrations ORDER BY version ASC'
  );
  const appliedVersions = new Set(getApplied.all().map((r) => r.version));

  const insertMigration = db.prepare(
    'INSERT INTO _migrations (version, name) VALUES (?, ?)'
  );

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) {
      log.debug({ version: migration.version, name: migration.name }, 'Migration already applied');
      continue;
    }

    log.info({ version: migration.version, name: migration.name }, 'Applying migration');

    const apply = db.transaction(() => {
      db.exec(migration.sql);
      insertMigration.run(migration.version, migration.name);
    });

    apply();

    log.info({ version: migration.version }, 'Migration applied successfully');
  }

  log.info('All migrations up to date');
}

// ─── Typed Query Helpers ──────────────────────────────────────────────────────

export type DbDevice = {
  id: string;
  room_id: string | null;
  type: string;
  name: string | null;
  ip_address: string | null;
  firmware_version: string | null;
  created_at: number;
  updated_at: number;
};

export type DbState = {
  device_id: string;
  channel: number;
  state: 'ON' | 'OFF';
  updated_at: number;
};

export type DbRoom = {
  id: string;
  name: string;
  property_id: string;
  created_at: number;
};

export type DbEvent = {
  id: number;
  type: string;
  device_id: string | null;
  room_id: string | null;
  payload: string;
  timestamp: number;
};

export type DbSchedule = {
  id: string;
  name: string;
  device_id: string | null;
  room_id: string | null;
  action: string;
  run_at: number;
  repeat_cron: string | null;
  enabled: number;
  last_run_at: number | null;
  created_at: number;
};

export type DbUser = {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  role: 'admin' | 'operator' | 'viewer';
  created_at: number;
  last_login: number | null;
};

export type DbGuest = {
  id: string;
  name: string | null;
  room_id: string | null;
  checkin_time: number;
  checkout_time: number | null;
  active: number;
  created_at: number;
};

export type DbHeartbeat = {
  device_id: string;
  last_seen: number;
  online: number;
};
