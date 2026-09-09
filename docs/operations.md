# Installation, upgrades, and recovery

For container-based installation, CLI access, and upgrades without host Bun or PostgreSQL clients, use [the container guide](containers.md). The commands below describe the native Bun setup.

## Installation

Run commands from the application checkout. Install Bun 1.4+ and arrange a reachable PostgreSQL database. For a local database, the repository includes Docker Compose; start it with `bun run db:up`. Its database URL is `postgres://budget:budget_local_only@localhost:55439/budget`.

Run `bun run setup`. If `DATABASE_URL` is not already supplied and `.env` is absent, setup creates it with a random API token and an empty `DATABASE_URL`, then stops for configuration. Set `DATABASE_URL` in that file and rerun `bun run setup`. Keep the generated token; existing `.env` files are preserved. A remote PostgreSQL URL is also supported, including connection options required by your provider.

Setup installs dependencies from the lockfile, runs TypeScript checks and unit tests, then applies tracked migrations. Integration-test environment variables are explicitly set to empty for that test run, so values in `.env` cannot reload and enable database-writing tests. It does not create a PostgreSQL server, start the application, or deploy it. After setup succeeds, run `bun run dev` for development or `bun run start` without file watching. Use the token in `.env` to sign in at the configured application address.

## Upgrade

Install compatible PostgreSQL client utilities so `pg_dump` and `pg_restore` are on `PATH`. The dump utility must support your database server version. The upgrade script uses these host utilities even when PostgreSQL runs in Docker.

1. Check out the intended application version. The upgrade script uses that checkout and does not pull code.
2. Stop all application processes and other database writers. Keep them stopped throughout the upgrade.
3. Run `bun run upgrade --maintenance-confirmed`. To choose another private backup directory, add `--backup-dir /private/path/budget-backups`.
4. After success, start the application and inspect your saved plans. Keep the backup until you have verified the upgraded application and established your normal retention policy.

`--maintenance-confirmed` records your confirmation that writers are stopped. The script cannot stop them for you. It creates a full custom-format PostgreSQL archive in a private directory, defaulting to `./backups`, and verifies both the archive listing (`pg_restore --list`) and full archive decoding (`pg_restore --file /dev/null`). Only then does it install locked dependencies, typecheck, run unit tests, and migrate. These checks read the archive without restoring it into a database. A restore into a disposable database remains the stronger recovery check.

An existing backup directory must have private permissions (`chmod 700`); archives use mode `600`. A failed backup may leave a private `.partial` file for diagnosis. The script reports its path and does not proceed to migrations.

The backup includes budget data, idempotency receipts, and the migration ledger. Migration execution takes a PostgreSQL advisory lock, records checksums, and rejects changed migrations already recorded as applied. The database lock serializes migration runners; it does not replace stopping application writers.

Add migrations as new numbered SQL files following the existing naming convention. Keep applied migration files unchanged: their recorded checksums are checked on later runs. All pending migrations and their ledger entries run in one transaction. For an installation predating the ledger, the idempotent initial `001` migration runs and is recorded without replacing existing budget data.

For backups, the script decomposes `DATABASE_URL` into PostgreSQL connection environment variables (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD`), plus supported connection options. `PGDATABASE` contains the database name, not the full URL. The username is also passed explicitly so the utility works under a host UID without a container passwd entry; the password and full connection URL never become command arguments. Protect `.env` and backup files. The script does not start or stop the application and does not perform an automatic rollback if a later step fails.

Backup URL query options supported by the script are `sslmode`, `sslrootcert`, `sslcert`, `sslkey`, `sslcrl`, `connect_timeout`, `options`, `application_name`, `target_session_attrs`, and `channel_binding`. Unknown options are rejected. Certificate and key paths must be readable by the process running the backup; container operations require mounting those files at the configured container paths.

## Recovery

If upgrade fails, leave writers stopped and inspect the error. Preserve the archive. Dependency, typecheck, and unit-test failures occur before migrations. If migration execution fails, inspect the ledger and error before deciding how to proceed; do not restart older code against a changed schema without checking compatibility.

Restore a selected archive into a **new, empty database**, never over your existing budget. Provision the destination database first with an appropriate role. Use PostgreSQL clients compatible with the archive and configure the connection environment for that new database. The following example assumes you have securely set `PGHOST`, `PGPORT`, `PGUSER`, and any authentication needed by the client:

```sh
export PGDATABASE=budget_recovery
pg_restore --list /private/path/to/selected-backup.dump
pg_restore --exit-on-error --single-transaction --no-owner --no-privileges \
  --dbname "$PGDATABASE" /private/path/to/selected-backup.dump
```

Replace the filename with the actual archive path reported by upgrade; the `.dump` name above is illustrative. `budget_recovery` must already exist and be empty. Ownership and grants use the destination role rather than archived roles because this example uses `--no-owner --no-privileges`.

Inspect the restored database with the application version corresponding to that backup, using a separate checkout and configuration if necessary. Keep it isolated from normal writers during verification. Once its plans, settings, templates, and categories are verified, deliberately choose whether to switch the application to the restored database. Restoring into a separate database leaves the original available for investigation. This is a manual recovery procedure, not an automatic migration rollback.

## Verification scope

The lifecycle flow was verified locally with PostgreSQL 17 client tools through Docker wrappers because native PostgreSQL clients were unavailable in the verification environment. A full backup was restored into a separate test database and its budget data, idempotency receipt, and migration ledger were checked. No production database was used. Install PostgreSQL client utilities on `PATH` for your own setup and verify recovery against your database environment.
