import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { withTransaction, lockKey } from './db.js';
export async function migrate(pool: Pool): Promise<void> {
  const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
  const files = (await readdir(directory)).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  await withTransaction(pool, async client => {
    await lockKey(client, 'consta-schema-migrations');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())');
    for (const name of files) {
      const exists = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name]);
      if (exists.rowCount) continue;
      await client.query(await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
    }
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatória.');
  const pool = new Pool({connectionString: process.env.DATABASE_URL});
  try { await migrate(pool); console.info('Migrações aplicadas.'); } finally { await pool.end(); }
}
