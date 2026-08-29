// Dependency-free migration runner: plain .mjs, executed with bare `node`,
// using only `pg` (a runtime dependency of packages/backend, not a
// devDependency like tsx). This exists specifically so it can run as a
// Railway preDeployCommand without depending on whether the platform prunes
// devDependencies before the runtime phase -- see SPEC.md task 10.
//
// Applies every *.sql file in supabase/migrations/, in filename order,
// against DATABASE_URL. Every migration in this repo is written to be
// idempotent (create table/index if not exists, create or replace view,
// create extension if not exists), so re-running the full set on every
// deploy is safe and deliberate: it guarantees schema is up to date without
// a separate migration-tracking table.

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
// packages/backend/scripts/migrate.mjs -> repo root -> supabase/migrations
const migrationsDir = path.resolve(scriptDir, "../../../supabase/migrations");

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("migrate: DATABASE_URL is not set, refusing to run.");
    process.exit(1);
  }

  const entries = await readdir(migrationsDir);
  const sqlFiles = entries.filter((f) => f.endsWith(".sql")).sort();

  if (sqlFiles.length === 0) {
    console.log(`migrate: no .sql files found in ${migrationsDir}, nothing to do.`);
    return;
  }

  const pool = new Pool({ connectionString });

  try {
    for (const file of sqlFiles) {
      const fullPath = path.join(migrationsDir, file);
      const sql = await readFile(fullPath, "utf8");
      console.log(`migrate: applying ${file}...`);

      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(sql);
        await client.query("commit");
        console.log(`migrate: ${file} applied.`);
      } catch (err) {
        await client.query("rollback");
        throw new Error(`migrate: ${file} failed: ${err.message}`);
      } finally {
        client.release();
      }
    }
    console.log(`migrate: done, ${sqlFiles.length} migration file(s) applied.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
