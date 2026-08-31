import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString =
      process.env.DATABASE_URL ??
      "postgres://triage_copilot:triage_copilot@localhost:54329/triage_copilot";
    // node-postgres defaults to max: 10, which is fine for one request at a
    // time but queues real work under any genuine concurrency (several
    // backend test files hitting the same Postgres at once in CI, or more
    // than a handful of simultaneous real users). A bit of headroom costs
    // nothing and avoids connection queuing compounding with the
    // serialization-retry loop in eventStore.ts under load.
    pool = new Pool({ connectionString, max: 20 });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
