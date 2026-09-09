# Run with containers

Docker with Compose can run the web app, CLI, migration runner, and backup tools without installing Bun or PostgreSQL clients on the host. These instructions run from the repository directory and do not deploy the application to a remote host.

Preserve an existing `.env` and its `API_TOKEN`. For a fresh checkout, create a private `.env` containing `API_TOKEN` set to a random secret of at least 24 characters. Generate it with your password manager or another secure generator, and restrict the file with `chmod 600 .env`.

## Bundled local database

Use both Compose files in the order shown. Keep the same project name and repository directory used by your existing Compose database: changing the project name selects a different named volume. The existing `compose.yaml` and its `budget-data` volume remain in use.

If a native app already uses this database, stop it before starting the container app or applying migrations. Port 3002 avoids a port conflict with the native app on 3000, but does not prevent two applications from writing the same database.

```sh
docker compose -f compose.yaml -f compose.containers.yaml up -d --wait db
docker compose -f compose.yaml -f compose.containers.yaml build web migrate cli ops
docker compose -f compose.yaml -f compose.containers.yaml up -d --wait web
```

The web service waits for the migration service to finish successfully. Open [My Budget App](http://127.0.0.1:3002) and sign in with the existing `API_TOKEN`. Set `WEB_PORT` if another local port is needed. The host binding stays on `127.0.0.1`; the container listens on port 3000.

Container services default to the bundled database at `db:5432`. The native `DATABASE_URL` in `.env` is deliberately not used by this Compose file: host `localhost` addresses would refer to the container itself. An explicit `CONTAINER_DATABASE_URL` overrides the database for the web, migration, and operations services.

## External PostgreSQL

Use only `compose.containers.yaml` to run against an existing external database. Securely export `CONTAINER_DATABASE_URL` with the full PostgreSQL connection URL, including any required TLS options, or set it in your private `.env`. This is separate from the native application's `DATABASE_URL`. `API_TOKEN` must also be available through `.env` or the environment.

After configuring those values:

```sh
docker compose -f compose.containers.yaml build web migrate cli ops
docker compose -f compose.containers.yaml up -d --wait web
```

If your database uses TLS certificate or key files, mount them read-only into the web, migration, and operations containers as needed, and use the container paths in the connection URL. The default Compose file does not mount these files. See [supported backup connection options](operations.md#upgrade).

This starts no bundled database. Without an explicit `CONTAINER_DATABASE_URL`, the default points at a `db` service that does not exist in the standalone configuration. Ensure the external database is reachable from Docker and stop any existing application writers before its migrations run.

## CLI

The CLI and operations services use the `tools` profile and run only on demand. For the bundled setup:

```sh
docker compose -f compose.yaml -f compose.containers.yaml run --rm cli --help
docker compose -f compose.yaml -f compose.containers.yaml run --rm cli months list
docker compose -f compose.yaml -f compose.containers.yaml run --rm cli settings show
```

For external PostgreSQL, omit `-f compose.yaml`. Targeting `cli` or `ops` explicitly activates that service without starting every tool. The CLI talks to `http://web:3000` on the private Docker network with the same API token. Compose explicitly enables `BUDGET_ALLOW_HTTP=1` for this internal connection; use HTTPS when overriding `CONTAINER_API_URL` to reach a remote API. CLI mutation syntax and retry keys are unchanged; see the [README](../README.md#cli).

## Upgrade

Use an explicit maintenance window. The commands below are for the bundled setup; omit `-f compose.yaml` for external PostgreSQL, retaining the same `CONTAINER_DATABASE_URL` configuration.

1. Stop the container web service and every other writer, including any native app sharing this database.
2. Check out the intended code and build the images. Builds install locked dependencies and run typechecks and unit tests.
3. Run the operations service to back up the database, verify the archive, and apply migrations.
4. Only after that succeeds, recreate the web service from the new image and verify your plans.

```sh
docker compose -f compose.yaml -f compose.containers.yaml stop web
# Stop any native app or other database writers too.
docker compose -f compose.yaml -f compose.containers.yaml build web migrate cli ops
mkdir -p backups
chmod 700 backups
docker compose -f compose.yaml -f compose.containers.yaml run --rm \
  --user "$(id -u):$(id -g)" ops scripts/container-upgrade.ts \
  --maintenance-confirmed --backup-dir /backups
# Run only after the upgrade command succeeds:
docker compose -f compose.yaml -f compose.containers.yaml up -d --wait \
  --no-deps --force-recreate web
```

The last command deliberately starts only the web service: the successful operations command has already applied migrations. Initial installation instead uses the web service's migration dependency. The `--maintenance-confirmed` flag confirms your action; it does not stop writers.

The operations image includes Bun and PostgreSQL 17 client tools. It performs a full custom-format database backup, checks the archive listing and fully decodes it before migrations. The PostgreSQL 17 dump tools support server versions up to 17. For a newer server, update the operations base image to a matching or newer PostgreSQL version and rebuild before upgrading. Code validation happens at image build time, so runtime operations do not install dependencies or modify the image.

The host `./backups` directory is mounted at `/backups`. Running with your host UID/GID lets the container write there without opening its permissions to other users. To use another directory, create it privately and set `BACKUP_DIR` in your environment or `.env`; keep the container argument `--backup-dir /backups`. Successful archives and any incomplete `.partial` file remain on the host after the temporary container exits.

If backup or migration fails, keep writers stopped. The script does not restart the application or roll back automatically. Follow [recovery into a separate empty database](operations.md#recovery); budget data, idempotency receipts, and the migration ledger are included in the backup.

## Stop services

```sh
docker compose -f compose.yaml -f compose.containers.yaml stop web
# To stop and remove this Compose project's containers and network:
docker compose -f compose.yaml -f compose.containers.yaml down
```

`down` retains the database volume. Do not add `-v`: that removes the named database volume. For the external-database setup, use only `-f compose.containers.yaml`; stopping these services does not stop the external PostgreSQL server.
