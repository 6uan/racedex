import SqliteDatabase from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "./migrate";

// Paths anchored to this package (not cwd) so the API, pipeline scripts, and
// the systemd unit all resolve the same file no matter where they're run from.
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const MIGRATIONS_DIR = path.join(packageRoot, "migrations");
const DB_PATH =
  process.env.DB_PATH ?? path.join(packageRoot, "data", "racedex.db");

mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new SqliteDatabase(DB_PATH);

// WAL: readers (Express, sqlite3 CLI, a future Datasette) never block the
// pipeline's writes, and vice versa. foreign_keys is off by default in SQLite
// for historical reasons — we want our REFERENCES enforced.
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export const appliedOnBoot = migrate(db, MIGRATIONS_DIR);

export function migrationCount(): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM migrations").get() as {
    n: number;
  };
  return row.n;
}
