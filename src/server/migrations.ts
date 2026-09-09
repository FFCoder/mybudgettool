import { SQL } from "bun";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export class MigrationError extends Error {}
export type MigrationFile = {
  name: string;
  version: number;
  checksum: string;
  sql: string;
};
const defaultDirectory = fileURLToPath(
  new URL("../../migrations", import.meta.url),
);

export async function loadMigrationFiles(
  directory: string,
): Promise<MigrationFile[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    throw new MigrationError("Cannot read the migration directory.");
  }
  const migrations: MigrationFile[] = [];
  for (const name of names.filter((name) => name.endsWith(".sql"))) {
    const match = /^(\d{3,})_[a-zA-Z0-9_-]+\.sql$/.exec(name);
    if (
      !match ||
      Number(match[1]) < 1 ||
      !Number.isSafeInteger(Number(match[1]))
    )
      throw new MigrationError(
        "Migration filenames must start with a positive, at least three-digit version followed by an underscore.",
      );
    let contents: string;
    try {
      contents = await Bun.file(join(directory, name)).text();
    } catch {
      throw new MigrationError("Cannot read a migration file.");
    }
    if (!contents.trim())
      throw new MigrationError(`Migration ${name} is empty.`);
    migrations.push({
      name,
      version: Number(match[1]),
      checksum: createHash("sha256").update(contents).digest("hex"),
      sql: contents,
    });
  }
  migrations.sort((a, b) => a.version - b.version);
  if (!migrations.length)
    throw new MigrationError("No numbered SQL migrations were found.");
  if (new Set(migrations.map((m) => m.version)).size !== migrations.length)
    throw new MigrationError("Migration version numbers must be unique.");
  return migrations;
}

/** Apply all pending files atomically. An advisory lock serializes competing runners. */
export async function migrate(
  databaseUrl: string,
  directory = defaultDirectory,
): Promise<{ applied: string[] }> {
  const files = await loadMigrationFiles(directory);
  let sql: SQL | undefined;
  try {
    sql = new SQL(databaseUrl);
    return await sql.begin(async (tx) => {
      // Stable application-specific transaction lock, including ledger initialization.
      await tx`SELECT pg_advisory_xact_lock(1836679783, 1)`;
      await tx`CREATE TABLE IF NOT EXISTS budget_schema_migrations (
        version bigint PRIMARY KEY,
        name text NOT NULL UNIQUE,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`;
      const previous =
        await tx`SELECT version, name, checksum FROM budget_schema_migrations ORDER BY version`;
      const appliedVersions = new Set<number>();
      for (const row of previous) {
        const version = Number(row.version);
        const file = files.find((file) => file.version === version);
        if (!file || file.name !== row.name)
          throw new MigrationError(
            "An applied migration is missing or renamed. Restore the original migration files before upgrading.",
          );
        if (file.checksum !== row.checksum)
          throw new MigrationError(
            `Applied migration ${file.name} has changed. Restore it and add a new numbered migration instead.`,
          );
        appliedVersions.add(version);
      }
      const lastVersion = Math.max(0, ...appliedVersions);
      const pending = files.filter(
        (file) => !appliedVersions.has(file.version),
      );
      if (pending.some((file) => file.version < lastVersion))
        throw new MigrationError(
          "A pending migration precedes an applied version. Add changes in a new higher-numbered migration.",
        );
      const applied: string[] = [];
      for (const file of pending) {
        try {
          await tx.unsafe(file.sql);
        } catch {
          throw new MigrationError(
            `Migration ${file.name} failed. No pending migrations were committed. Check database access and migration SQL.`,
          );
        }
        await tx`INSERT INTO budget_schema_migrations (version, name, checksum) VALUES (${file.version}, ${file.name}, ${file.checksum})`;
        applied.push(file.name);
      }
      return { applied };
    });
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    throw new MigrationError(
      "Database migration failed. Check database availability and permissions.",
    );
  } finally {
    try {
      await sql?.close();
    } catch {
      /* Do not expose driver errors during cleanup. */
    }
  }
}
