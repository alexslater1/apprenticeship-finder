import { db, must } from './db.ts';

/** Key/value store in `source_state` (cursors, caches, seen-sets). Writes are skipped on dry runs. */
export class StateStore {
  constructor(private readonly dryRun: boolean) {}

  async get<T>(key: string): Promise<T | undefined> {
    const rows = must(
      await db().from('source_state').select('value').eq('key', key).limit(1),
      `read source_state ${key}`,
    );
    return rows[0]?.value as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    if (this.dryRun) return;
    must(
      await db().from('source_state').upsert({ key, value, updated_at: new Date().toISOString() }),
      `write source_state ${key}`,
    );
  }
}
