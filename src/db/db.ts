import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let dbInstance: Database.Database | null = null;

function applySchema(db: Database.Database) {
  const schemaPath = path.resolve(__dirname, 'schema.sql');
  if (!fs.existsSync(schemaPath)) return;

  const tableCheck = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
    .get() as { name: string } | undefined;
  if (tableCheck) return;

  console.log('[DB] 正在应用 schema.sql 初始化数据库结构...');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
  console.log('[DB] 数据库结构初始化完成');
}

function runMigrations(db: Database.Database) {
  // migrations 目录相对于仓库根。__dirname 在 src/db 下，所以上溯两级。
  // 在 Electron 打包后 extraResources 会把 migrations 复制到 resources/migrations。
  const candidates = [
    path.resolve(__dirname, '..', '..', 'migrations'),
    process.env.APP_RESOURCES_DIR ? path.join(process.env.APP_RESOURCES_DIR, 'migrations') : '',
  ].filter(Boolean);

  const migrationsDir = candidates.find((p) => p && fs.existsSync(p));
  if (!migrationsDir) {
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER DEFAULT (unixepoch() * 1000)
    )
  `);

  const appliedRows = db.prepare('SELECT name FROM _migrations').all() as { name: string }[];
  const applied = new Set(appliedRows.map((row) => row.name));

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    try {
      db.exec('BEGIN');
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
      db.exec('COMMIT');
      count++;
      console.log(`[DB] 迁移已应用: ${file}`);
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* no-op */ }
      // 非致命：某些早期迁移可能已经被 schema.sql 覆盖
      console.warn(`[DB] 迁移失败（跳过）: ${file}:`, (err as Error).message);
    }
  }

  if (count > 0) {
    console.log(`[DB] 共应用 ${count} 个迁移`);
  }
}

export function getDb(): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  const defaultDataDir = path.join(process.env.HOME || '~', '.novel-copilot');
  const appDataDir = process.env.APP_DATA_DIR || defaultDataDir;

  if (!fs.existsSync(appDataDir)) {
    fs.mkdirSync(appDataDir, { recursive: true });
  }

  const dbPath = path.join(appDataDir, 'novel-copilot.db');
  console.log(`[DB] 初始化本地 SQLite 数据库: ${dbPath}`);

  dbInstance = new Database(dbPath);

  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('synchronous = NORMAL');
  dbInstance.pragma('foreign_keys = ON');
  dbInstance.pragma('busy_timeout = 5000');

  try {
    applySchema(dbInstance);
  } catch (err) {
    console.error('[DB] 初始化 Schema 失败:', err);
  }

  try {
    runMigrations(dbInstance);
  } catch (err) {
    console.error('[DB] 运行迁移失败:', err);
  }

  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) {
    console.log('[DB] 正在关闭数据库连接...');
    dbInstance.close();
    dbInstance = null;
  }
}
