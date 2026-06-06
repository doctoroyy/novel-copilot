/**
 * Database bridge — connects to the same SQLite used by the Electron app.
 * Re-exports the existing getDb() from the engine.
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  const defaultDataDir = path.join(process.env.HOME || '~', '.novel-copilot');
  const appDataDir = process.env.APP_DATA_DIR || defaultDataDir;

  if (!fs.existsSync(appDataDir)) {
    fs.mkdirSync(appDataDir, { recursive: true });
  }

  const dbPath = path.join(appDataDir, 'data.db');
  dbInstance = new Database(dbPath);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');

  return dbInstance;
}

export type DbInstance = Database.Database;
