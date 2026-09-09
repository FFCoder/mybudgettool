import { migrate } from "../src/server/migrations";

try {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required.");
  const result = await migrate(url);
  console.log(
    result.applied.length
      ? `Database migrations complete: ${result.applied.join(", ")}`
      : "Database migrations are already current.",
  );
} catch (error) {
  // The migration runner deliberately replaces driver errors, URLs and SQL details.
  console.error(
    error instanceof Error ? error.message : "Database migration failed.",
  );
  process.exitCode = 1;
}
