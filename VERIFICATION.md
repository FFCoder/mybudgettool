# Verification — 2026-09-08

Environment: Bun 1.4.0, PostgreSQL 17 Docker container, macOS arm64.

- TypeScript: `bun run typecheck` passed.
- Full automated suite: 17 tests passed, 93 assertions, including opt-in PostgreSQL and live CLI integration tests. Default `bun test` runs 15 tests and skips the two integrations unless configured in README.
- Database integration: persistence across store reconnect; eight concurrent writes; five concurrent retries of the same command; conflicting retry keys; failed move rollback; successful retry after failure.
- CLI integration: complete planning flow, exact negative cents, independent template copies, multiple references, movement and ordering, December/January boundaries, category and item deletion.
- Browser: authenticated login; empty month; create paycheck; create item with notes and two references; negative one-cent remaining; inline amount update; invalid fractional precision rejected while preserving input; template copied from existing paycheck. Visual layout inspected at desktop viewport.
- Main database checked empty through authenticated CLI after verification. Browser fixtures were created in `budget_test` and removed afterward.

Live testing found and fixed double serialization of JSONB values in Bun SQL. Database shape constraints now reject malformed budget documents. UI mutation handling also prevents competing edits during saves and distinguishes acknowledged saves from refresh failures.

Not verified: remote deployment, mobile device interaction, bank/Actual Budget integrations (none implemented). Browser smoke checks are manual, not an automated regression suite.

## Default paycheck income enhancement

Added persisted per-paycheck income setting, with backward-compatible zero fallback for existing documents. Full suite now passes **20 tests / 111 assertions** and TypeScript passes. Verified PostgreSQL persistence across reconnect, omitted-income default, explicit zero, manual override, template creation behavior, and independence of existing paychecks after changing the default. Browser verified saving $2,450.25, prefilled creation dialog, and adjusted paycheck at $2,400.25. Test fixtures/default restored in disposable database. Normal app restarted on port 3000; no existing user records modified.

## Friendly currency entry

Shared money parsing accepts optional leading `$`, standard comma grouping, and surrounding whitespace while retaining integer-cent conversion. Regression suite: **21 tests / 146 assertions**, all passing; TypeScript passed. Focused checks cover valid formatting across default income, paycheck create/edit, and template item create/edit; malformed groups, junk, negatives, and excess precision are rejected. Browser successfully saved `  $3,200.00  ` in the isolated default-income dialog. Test setting restored; real user data and income were not changed. Normal app restarted on port 3000.

## Currency presentation, inline categories, and monthly template dates

Full suite passes **28 tests / 214 assertions**, including PostgreSQL persistence and CLI integration; TypeScript passes. Formatting tests prove invalid precision is retained without rounding. Date tests cover year boundaries, leap/nonleap February, day 31 clamping, unset/invalid days, legacy explicit dates, template independence, and concrete-date retention on moves. Browser verified amount `50` becomes `$50.00` on blur; inline category creation preserved name, amount, monthly day 31, notes and external reference, selected the category, and saved the template item successfully. Disposable browser fixtures removed. Normal app restarted on port 3000. Existing user data was not modified; older template date fields remain supported without migration.

## Install, upgrade, and tracked migrations

Full suite: **33 tests / 240 assertions**, all passing; TypeScript passes. Setup ran twice against a dedicated disposable database (one migration, then zero). Upgrade ran twice with private custom-format backups and zero pending migrations. A backup was restored into a separate empty database and verified to contain the fixture income (12345 cents), command receipt, and migration ledger. Missing maintenance confirmation, missing PostgreSQL client tools, and a forced dump failure all aborted safely. Migration integration verified legacy schema adoption without data loss, concurrent runners, altered/missing migrations, and full transaction rollback. Unit checks verify exclusive private config creation and exact preservation on rerun.

This machine lacks native pg_dump/pg_restore on PATH. End-to-end backup checks used test-only wrappers around the real PostgreSQL 17 tools in the Docker container; production scripts require compatible host tools. No remote/production database was tested. Existing .env, user data, and the running port-3000 application were not changed or restarted. Test databases and private test backup archives are separate from the user's budget.

## Docker web, CLI, and operations

Built all targets from Bun 1.4.0 Alpine with frozen dependencies, TypeScript checks, and unit tests (32 passed / 209 assertions; three DB integration tests skip inside image builds). Runtime web and CLI use non-root users; web image checked to exclude .env, backups, and node_modules. Isolated Compose project used its own volume, PostgreSQL port 55449 and web port 3012. Verified production HTML/JS/CSS serving, anonymous API rejection, authenticated container CLI create/read/retry/delete, migration-before-web startup, and healthy restart after upgrade. Standalone migration configuration reached an externally addressed local test database without a bundled db service.

Final operations image ran as host UID 501, produced a mode-600 custom archive in a private host directory, validated the TOC and decoded all contents, and applied zero pending migrations. Restored that archive to a new empty test database and verified budget_state (1), command_receipts (2), and migration ledger (1). This exposed and fixed a previous native backup connection issue: pg_dump needs separate libpq connection environment fields rather than a full URI in PGDATABASE; explicit username also supports host UIDs absent from the container passwd database. Regression tests cover decoding credentials and preserving TLS options. No remote production DB or remote TLS endpoint was available for testing.

During the interrupted run, existing DB containers and the native app had stopped. Existing database containers were restarted without recreating volumes, and the native app restored on port 3000; authenticated API returned 200. No real planner records, .env values, or database volumes were altered. Isolated test containers were stopped afterward; test volume and private backup retained. Container usage and migration/backup/upgrade commands are in docs/containers.md.
