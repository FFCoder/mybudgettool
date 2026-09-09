import { describe, expect, test } from "bun:test";
import { callApi, parseArgs } from "../src/cli/client";
import { planCommand, runCli } from "../src/cli/index";

const env = { API_TOKEN: "test-token" };
function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch {
  return ((url: string | URL | Request, init?: RequestInit) => handler(String(url), init!)) as typeof fetch;
}

describe("CLI shared API contract", () => {
  test("preserves precise monetary strings and sends authenticated idempotent command", async () => {
    const result = await runCli(["items", "create", "--data", '{"paycheckId":"p","name":"Rent","amount":"1234.56"}', "--key", "rent-1"], env, mockFetch((url, init) => {
      expect(url).toBe("http://localhost:3000/api/commands");
      expect(init.method).toBe("POST");
      expect(init.headers).toMatchObject({ Authorization: "Bearer test-token", "Idempotency-Key": "rent-1" });
      expect(JSON.parse(String(init.body))).toEqual({ operation: "item.create", input: { paycheckId: "p", name: "Rent", amount: "1234.56" } });
      return Response.json({ result: { amountCents: 123456 } });
    }));
    expect(result).toEqual({ result: { amountCents: 123456 } });
  });
  test("reads month state and server-computed totals without recalculation", async () => {
    const paycheck = { id: "p", incomeCents: 100, totalCents: 125, remainingCents: -25, categoryTotals: [] };
    const fetcher = mockFetch((url) => {
      expect(url).toEndWith("/api/state");
      return Response.json({ paychecks: [paycheck] });
    });
    expect(await runCli(["paychecks", "totals", "p"], env, fetcher)).toEqual(paycheck);
    expect(planCommand(["months", "show", "2026-12"]).command.path).toBe("/api/state?month=2026-12");
    expect(() => planCommand(["months", "show", "2026-13"])).toThrow("YYYY-MM");
  });
  test("all mutation actions map directly to shared operations", () => {
    for (const [resource, singular, actions] of [
      ["paychecks", "paycheck", ["create", "update", "delete"]],
      ["templates", "template", ["create", "update", "delete"]],
      ["categories", "category", ["create", "update", "delete"]],
      ["items", "item", ["create", "update", "delete", "move", "reorder"]],
    ] as const) {
      for (const action of actions) {
        const words: string[] = [resource, action];
        if (["update", "delete", "move"].includes(action)) words.push("id");
        expect(planCommand(words).command.body).toMatchObject({ operation: `${singular}.${action}` });
      }
    }
  });
  test("notes and multiple references pass unchanged", () => {
    const input = { notes: "Two installments", externalRefs: [{ system: "actual", id: "a" }, { system: "actual", id: "b" }] };
    expect(planCommand(["items", "update", "item-1"], JSON.stringify(input)).command.body).toEqual({ operation: "item.update", input: { ...input, id: "item-1" } });
  });
  test("rejects ambiguous inputs before mutation", async () => {
    expect(() => parseArgs(["--unknown", "x"])).toThrow("Unknown option");
    expect(() => parseArgs(["--data"])).toThrow("needs a value");
    expect(() => planCommand(["items", "update", "a"], '{"id":"b"}')).toThrow("conflicts");
    expect(() => planCommand(["items", "create"], "[]")).toThrow("object");
    await expect(runCli(["categories", "create", "--data", '{"name":"Food"}'], env)).rejects.toThrow("--key");
  });
  test("auth and remote transport failures are actionable", async () => {
    await expect(callApi({ method: "GET", path: "/api/state" }, {}, {})).rejects.toThrow("TOKEN");
    await expect(callApi({ method: "GET", path: "/api/state" }, { url: "http://remote.example" }, env)).rejects.toThrow("HTTPS");
    await expect(callApi({ method: "GET", path: "/api/state" }, {}, env, mockFetch(() => Response.json({ error: { code: "UNAUTHORIZED", message: "Invalid token" } }, { status: 401 })))).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401, message: "Invalid token" });
  });
  test("internal HTTP requires explicit private-network opt-in", async () => {
    const command = { method: "GET", path: "/api/state" };
    const options = { url: "http://web:3000" };
    for (const allow of [undefined, "0", "true"]) {
      await expect(callApi(command, options, { ...env, BUDGET_ALLOW_HTTP: allow })).rejects.toThrow("BUDGET_ALLOW_HTTP=1");
    }
    const result = await callApi(command, options, { ...env, BUDGET_ALLOW_HTTP: "1" }, mockFetch((url, init) => {
      expect(url).toBe("http://web:3000/api/state");
      expect(init.headers).toMatchObject({ Authorization: "Bearer test-token" });
      expect(init.redirect).toBe("error");
      return Response.json({ paychecks: [] });
    }));
    expect(result).toEqual({ paychecks: [] });
  });
  test("read selection reports missing records", async () => {
    await expect(runCli(["items", "show", "missing"], env, mockFetch(() => Response.json({ paychecks: [], templates: [] })))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  test("settings read and update use shared API without a record id", async () => {
    expect(await runCli(["settings", "show"], env, mockFetch(() => Response.json({ settings: { defaultIncomeCents: 250050 } })))).toEqual({ defaultIncomeCents: 250050 });
    expect(await runCli(["settings", "update", "--data", '{"defaultIncome":"2500.50"}', "--key", "default-income-1"], env, mockFetch((_url, init) => {
      expect(JSON.parse(String(init.body))).toEqual({ operation: "settings.update", input: { defaultIncome: "2500.50" } });
      expect(init.headers).toMatchObject({ "Idempotency-Key": "default-income-1" });
      return Response.json({ result: { defaultIncomeCents: 250050 } });
    }))).toEqual({ result: { defaultIncomeCents: 250050 } });
    expect(() => planCommand(["settings", "show", "id"])).toThrow("do not accept an id");
    expect(() => planCommand(["settings", "create"])).toThrow("show or update");
    await expect(runCli(["settings", "update", "--data", '{"defaultIncome":"0"}'], env)).rejects.toThrow("--key");
  });
  test("paycheck creation preserves omitted income and explicit zero for server defaults", () => {
    expect(planCommand(["paychecks", "create"], '{"date":"2026-10-01"}').command.body).toEqual({ operation: "paycheck.create", input: { date: "2026-10-01" } });
    expect(planCommand(["paychecks", "create"], '{"date":"2026-10-01","income":"0"}').command.body).toEqual({ operation: "paycheck.create", input: { date: "2026-10-01", income: "0" } });
  });
  test("template monthly due days and clearing recurrence pass through unchanged", async () => {
    for (const monthlyDueDay of [1, 31, null]) {
      const input = { monthlyDueDay, dueDate: "2027-01-20" };
      await runCli(["items", "update", "template-item", "--data", JSON.stringify(input), "--key", `due-day-${monthlyDueDay}`], env, mockFetch((_url, init) => {
        expect(JSON.parse(String(init.body))).toEqual({ operation: "item.update", input: { ...input, id: "template-item" } });
        return Response.json({ result: { id: "template-item", ...input } });
      }));
    }
    expect(planCommand(["items", "create"], '{"templateId":"t","name":"Monthly bill","amount":"125.50","monthlyDueDay":31}').command.body).toEqual({ operation: "item.create", input: { templateId: "t", name: "Monthly bill", amount: "125.50", monthlyDueDay: 31 } });
  });
  test("help works without token or server", async () => {
    expect(await runCli(["--help"], {})).toContain("paychecks create");
  });
});
