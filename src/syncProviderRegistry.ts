import { execFileSync } from 'node:child_process';

type Row = Record<string, unknown>;

function runWrangler(args: string[]): unknown[] {
  const raw = execFileSync('pnpm', ['exec', 'wrangler', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed.flatMap((entry) => entry.results || []) : [];
}

function remoteQuery(sql: string): Row[] {
  return runWrangler(['d1', 'execute', 'novel-copilot-db', '--remote', '--json', '--command', sql]) as Row[];
}

function localExec(sql: string): void {
  runWrangler(['d1', 'execute', 'novel-copilot-db', '--local', '--json', '--command', sql]);
}

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function insertRows(table: string, columns: string[], rows: Row[]): void {
  if (rows.length === 0) return;
  for (const row of rows) {
    const values = columns.map((column) => sqlValue(row[column])).join(', ');
    localExec(`INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${values})`);
  }
}

async function main(): Promise<void> {
  const providers = remoteQuery(`
    SELECT id, name, api_key_encrypted, base_url, protocol, config_json, created_at, updated_at,
           COALESCE(enabled, 1) AS enabled, COALESCE(display_order, 0) AS display_order
    FROM provider_registry
  `);
  const models = remoteQuery(`
    SELECT id, provider_id, model_name, display_name, credit_multiplier, capabilities,
           is_active, is_default, config_json, created_at, updated_at
    FROM model_registry
  `);
  const mappings = remoteQuery(`
    SELECT feature_key, model_id, temperature, created_at, updated_at
    FROM feature_model_mappings
  `);

  localExec('PRAGMA foreign_keys=OFF');
  insertRows('provider_registry', [
    'id', 'name', 'api_key_encrypted', 'base_url', 'protocol', 'config_json',
    'created_at', 'updated_at', 'enabled', 'display_order',
  ], providers);
  insertRows('model_registry', [
    'id', 'provider_id', 'model_name', 'display_name', 'credit_multiplier', 'capabilities',
    'is_active', 'is_default', 'config_json', 'created_at', 'updated_at',
  ], models);

  for (const mapping of mappings) {
    localExec(`
      INSERT OR IGNORE INTO credit_features (feature_key, name, description, base_cost, category)
      VALUES (${sqlValue(mapping.feature_key)}, ${sqlValue(mapping.feature_key)}, 'Synced from production model mapping', 10, 'ai')
    `);
  }
  insertRows('feature_model_mappings', [
    'feature_key', 'model_id', 'temperature', 'created_at', 'updated_at',
  ], mappings);
  localExec('PRAGMA foreign_keys=ON');

  console.log(`Synced provider registry: providers=${providers.length}, models=${models.length}, mappings=${mappings.length}`);
  console.log('API keys were copied into the local D1 registry and were not printed.');
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
