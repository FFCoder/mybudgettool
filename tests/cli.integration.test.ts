import { expect, test } from "bun:test";
import { runCli } from "../src/cli/index";

// Opt in against an isolated running API: BUDGET_INTEGRATION_URL=http://localhost:3001 bun test tests/cli.integration.test.ts
const url = process.env.BUDGET_INTEGRATION_URL;
test.skipIf(!url)("CLI persists complete planning flow and invalid operations roll back", async () => {
  const env = { ...process.env, BUDGET_API_URL: url };
  const prefix = `cli-test-${crypto.randomUUID()}`;
  const created: { resource: string; id: string }[] = [];
  let seq = 0;
  const read = (words: string[]) => runCli(words, env) as Promise<any>;
  const mutate = async (resource: string, action: string, input: Record<string, unknown>, id?: string, key?: string): Promise<any> => {
    const words = [resource, action];
    if (id) words.push(id);
    return await runCli([...words, "--data", JSON.stringify(input), "--key", key ?? `${prefix}-${++seq}`], env);
  };
  const create = async (resource: string, input: Record<string, unknown>) => {
    const response = await mutate(resource, "create", input);
    created.push({ resource, id: response.result.id });
    return response.result;
  };
  try {
    const category = await create("categories", { name: `${prefix}-expenses` });
    const firstInput = { date: "2099-12-31", income: "100.00", notes: "Integration fixture" };
    const key = `${prefix}-first`;
    const firstResponse = await mutate("paychecks", "create", firstInput, undefined, key);
    const first = firstResponse.result;
    created.push({ resource: "paychecks", id: first.id });
    expect(await mutate("paychecks", "create", firstInput, undefined, key)).toEqual(firstResponse);
    const item = (await mutate("items", "create", { paycheckId: first.id, name: "Fixture expense", amount: "100.01", categoryId: category.id, dueDate: "2100-01-01", externalRefs: [{ system: "test", id: "a" }, { system: "test", id: "b" }] })).result;
    expect((await read(["paychecks", "totals", first.id])).remainingCents).toBe(-1);
    const template = await create("templates", { name: `${prefix}-template`, paycheckId: first.id });
    const second = await create("paychecks", { date: "2100-01-01", income: "200.00", templateId: template.id });
    expect(second.items[0].id).not.toBe(item.id);
    await mutate("items", "update", { amount: "10.00", notes: "Independent instance" }, item.id);
    expect((await read(["templates", "show", template.id])).items[0].amountCents).toBe(10001);
    expect((await read(["paychecks", "show", second.id])).items[0].amountCents).toBe(10001);
    await expect(mutate("items", "move", { paycheckId: second.id, position: 999 }, item.id)).rejects.toMatchObject({ code: "validation" });
    expect((await read(["paychecks", "show", first.id])).items[0].id).toBe(item.id);
    await mutate("items", "move", { paycheckId: second.id, position: 0 }, item.id);
    expect((await read(["paychecks", "show", first.id])).items).toHaveLength(0);
    const moved = await read(["paychecks", "show", second.id]);
    expect(moved.items[0].id).toBe(item.id);
    expect(moved.totalCents).toBe(11001);
    await mutate("items", "reorder", { paycheckId: second.id, itemIds: moved.items.map((x: any) => x.id).reverse() });
    expect((await read(["paychecks", "show", second.id])).items[1].id).toBe(item.id);
    expect((await read(["months", "show", "2099-12"])).paychecks.some((p: any) => p.id === first.id)).toBe(true);
    expect((await read(["months", "show", "2099-12"])).paychecks.some((p: any) => p.id === second.id)).toBe(false);
    await mutate("categories", "delete", {}, category.id);
    created.splice(created.findIndex(x => x.id === category.id), 1);
    expect((await read(["items", "show", item.id])).categoryId).toBeNull();
    await mutate("items", "delete", {}, item.id);
    await expect(read(["items", "show", item.id])).rejects.toMatchObject({ code: "NOT_FOUND" });
  } finally {
    for (const entity of created.reverse()) {
      try { await mutate(entity.resource, "delete", {}, entity.id); }
      catch (error) { console.error(`Fixture cleanup failed: ${entity.resource} ${entity.id}`, error); }
    }
  }
}, 30_000);
