import { SQL } from "bun";
import { AppError, command, state, type Budget } from "../shared/domain";
export interface Store {
  read(month?: string): Promise<unknown>;
  execute(
    operation: unknown,
    input: unknown,
    key: string,
    fingerprint: string,
  ): Promise<unknown>;
}
export function postgresStore(url: string): Store & { close(): Promise<void> } {
  const sql = new SQL(url);
  return {
    async read(month) {
      const rows = await sql`SELECT document FROM budget_state WHERE id=1`;
      if (!rows[0]) throw new Error("Run migrations first");
      return state(rows[0].document as Budget, month);
    },
    async execute(operation, input, key, fingerprint) {
      return sql.begin(async (tx) => {
        const rows =
          await tx`SELECT document FROM budget_state WHERE id=1 FOR UPDATE`;
        if (!rows[0]) throw new Error("Run migrations first");
        const receipts =
          await tx`SELECT fingerprint,response FROM command_receipts WHERE key=${key}`;
        if (receipts[0]) {
          if (receipts[0].fingerprint !== fingerprint)
            throw new AppError(
              "idempotency_conflict",
              "Idempotency key was already used for a different command",
              409,
            );
          return receipts[0].response;
        }
        const b = rows[0].document as Budget;
        const response = { result: command(b, operation, input) };
        await tx`UPDATE budget_state SET document=${b},updated_at=now() WHERE id=1`;
        await tx`INSERT INTO command_receipts (key,fingerprint,response) VALUES (${key},${fingerprint},${response})`;
        return response;
      });
    },
    async close() {
      await sql.close();
    },
  };
}
