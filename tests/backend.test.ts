import { describe, test, expect } from "bun:test";
import {
  command,
  emptyBudget,
  money,
  date,
  month,
  state,
  AppError,
  type Budget,
} from "../src/shared/domain";
import { createApiHandler } from "../src/server/api";
import type { Store } from "../src/server/store";
const run = (b: Budget, op: string, input: object) =>
  command(b, op, input) as any;
describe("planning rules", () => {
  test("currency entries accept only valid dollar and thousands formatting", () => {
    for (const input of ["3200", "$3200", "3,200", "$3,200.00", "  $3,200.00  ", "3200.00"])
      expect(money(input)).toBe(320000);
    expect(money("$1,234,567.89")).toBe(123456789);
    expect(money(" $0.01 ")).toBe(1);
    expect(money("$0")).toBe(0);
    for (const input of ["$3,20", "32,00", "1,23,456", "1234,567", "0,123", "3,,200", ",3200", "3,200,", "$$3200", "3200$", "$ 3200", "$-3,200", "-3200", "+3200", "(3,200)", "3 200", "3,200.001", "$3,200.0x", "USD 3200", "", " ", 3200, null])
      expect(() => money(input)).toThrow(AppError);
    const b = emptyBudget();
    run(b, "settings.update", {defaultIncome: "$3,200.00"});
    const paycheck = run(b, "paycheck.create", {date: "2026-09-01", income: " $3,100.25 "});
    run(b, "paycheck.update", {id: paycheck.id, income: "$3,000"});
    const template = run(b, "template.create", {name: "Currency test"});
    const item = run(b, "item.create", {templateId: template.id, name: "Expense", amount: "$1,000.01"});
    run(b, "item.update", {id: item.id, amount: " 1,200.02 "});
    expect(state(b).settings.defaultIncomeCents).toBe(320000);
    expect(state(b).paychecks[0]!.incomeCents).toBe(300000);
    expect(item.amountCents).toBe(120002);
  });
  test("saved per-paycheck income defaults apply only to new paychecks, with explicit overrides", () => {
    const b = emptyBudget();
    delete b.settings; // Existing documents remain compatible without migration.
    expect(state(b).settings.defaultIncomeCents).toBe(0);
    const old = run(b, "paycheck.create", { date: "2026-09-01" });
    run(b, "settings.update", { defaultIncome: "2450.25" });
    const usual = run(b, "paycheck.create", { date: "2026-09-15" });
    const adjusted = run(b, "paycheck.create", { date: "2026-10-01", income: "2400.25" });
    const zero = run(b, "paycheck.create", { date: "2026-10-15", income: "0" });
    const template = run(b, "template.create", { name: "First paycheck" });
    const copied = run(b, "paycheck.create", { date: "2026-11-01", templateId: template.id });
    run(b, "settings.update", { defaultIncome: "2500" });
    expect([old.incomeCents, usual.incomeCents, adjusted.incomeCents, zero.incomeCents, copied.incomeCents]).toEqual([0, 245025, 240025, 0, 245025]);
    expect(state(b).settings.defaultIncomeCents).toBe(250000);
    expect(() => run(b, "settings.update", { defaultIncome: "1.001" })).toThrow(AppError);
    expect(() => run(b, "paycheck.create", { date: "2026-11-15", income: null })).toThrow(AppError);
    expect(state(b).settings.defaultIncomeCents).toBe(250000);
  });
  test("money uses exact cents and refuses loss of precision", () => {
    expect(money("12.34")).toBe(1234);
    expect(money("0.1") + money("0.2")).toBe(30);
    for (const bad of ["1.001", "-1", "1e3", "NaN", "100000000000000000", 1])
      expect(() => money(bad)).toThrow(AppError);
  });
  test("strict dates and month boundaries", () => {
    expect(date("2024-02-29")).toBe("2024-02-29");
    for (const bad of ["2025-02-29", "2026-13-01", "2026-04-31", "2026-01-00"])
      expect(() => date(bad)).toThrow(AppError);
    expect(() => month("2026-13")).toThrow();
    const b = emptyBudget();
    run(b, "paycheck.create", { date: "2026-12-31" });
    run(b, "paycheck.create", { date: "2027-01-01" });
    expect(state(b, "2027-01").paychecks).toHaveLength(1);
  });
  test("negative remaining is allowed with no carryover", () => {
    const b = emptyBudget();
    const a = run(b, "paycheck.create", { date: "2026-09-01", income: "100" });
    run(b, "item.create", {
      paycheckId: a.id,
      name: "Savings",
      amount: "125.99",
    });
    run(b, "paycheck.create", { date: "2026-09-15", income: "100" });
    const ps = state(b).paychecks;
    expect(ps[0]!.totalCents).toBe(12599);
    expect(ps[0]!.remainingCents).toBe(-2599);
    expect(ps[1]!.remainingCents).toBe(10000);
  });
  test("templates are deeply independent and copy references", () => {
    const b = emptyBudget();
    const t = run(b, "template.create", { name: "First" });
    const i = run(b, "item.create", {
      templateId: t.id,
      name: "Loan",
      amount: "20",
      externalRefs: [{ system: "actual", id: "manual-id" }],
    });
    const a = run(b, "paycheck.create", {
      date: "2026-09-01",
      templateId: t.id,
    });
    const c = run(b, "paycheck.create", {
      date: "2026-10-01",
      templateId: t.id,
    });
    run(b, "item.update", { id: i.id, amount: "40" });
    run(b, "item.update", { id: a.items[0].id, externalRefs: [] });
    expect(c.items[0].amountCents).toBe(2000);
    expect(c.items[0].externalRefs).toHaveLength(1);
    expect(t.items[0].amountCents).toBe(4000);
    expect(a.items[0].id).not.toBe(i.id);
  });
  test("movement recalculates totals and ordering; category deletion retains items", () => {
    const b = emptyBudget();
    const c = run(b, "category.create", { name: "Monthly" });
    const a = run(b, "paycheck.create", { date: "2026-09-01" });
    const z = run(b, "paycheck.create", { date: "2026-09-15" });
    const i = run(b, "item.create", {
      paycheckId: a.id,
      name: "Rent",
      amount: "123",
      categoryId: c.id,
    });
    run(b, "item.move", { id: i.id, paycheckId: z.id, position: 0 });
    expect(state(b).paychecks.map((p) => p.totalCents)).toEqual([0, 12300]);
    expect(state(b).paychecks[1]!.categoryTotals).toEqual([
      { categoryId: c.id, totalCents: 12300 },
    ]);
    run(b, "category.delete", { id: c.id });
    expect(b.paychecks[1]!.items[0]!.categoryId).toBeNull();
    expect(b.paychecks[1]!.items[0]!.position).toBe(0);
    expect(() =>
      run(b, "item.reorder", { paycheckId: z.id, itemIds: [] }),
    ).toThrow();
  });
});
const token = "test-token-at-least-24-characters";
function memoryStore(): Store {
  let b = emptyBudget();
  const receipts = new Map<
    string,
    { fingerprint: string; response: unknown }
  >();
  return {
    async read(m) {
      return state(b, m);
    },
    async execute(op, input, key, fingerprint) {
      const previous = receipts.get(key);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new AppError("idempotency_conflict", "Key conflict", 409);
        return previous.response;
      }
      const clone = structuredClone(b);
      const response = { result: command(clone, op, input) };
      b = clone;
      receipts.set(key, { fingerprint, response });
      return response;
    },
  };
}
describe("authenticated API", () => {
  test("rejects anonymous calls and bad configuration", async () => {
    expect(() => createApiHandler(memoryStore(), "short")).toThrow();
    const api = createApiHandler(memoryStore(), token);
    expect((await api(new Request("http://local/api/state"))).status).toBe(401);
  });
  test("validates commands and replays idempotent creates", async () => {
    const api = createApiHandler(memoryStore(), token);
    const send = (body: unknown, key = "abc") =>
      api(
        new Request("http://local/api/commands", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "idempotency-key": key,
          },
          body: JSON.stringify(body),
        }),
      );
    const body = {
      operation: "paycheck.create",
      input: { date: "2026-09-01", income: "123.45" },
    };
    const first = await (await send(body)).json();
    expect(await (await send(body)).json()).toEqual(first);
    expect(
      (await send({ ...body, input: { date: "2026-09-02" } })).status,
    ).toBe(409);
    expect(
      (
        await send(
          { operation: "paycheck.create", input: { date: "2026-13-01" } },
          "bad",
        )
      ).status,
    ).toBe(400);
    const s = await (
      await api(
        new Request("http://local/api/state", {
          headers: { authorization: `Bearer ${token}` },
        }),
      )
    ).json();
    expect((s as { paychecks: unknown[] }).paychecks).toHaveLength(1);
  });
});
