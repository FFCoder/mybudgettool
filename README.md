# My Budget App

A personal workspace for planning future paychecks. Plan each dated paycheck's expected income and expenses, savings, and extra debt payments. Remaining is income minus planned items; negative amounts stay visible and nothing carries over automatically. Actual Budget remains responsible for money already available.

## Run locally

For an all-container setup with no host Bun installation, see [running with containers](docs/containers.md). It supports the existing local PostgreSQL volume or an external database and opens the app on port 3002 by default.

Requires Bun 1.4+ and a reachable PostgreSQL database. Docker with Compose is optional for the bundled local database.

```sh
bun run setup
# On first run, setup creates a private .env with a random API_TOKEN,
# then stops so you can set DATABASE_URL in that file.
# For the bundled local database:
bun run db:up
# Set DATABASE_URL in .env to:
# postgres://budget:budget_local_only@localhost:55439/budget
bun run setup
bun run dev
```

Setup preserves an existing `.env`, installs locked dependencies, runs typechecks and unit tests, then applies tracked migrations. It does not start the application. You can configure `DATABASE_URL` for a remote PostgreSQL database instead. See [installation, upgrades, and recovery](docs/operations.md) for details.

Open [My Budget App](http://127.0.0.1:3000) and enter the API_TOKEN from `.env`. The token grants access to this entire personal budget. Keep `.env` private and preserve its generated secret.

The bundled PostgreSQL listens only on localhost port **55439**, with data in the `budget-data` Docker volume. `bun run db:down` stops it while retaining data. If that port is occupied, update both `compose.yaml` and `DATABASE_URL`. Run `bun run start` for a server without file watching; set `NODE_ENV=production` to disable Bun's development endpoints.

The application starts empty. Set a default income per paycheck in Settings to prefill future paychecks. Each paycheck can override it, including zero; changing the default leaves existing paychecks unchanged. Create your categories and optional named templates, then add a paycheck to any month. Every cell saves when edited; use item details for notes, due dates, and external references. Templates copy their items into new paychecks; later edits never change existing copies. Category deletion makes affected items uncategorized.

## Upgrade an existing installation

Check out the intended application version and stop every application process or other writer using this database. With compatible `pg_dump` and `pg_restore` on `PATH`, run:

```sh
bun run upgrade --maintenance-confirmed
# Optional backup location:
# bun run upgrade --maintenance-confirmed --backup-dir /private/path/budget-backups
bun run start
```

The flag confirms that you have stopped writers; the script does not stop them. Upgrade creates a private full-database backup and checks its archive listing and decodes the full archive before installing dependencies, running typechecks and unit tests, and applying migrations. Backups default to `./backups`. The script neither pulls code nor starts the app. Restart only after a successful result; on failure follow the [recovery instructions](docs/operations.md#recovery).

## CLI

The CLI talks to the same authenticated API as the interface. Start the app first. Bun automatically loads `.env`; `API_TOKEN` works locally, or set `BUDGET_API_TOKEN` and `BUDGET_API_URL` explicitly. Remote addresses require HTTPS (localhost HTTP is supported).

```sh
bun run cli --help
bun run cli state 2026-10
bun run cli months list
bun run cli settings show
bun run cli settings update --data '{"defaultIncome":"2500.00"}' --key default-income-v1
bun run cli categories create --data '{"name":"Monthly expenses"}' --key category-monthly-v1
bun run cli paychecks create --data '{"date":"2026-10-02","income":"2500.00","notes":"October first paycheck"}' --key october-first-v1
bun run cli months show 2026-10
bun run cli items create --data '{"paycheckId":"PAYCHECK_ID","name":"Planned expense","amount":"125.50"}' --key october-item-v1
bun run cli paychecks totals PAYCHECK_ID
bun run cli items create --data '{"templateId":"TEMPLATE_ID","name":"Monthly bill","amount":"125.50","monthlyDueDay":31}' --key template-monthly-bill-v1
```

Omit `income` when creating a paycheck to use the persisted default, or pass an explicit amount such as `"0"` to override it. The default is per paycheck, not annual or monthly, and applies only to future creates.

All writes require `--key`: choose a stable unique key for one intended change. If the connection fails, retry the exact command with the same key. A repeated key returns the original result; changing the payload with that key is rejected. Use a new key for each new action. JSON goes to stdout; structured errors go to stderr with nonzero exit status. Amount inputs are strings: plain decimals and formatted entries such as `$3,200.00` are accepted, including surrounding whitespace. Thousands separators must use groups of three digits. Negative amounts, junk, and more than two decimal places are rejected. Output amounts are integer cents. See `bun run cli --help`, [API.md](API.md), and the [agent planning skill](skills/paycheck-planning/SKILL.md).

## Verification

```sh
bun run typecheck
bun test
```

Database tests are opt-in and must use a disposable database, separate from your budget:

```sh
docker compose exec -T db createdb -U budget budget_test
TEST_DATABASE_URL=postgres://budget:budget_local_only@localhost:55439/budget_test bun test
```

To run the CLI end-to-end test, start a second server against that disposable database in another terminal, then point the test at it:

```sh
DATABASE_URL=postgres://budget:budget_local_only@localhost:55439/budget_test PORT=3001 bun index.ts
# In another terminal (uses API_TOKEN from .env):
BUDGET_INTEGRATION_URL=http://127.0.0.1:3001 bun test tests/cli.integration.test.ts
```

Do not point integration tests at a real budget. Fixtures are uniquely named and cleaned up, but test writes are intentional.

## Architecture and boundaries

Bun serves the TypeScript web interface and authenticated JSON API. Shared domain operations validate calendar dates and exact monetary amounts, calculate totals, copy templates, and move/order items. PostgreSQL persists the personal budget as a JSONB aggregate, locked during each write, together with durable idempotency receipts in the same transaction. This favors straightforward consistency for a single household; it is not a multi-tenant or high-throughput service. There are no bank connections, automatic imports, synchronization, reconciliation, formula engine, or automatic carryover.

External references are optional, manually managed `{system, id}` pairs, including multiple references per item. These are descriptive identifiers only; no Actual Budget API compatibility is asserted. Template items can use a monthly due day (1–31). Creating a paycheck resolves that day in the paycheck’s month, using the last day for shorter months; day 31 becomes February 28 in 2027. The copied item has a concrete date and remains independent of the template. A monthly due day takes precedence over an existing explicit template date. Clearing the monthly day preserves that explicit date, and templates without a monthly day copy it unchanged. Moving a recurring template item into a paycheck resolves its monthly day in the destination month and clears recurrence. Moving an item between paychecks keeps its explicit date. References also copy unchanged, so review dates and references when planning another month.

The default server binds only to `127.0.0.1`. Later remote hosting should put it behind HTTPS and private access controls; the CLI is already configurable. There is one shared access token and no user accounts. The CLI never accesses SQL. MCP can later wrap the same operations. No deployment is configured.

Migrations are tracked in a checksum ledger and serialized with a PostgreSQL advisory lock (`bun run db:migrate`). Use `bun run upgrade --maintenance-confirmed` for backed-up upgrades. Idempotency receipts are retained indefinitely to preserve retry safety; large-scale storage maintenance is outside this first version.
