import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { loadMigrationFiles, migrate } from "../src/server/migrations";

test("migration discovery orders numerically, hashes exact content and rejects duplicate versions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "budget-migration-files-"));
  try {
    await Bun.write(join(directory, "010_later.sql"), "SELECT 10;");
    await Bun.write(join(directory, "002_first.sql"), "SELECT 2;");
    const files = await loadMigrationFiles(directory);
    expect(files.map((f) => f.version)).toEqual([2, 10]);
    expect(files[0]!.checksum).toHaveLength(64);
    await Bun.write(join(directory, "002_first.sql"), "SELECT 2;\n");
    expect((await loadMigrationFiles(directory))[0]!.checksum).not.toBe(
      files[0]!.checksum,
    );
    await Bun.write(join(directory, "002_duplicate.sql"), "SELECT 2;");
    await expect(loadMigrationFiles(directory)).rejects.toThrow("unique");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("migration discovery rejects absent, empty and malformed migrations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "budget-migration-invalid-"));
  try {
    await expect(loadMigrationFiles(directory)).rejects.toThrow("No numbered");
    await Bun.write(join(directory, "001_empty.sql"), "  ");
    await expect(loadMigrationFiles(directory)).rejects.toThrow("empty");
    await rm(join(directory, "001_empty.sql"));
    await Bun.write(join(directory, "init.sql"), "SELECT 1;");
    await expect(loadMigrationFiles(directory)).rejects.toThrow("filenames");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// Explicit opt-in, dedicated disposable database only. Refuses any existing public
// tables so this suite cannot overwrite application or another suite's records.
const integration = process.env.MIGRATION_TEST_DATABASE_URL ? test : test.skip;
integration(
  "Postgres migrations transition legacy schema, serialize runners, detect changes and roll back failures",
  async () => {
    const url = process.env.MIGRATION_TEST_DATABASE_URL!;
    const sql = new SQL(url);
    const directory = await mkdtemp(join(tmpdir(), "budget-migration-pg-"));
    let ownsTables = false;
    try {
      const tables =
        await sql`SELECT tablename FROM pg_tables WHERE schemaname='public'`;
      if (tables.length)
        throw new Error(
          "MIGRATION_TEST_DATABASE_URL must reference an empty disposable database.",
        );
      ownsTables = true;
      const initial = await Bun.file(
        new URL("../migrations/001_initial.sql", import.meta.url),
      ).text();
      await Bun.write(join(directory, "001_initial.sql"), initial);
      // Simulate the pre-ledger installation without changing its saved document.
      await sql.begin(async (tx) => {
        await tx.unsafe(initial);
      });
      const original = (
        await sql`SELECT document FROM budget_state WHERE id=1`
      )[0].document;
      const races = await Promise.all([
        migrate(url, directory),
        migrate(url, directory),
      ]);
      expect(races.map((r) => r.applied.length).sort()).toEqual([0, 1]);
      expect(
        (await sql`SELECT document FROM budget_state WHERE id=1`)[0].document,
      ).toEqual(original);
      expect((await migrate(url, directory)).applied).toEqual([]);
      await Bun.write(
        join(directory, "001_initial.sql"),
        initial + "\n-- changed",
      );
      await expect(migrate(url, directory)).rejects.toThrow("has changed");
      await Bun.write(join(directory, "001_initial.sql"), initial);
      await Bun.write(
        join(directory, "002_probe.sql"),
        "CREATE TABLE migration_probe (id integer);",
      );
      await Bun.write(join(directory, "003_broken.sql"), "THIS IS NOT SQL;");
      await expect(migrate(url, directory)).rejects.toThrow(
        "No pending migrations were committed",
      );
      expect(
        (await sql`SELECT to_regclass('public.migration_probe') AS name`)[0]
          .name,
      ).toBeNull();
      expect(
        (await sql`SELECT version FROM budget_schema_migrations`).length,
      ).toBe(1);
      await rm(join(directory, "003_broken.sql"));
      expect((await migrate(url, directory)).applied).toEqual([
        "002_probe.sql",
      ]);
      await rm(join(directory, "001_initial.sql"));
      await expect(migrate(url, directory)).rejects.toThrow(
        "missing or renamed",
      );
    } finally {
      if (ownsTables)
        await sql.unsafe(
          "DROP TABLE IF EXISTS migration_probe, budget_schema_migrations, command_receipts, budget_state",
        );
      await sql.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  30000,
);
