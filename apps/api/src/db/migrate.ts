import type { Database } from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Roll-forward-only migrations: *.sql files applied in filename order, each in
// its own transaction, recorded in `migrations`. No down-migrations — every
// table except fetch_cache is rebuildable, so "undo" is reshape + re-run.
export function migrate(db: Database, dir: string): string[] {
  db.exec(
    `CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT`,
  );

  const applied = new Set(
    (db.prepare("SELECT name FROM migrations").all() as { name: string }[]).map(
      (row) => row.name,
    ),
  );

  const pending = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .filter((file) => !applied.has(file));

  const record = db.prepare(
    "INSERT INTO migrations (name, applied_at) VALUES (?, ?)",
  );
  for (const file of pending) {
    const sql = readFileSync(path.join(dir, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
      record.run(file, new Date().toISOString());
    })();
  }
  return pending;
}
