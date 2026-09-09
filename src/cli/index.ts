#!/usr/bin/env bun
import { callApi, CliError, parseArgs } from "./client";
import type { ApiCommand } from "./client";

export const HELP = `My Budget App CLI — JSON output
Usage: bun src/cli/index.ts <resource> <action> [id] [options]

Read:
  state [YYYY-MM]              All state, optionally one month
  months list                 Months with planned paychecks
  months show YYYY-MM          State for a month
  paychecks list | show <id> | totals <id>
  templates list | show <id>
  categories list | show <id>
  items show <id>
  settings show               Default income per paycheck

Write (all require --key and optional --data JSON object):
  paychecks create | update <id> | delete <id>
  templates create | update <id> | delete <id>
  categories create | update <id> | delete <id>
  items create | update <id> | delete <id> | move <id> | reorder
  settings update             --data '{"defaultIncome":"2500.00"}'

Options:
  --data '<JSON>'   Input fields from API.md. Money is a decimal string.
  --key <key>       Unique operation key. Reuse identical key/data for retries.
  --url <url>       API root (BUDGET_API_URL, default http://localhost:3000)
  --token <token>   Bearer token (BUDGET_API_TOKEN or API_TOKEN)
  --help           Print this help without connecting

Examples:
  bun src/cli/index.ts months show 2026-10
  bun src/cli/index.ts paychecks create --data '{"date":"2026-10-15","income":"2500.00"}' --key paycheck-oct15
  bun src/cli/index.ts items create --data '{"paycheckId":"UUID","name":"Rent","amount":"1200.00"}' --key rent-oct15
  bun src/cli/index.ts items move ITEM_UUID --data '{"paycheckId":"DEST_UUID","position":0}' --key move-rent
  bun src/cli/index.ts templates create --data '{"name":"First paycheck","paycheckId":"UUID"}' --key template-first
  bun src/cli/index.ts paychecks create --data '{"date":"2026-11-01","templateId":"UUID"}' --key paycheck-nov1

Omitted paycheck income uses the saved default per paycheck; explicit "0" is honored.
Changing the default affects future creates only.

Success is JSON on stdout. Errors are JSON on stderr with exit status 1.
`;

const resources: Record<string, string> = { paychecks: "paycheck", templates: "template", categories: "category", items: "item", settings: "settings" };
export type CliPlan = { command: ApiCommand; select: (data: any) => unknown };
export function planCommand(words: string[], data?: string): CliPlan {
  const [resource, action, id, ...extra] = words;
  if (extra.length) throw new CliError("Too many arguments. See --help");
  const state = (month?: string): ApiCommand => {
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new CliError("Month must be YYYY-MM");
    return { method: "GET", path: `/api/state${month ? `?month=${month}` : ""}` };
  };
  const read = (command: ApiCommand, select = (x: any): unknown => x): CliPlan => {
    if (data !== undefined) throw new CliError("--data is only supported for mutations");
    return { command, select };
  };
  if (resource === "state" && !id) return read(state(action));
  if (resource === "months" && action === "list" && !id) return read(state(), x => x.months);
  if (resource === "months" && action === "show" && id) return read(state(id));
  if (resource === "settings") {
    if (id) throw new CliError("Settings commands do not accept an id");
    if (action === "show") return read(state(), x => x.settings);
    if (action !== "update") throw new CliError("Settings supports show or update. See --help");
  }
  if (!resource || !resources[resource]) throw new CliError("Unknown resource. See --help");
  if (action === "list" && !id && resource !== "items") return read(state(), x => x[resource]);
  if ((action === "show" || (action === "totals" && resource === "paychecks")) && id) {
    return read(state(), x => {
      const rows = resource === "items" ? [...x.paychecks, ...x.templates].flatMap((parent: any) => parent.items) : x[resource];
      const found = rows.find((row: any) => row.id === id);
      if (!found) throw new CliError(`${resource} record ${id} was not found`, "NOT_FOUND");
      return action === "totals" ? { id: found.id, incomeCents: found.incomeCents, totalCents: found.totalCents, remainingCents: found.remainingCents, categoryTotals: found.categoryTotals } : found;
    });
  }
  const allowed = resource === "items" ? ["create", "update", "delete", "move", "reorder"] : ["create", "update", "delete"];
  if (!action || !allowed.includes(action)) throw new CliError("Unknown action. See --help");
  const needsId = resource !== "settings" && ["update", "delete", "move"].includes(action);
  if (needsId !== Boolean(id)) throw new CliError(needsId ? `${resource} ${action} requires an id` : `${resource} ${action} does not accept a positional id`);
  let input: Record<string, unknown> = {};
  if (data !== undefined) {
    try { input = JSON.parse(data); } catch { throw new CliError("--data must be valid JSON"); }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new CliError("--data must be a JSON object");
  }
  if (id && input.id !== undefined && input.id !== id) throw new CliError("Positional id conflicts with --data id");
  if (id) input.id = id;
  return { command: { method: "POST", path: "/api/commands", body: { operation: `${resources[resource]}.${action}`, input } }, select: x => x };
}

export async function runCli(args: string[], env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch): Promise<unknown> {
  const parsed = parseArgs(args);
  if (parsed.help || !parsed.words.length) return HELP;
  const plan = planCommand(parsed.words, parsed.options.data);
  return plan.select(await callApi(plan.command, parsed.options, env, fetcher));
}

if (import.meta.main) {
  try {
    const result = await runCli(process.argv.slice(2));
    console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
  } catch (error) {
    const known = error instanceof CliError ? error : new CliError("Unexpected CLI failure");
    console.error(JSON.stringify({ error: { code: known.code, message: known.message, ...(known.status ? { status: known.status } : {}) } }));
    process.exitCode = 1;
  }
}
