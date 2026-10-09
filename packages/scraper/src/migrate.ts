import { readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';
import { env, REPO_ROOT } from './env.ts';

const MIGRATIONS_DIR = `${REPO_ROOT}supabase/migrations/`;

function dbUrl(): string {
  const e = env();
  if (e.SUPABASE_DB_URL) return e.SUPABASE_DB_URL;
  if (!e.SUPABASE_DB_PASSWORD) throw new Error('Set SUPABASE_DB_URL or SUPABASE_DB_PASSWORD');
  const ref = new URL(e.SUPABASE_URL).hostname.split('.')[0];
  return `postgresql://postgres:${encodeURIComponent(e.SUPABASE_DB_PASSWORD)}@db.${ref}.supabase.co:5432/postgres`;
}

/**
 * Applies supabase/migrations/*.sql in order, recording them in the same table the
 * Supabase CLI uses, so `supabase db push` stays compatible later.
 */
export async function migrate({ dryRun = false } = {}): Promise<void> {
  const client = new pg.Client({ connectionString: dbUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(`
      create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations (
        version text primary key, statements text[], name text
      );`);
    const { rows } = await client.query<{ version: string }>(
      'select version from supabase_migrations.schema_migrations',
    );
    const applied = new Set(rows.map((r) => r.version));
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d+_.+\.sql$/.test(f))
      .sort();
    for (const file of files) {
      const [version, ...rest] = file.replace(/\.sql$/, '').split('_');
      if (!version || applied.has(version)) continue;
      const sql = readFileSync(MIGRATIONS_DIR + file, 'utf8');
      console.log(`${dryRun ? '[dry-run] would apply' : 'applying'} ${file}`);
      if (dryRun) continue;
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query(
          'insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)',
          [version, [sql], rest.join('_')],
        );
        await client.query('commit');
      } catch (err) {
        await client.query('rollback');
        throw err;
      }
    }
    console.log('migrations up to date');
  } finally {
    await client.end();
  }
}
