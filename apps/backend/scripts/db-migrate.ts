import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

/**
 * Applies every `.sql` file in `supabase/migrations/`, in ascending
 * filename order, directly against Postgres.
 *
 * Why this connects via `postgres` (raw wire-protocol) instead of
 * `@supabase/supabase-js`: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
 * authenticate PostgREST, a REST API scoped to specific tables/views/RPC
 * functions. There is no generic "run arbitrary SQL" endpoint exposed over
 * that API — Supabase deliberately doesn't expose one, and nothing in our
 * own schema defines an `exec_sql`-style RPC to call instead (defining one
 * would itself require running SQL first). So DDL migration files can only
 * be executed with a direct Postgres connection, which is what
 * `SUPABASE_DB_URL` below provides.
 *
 * Applied migrations are tracked in `public._migrations`, so re-running
 * this script is safe — already-applied files are skipped. That table is
 * separate from the Supabase CLI's own `supabase_migrations.schema_migrations`
 * (used by `bun run db:push`). Don't mix the two tools against the same
 * database: whichever one you use to apply a migration won't update the
 * other's tracking table, so the other tool won't know it was already run.
 */

function requireDatabaseUrl(): string {
  const databaseUrl = Bun.env.SUPABASE_DB_URL;

  if (!databaseUrl) {
    console.error(
      [
        "[db-migrate] Missing SUPABASE_DB_URL.",
        "  Add it to .env — Supabase Dashboard -> Project Settings -> Database -> Connection string (URI).",
        "  Example: SUPABASE_DB_URL=postgresql://postgres:[password]@db.<project-ref>.supabase.co:5432/postgres",
      ].join("\n"),
    );
    process.exit(1);
  }

  return databaseUrl;
}

const MIGRATIONS_DIR = join(import.meta.dir, "..", "supabase", "migrations");

interface MigrationFile {
  filename: string;
  sql: string;
}

async function loadMigrationFiles(): Promise<MigrationFile[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  const sqlFilenames = entries
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

  const migrations: MigrationFile[] = [];
  for (const filename of sqlFilenames) {
    const sql = await readFile(join(MIGRATIONS_DIR, filename), "utf8");
    migrations.push({ filename, sql });
  }

  return migrations;
}

async function main(): Promise<void> {
  const databaseUrl = requireDatabaseUrl();
  const migrations = await loadMigrationFiles();

  if (migrations.length === 0) {
    console.log(`[db-migrate] No .sql files found in ${MIGRATIONS_DIR}.`);
    return;
  }

  console.log(`[db-migrate] Found ${migrations.length} migration file(s).`);

  const sql = postgres(databaseUrl, { max: 1, ssl: "require" });

  try {
    await sql`
      create table if not exists public._migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `;

    const appliedRows = await sql<{ filename: string }[]>`
      select filename from public._migrations
    `;
    const alreadyApplied = new Set(appliedRows.map((row) => row.filename));

    let appliedCount = 0;
    let skippedCount = 0;

    for (const migration of migrations) {
      if (alreadyApplied.has(migration.filename)) {
        console.log(`[db-migrate] skip   ${migration.filename} (already applied)`);
        skippedCount += 1;
        continue;
      }

      console.log(`[db-migrate] apply  ${migration.filename} ...`);

      await sql.begin(async (tx) => {
        await tx.unsafe(migration.sql);
        await tx`insert into public._migrations (filename) values (${migration.filename})`;
      });

      console.log(`[db-migrate] done   ${migration.filename}`);
      appliedCount += 1;
    }

    console.log(
      `[db-migrate] Success: ${appliedCount} migration(s) applied, ${skippedCount} already up to date.`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error("[db-migrate] Migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
