import { DatabaseSync } from 'node:sqlite';
import type { MailStore, StoredDocument } from './store.js';
export function sqliteStore(filename: string): MailStore {
  const db = new DatabaseSync(filename);
  db.exec(
    'PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS documents (tenant TEXT NOT NULL,key TEXT NOT NULL,revision TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(tenant,key))',
  );
  const read = (t: string, k: string) => {
    const r = db.prepare('SELECT * FROM documents WHERE tenant=? AND key=?').get(t, k);
    return r
      ? { key: String(r.key), revision: String(r.revision), value: JSON.parse(String(r.value)) }
      : null;
  };
  return {
    async read(t, k) {
      return read(t, k);
    },
    async page(t, p, c = '', limit = 100) {
      const rows = db
        .prepare(
          'SELECT * FROM documents WHERE tenant=? AND key>=? AND key<? AND key>? ORDER BY key LIMIT ?',
        )
        .all(t, p, p + '\uffff', c, limit + 1);
      const items = rows.slice(0, limit).map((r) => ({
        key: String(r.key),
        revision: String(r.revision),
        value: JSON.parse(String(r.value)),
      })) as StoredDocument[];
      return { items, ...(rows.length > limit ? { cursor: items.at(-1)!.key } : {}) };
    },
    async commit(t, checks, writes) {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (
          checks.some(
            (c) =>
              read(t, c.key)?.revision !== c.revision &&
              !(c.revision === null && read(t, c.key) === null),
          )
        ) {
          db.exec('ROLLBACK');
          return false;
        }
        for (const w of writes)
          db.prepare(
            'INSERT INTO documents VALUES (?,?,?,?) ON CONFLICT(tenant,key) DO UPDATE SET revision=excluded.revision,value=excluded.value',
          ).run(t, w.key, w.revision, JSON.stringify(w.value));
        db.exec('COMMIT');
        return true;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    async close() {
      db.close();
    },
  };
}
