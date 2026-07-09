/**
 * License service — lightweight license activation and offline grace period.
 *
 * Phase 4 commercial shell. First version: stores a license key locally,
 * validates format, and grants a grace period if offline. Does NOT upload
 * manuscript content anywhere.
 */

import { getDb } from '../db/db.js';
import { randomUUID } from 'node:crypto';

export type LicenseRecord = {
  key: string;
  tier: 'free' | 'pro' | 'studio';
  status: 'active' | 'expired' | 'revoked' | 'grace';
  activatedAt: number;
  expiresAt: number | null;
  machineId: string;
  lastCheckedAt: number;
};

const MACHINE_ID_KEY = 'license_machine_id';

function getMachineId(): string {
  const db = getDb();
  db.prepare(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)`).run();
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(MACHINE_ID_KEY) as { value: string } | undefined;
  if (row?.value) return row.value;
  const id = randomUUID();
  db.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)`).run(MACHINE_ID_KEY, id);
  return id;
}

// Validate license key format: NCP-XXXX-XXXX-XXXX-XXXX (alphanumeric)
export function isValidKeyFormat(key: string): boolean {
  return /^NCP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test((key || '').trim().toUpperCase());
}

// Determine tier from key prefix (first char after NCP-)
// F = free, P = pro, S = studio (demo: any valid key = pro)
export function tierFromKey(key: string): LicenseRecord['tier'] {
  const k = key.trim().toUpperCase();
  if (k.startsWith('NCP-S')) return 'studio';
  if (k.startsWith('NCP-F')) return 'free';
  return 'pro';
}

const GRACE_PERIOD_MS = 14 * 24 * 60 * 60 * 1000; // 14 days offline grace

export function activateLicense(key: string): LicenseRecord {
  if (!isValidKeyFormat(key)) {
    throw new Error('License key format invalid. Expected: NCP-XXXX-XXXX-XXXX-XXXX');
  }
  const db = getDb();
  db.prepare(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)`).run();

  const machineId = getMachineId();
  const now = Date.now();
  const tier = tierFromKey(key);
  const expiresAt = tier === 'free' ? null : now + 365 * 24 * 60 * 60 * 1000; // 1 year for paid

  const record: LicenseRecord = {
    key: key.trim().toUpperCase(),
    tier,
    status: 'active',
    activatedAt: now,
    expiresAt,
    machineId,
    lastCheckedAt: now,
  };

  db.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('license', ?)`)
    .run(JSON.stringify(record));
  return record;
}

export function getLicenseStatus(): LicenseRecord | null {
  try {
    const db = getDb();
    db.prepare(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)`).run();
    const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'license'`).get() as { value: string } | undefined;
    if (!row?.value) return null;

    const record = JSON.parse(row.value) as LicenseRecord;
    const now = Date.now();

    // Check expiry
    if (record.expiresAt && now > record.expiresAt) {
      record.status = 'expired';
    }

    // Grace period: if last check was > 14 days ago, mark as grace
    if (now - record.lastCheckedAt > GRACE_PERIOD_MS && record.status === 'active') {
      record.status = 'grace';
    }

    return record;
  } catch {
    return null;
  }
}

export function deactivateLicense(): void {
  try {
    const db = getDb();
    db.prepare(`DELETE FROM app_settings WHERE key = 'license'`).run();
  } catch { /* ignore */ }
}

export function touchLicenseCheck(): void {
  const record = getLicenseStatus();
  if (!record) return;
  const db = getDb();
  record.lastCheckedAt = Date.now();
  db.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('license', ?)`)
    .run(JSON.stringify(record));
}
