import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');

async function migrate() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const migrationDirectory = resolve(repositoryRoot, 'db/migrations');
  const files = (await readdir(migrationDirectory)).filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file)).sort();
  for (const filename of files) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query('SELECT 1 FROM schema_migrations WHERE filename=$1', [filename]);
      if (found.rowCount === 0) {
        const sql = await readFile(resolve(migrationDirectory, filename), 'utf8');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
        console.log(`Applied migration ${filename}`);
      } else {
        await client.query('COMMIT');
        console.log(`Already applied ${filename}`);
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sql = await readFile(resolve(repositoryRoot, 'db/seed.sql'), 'utf8');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Seed data applied.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

async function main() {
  if (process.argv[2] === 'migrate') return migrate();
  if (process.argv[2] === 'seed') return seed();
  throw new Error('Usage: db-cli migrate|seed');
}

main()
  .catch((error: unknown) => {
    const dbError = error as { code?: string; name?: string };
    console.error('database_command_failed', { name: dbError?.name, code: dbError?.code });
    process.exitCode = 1;
  })
  .finally(async () => { await pool.end(); });
