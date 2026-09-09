import { expect, test } from "bun:test";
import { SQL } from "bun";
import { postgresStore } from "../src/server/store";
import type { Paycheck, Template } from "../src/shared/domain";

// Opt-in only: TEST_DATABASE_URL must point at a disposable development/test DB.
// Fixtures and command receipts use one UUID prefix. Cleanup never clears tables
// or deletes records owned by another integration run.
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

integration(
  "Postgres persists, serializes concurrent writes, replays retries, and rolls back invalid mutations",
  async () => {
    const url = databaseUrl!;
    const fixture = `integration-${crypto.randomUUID()}`;
    const sql = new SQL(url);
    let store = postgresStore(url);
    const created: string[] = [];
    const createdTemplates: string[] = [];
    let originalDefault: number | undefined;
    let sequence = 0;
    const execute = async (
      operation: string,
      input: object,
      key = `${fixture}-${sequence++}`,
    ) => {
      const result = await store.execute(
        operation,
        input,
        key,
        JSON.stringify({ operation, input }),
      );
      return (result as { result: any }).result;
    };
    const paychecks = async () =>
      ((await store.read()) as { paychecks: Paycheck[] }).paychecks;
    try {
      const migration = await Bun.file(
        new URL("../migrations/001_initial.sql", import.meta.url),
      ).text();
      await sql.begin(async (tx) => {
        await tx.unsafe(migration);
      });
      originalDefault = (
        (await store.read()) as { settings: { defaultIncomeCents: number } }
      ).settings.defaultIncomeCents;
      await execute("settings.update", { defaultIncome: "2345.67" });
      await store.close();
      store = postgresStore(url);
      expect(
        ((await store.read()) as { settings: { defaultIncomeCents: number } })
          .settings.defaultIncomeCents,
      ).toBe(234567);
      const defaulted = await execute("paycheck.create", {
        date: "2098-02-01",
        notes: fixture,
      });
      created.push(defaulted.id);
      const zero = await execute("paycheck.create", {
        date: "2098-02-15",
        income: "0",
        notes: fixture,
      });
      created.push(zero.id);
      await execute("settings.update", { defaultIncome: "3000" });
      expect(
        (await paychecks()).find((p) => p.id === defaulted.id)?.incomeCents,
      ).toBe(234567);
      expect(
        (await paychecks()).find((p) => p.id === zero.id)?.incomeCents,
      ).toBe(0);
      const template = await execute("template.create", { name: fixture });
      createdTemplates.push(template.id);
      const recurring = await execute("item.create", {
        templateId: template.id,
        name: `${fixture}-monthly`,
        amount: "9.99",
        monthlyDueDay: 31,
      });
      await execute("item.create", {
        templateId: template.id,
        name: `${fixture}-legacy`,
        amount: "1",
        dueDate: "2098-01-10",
      });
      await store.close();
      store = postgresStore(url);
      const templates = ((await store.read()) as { templates: Template[] })
        .templates;
      expect(
        templates
          .find((t) => t.id === template.id)
          ?.items.find((i) => i.id === recurring.id)?.monthlyDueDay,
      ).toBe(31);
      const february = await execute("paycheck.create", {
        date: "2098-02-01",
        income: "100",
        templateId: template.id,
      });
      created.push(february.id);
      const leapFebruary = await execute("paycheck.create", {
        date: "2096-02-01",
        income: "100",
        templateId: template.id,
      });
      created.push(leapFebruary.id);
      expect(february.items[0].dueDate).toBe("2098-02-28");
      expect(february.items[0].monthlyDueDay).toBeNull();
      expect(leapFebruary.items[0].dueDate).toBe("2096-02-29");
      expect(february.items[1].dueDate).toBe("2098-01-10");
      await execute("item.update", { id: recurring.id, monthlyDueDay: 15 });
      await execute("item.move", {
        id: february.items[0].id,
        paycheckId: leapFebruary.id,
      });
      await store.close();
      store = postgresStore(url);
      const moved = (await paychecks())
        .find((p) => p.id === leapFebruary.id)
        ?.items.find((i) => i.id === february.items[0].id);
      expect(moved?.dueDate).toBe("2098-02-28");
      expect(
        (await paychecks()).find((p) => p.id === leapFebruary.id)?.items[0]
          ?.dueDate,
      ).toBe("2096-02-29");
      expect(
        ((await store.read()) as { templates: Template[] }).templates.find(
          (t) => t.id === template.id,
        )?.items[0]?.monthlyDueDay,
      ).toBe(15);
      const first = await execute("paycheck.create", {
        date: "2098-01-01",
        income: "100.01",
        notes: fixture,
      });
      created.push(first.id);
      const second = await execute("paycheck.create", {
        date: "2098-01-15",
        income: "200",
        notes: fixture,
      });
      created.push(second.id);
      const item = await execute("item.create", {
        paycheckId: first.id,
        name: fixture,
        amount: "12.34",
      });

      // A new connection pool reads the committed state, independently of process memory.
      await store.close();
      store = postgresStore(url);
      expect(
        (await paychecks()).find((p) => p.id === first.id)?.items[0]
          ?.amountCents,
      ).toBe(1234);

      // Different commands racing for the same parent must retain both writes.
      await Promise.all(
        Array.from({ length: 8 }, (_, n) =>
          execute("item.create", {
            paycheckId: first.id,
            name: `${fixture}-${n}`,
            amount: "0.01",
          }),
        ),
      );
      expect(
        (await paychecks()).find((p) => p.id === first.id)?.items,
      ).toHaveLength(9);

      // Identical in-flight retries must produce one committed create and one ID.
      const retryKey = `${fixture}-retry`;
      const retries = await Promise.all(
        Array.from({ length: 5 }, () =>
          execute(
            "item.create",
            {
              paycheckId: first.id,
              name: `${fixture}-retry`,
              amount: "1.23",
            },
            retryKey,
          ),
        ),
      );
      expect(new Set(retries.map((r) => r.id)).size).toBe(1);
      expect(
        (await paychecks()).find((p) => p.id === first.id)?.items,
      ).toHaveLength(10);
      await expect(
        execute(
          "item.create",
          { paycheckId: first.id, name: "changed", amount: "2" },
          retryKey,
        ),
      ).rejects.toMatchObject({ code: "idempotency_conflict" });

      // Move removes from its original parent before insertion validates position.
      // An invalid insertion must roll back both parent changes and the receipt.
      const failedKey = `${fixture}-failed`;
      await expect(
        execute(
          "item.move",
          { id: item.id, paycheckId: second.id, position: 999 },
          failedKey,
        ),
      ).rejects.toMatchObject({ code: "validation" });
      let records = await paychecks();
      expect(
        records
          .find((p) => p.id === first.id)
          ?.items.some((i) => i.id === item.id),
      ).toBe(true);
      expect(records.find((p) => p.id === second.id)?.items).toHaveLength(0);
      const receipt =
        await sql`SELECT key FROM command_receipts WHERE key=${failedKey}`;
      expect(receipt).toHaveLength(0);
      await execute(
        "item.move",
        { id: item.id, paycheckId: second.id, position: 0 },
        failedKey,
      );
      records = await paychecks();
      expect(
        records
          .find((p) => p.id === first.id)
          ?.items.some((i) => i.id === item.id),
      ).toBe(false);
      expect(records.find((p) => p.id === second.id)?.items[0]?.id).toBe(
        item.id,
      );
    } finally {
      try {
        if (originalDefault !== undefined)
          await execute("settings.update", {
            defaultIncome: (originalDefault / 100).toFixed(2),
          });
        for (const id of created) await execute("paycheck.delete", { id });
        for (const id of createdTemplates)
          await execute("template.delete", { id });
        await sql`DELETE FROM command_receipts WHERE key LIKE ${fixture + "%"}`;
      } finally {
        await store.close();
        await sql.close();
      }
    }
  },
  30000,
);
