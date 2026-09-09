---
name: paycheck-planning
description: Plan future paychecks in My Budget App through its authenticated CLI, including expenses, templates, categories, and user-provided external references.
---

Run `bun src/cli/index.ts --help` from the application directory to discover commands, then read `API.md` for input fields. Configure `BUDGET_API_URL` and `BUDGET_API_TOKEN` (or `API_TOKEN`) in the environment; remote addresses use HTTPS. The CLI outputs JSON and calls the same application API as the web interface.

1. Inspect the requested month, relevant paychecks, categories, templates, and `settings show` before editing. Use IDs returned by the application.
2. Apply the user's future plan. Income and item amounts are decimal strings such as `"125.50"`; returned amounts are integer cents. Dates use `YYYY-MM-DD`. Savings and extra debt payments are planned items. Remaining is income minus planned items for that paycheck, with no carryover. A negative remaining is a planning signal.
3. Supply a unique `--key` for each mutation. If a request times out or its result is uncertain, retry the identical command with the same key and data; a new key may create a duplicate. Changed data needs a new operation key. Stop retrying on validation, authorization, or conflicting-key errors and resolve their cause.
4. Inspect the affected paychecks and totals after editing. Report the resulting remaining amounts and any negative plans.

Use `settings update --data '{"defaultIncome":"2500.00"}' --key UNIQUE_KEY` to save a default per paycheck. Omitted income on paycheck creation uses this default; explicit `"0"` is honored. Changing the default applies to future creates only and leaves existing paychecks unchanged. Treat it as income per paycheck, not annual or monthly income.

For recurring template due dates, set `monthlyDueDay` to an integer 1–31 through item create/update. For example, `items update TEMPLATE_ITEM_ID --data '{"monthlyDueDay":15}' --key UNIQUE_KEY`. Instantiation resolves the day in the new paycheck’s month, clamping to the month’s last day; the copied item stores a concrete `dueDate` and clears `monthlyDueDay`. The recurring day takes precedence over an existing explicit template date. Set `monthlyDueDay:null` to clear recurrence while retaining any explicit date; omitted recurrence also preserves legacy dates. Moving a recurring template item into a paycheck resolves the day in the destination month and clears recurrence. Moving a concrete paycheck item retains its date.

Template instantiation copies items. Template changes affect future instantiations; existing paychecks remain independent. Use item update for notes and `externalRefs:[{"system":"actual","id":"user-provided-id"}]`; use an empty array to clear references. References are user-managed identifiers, potentially several per item. Treat them as annotations: Actual Budget handles available money, and this app performs no automatic import, synchronization, or reconciliation.
