import { mkdir, open, stat, chmod, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { SQL } from 'bun';
import { MigrationError } from '../../src/server/migrations';

export class SetupError extends Error {}
export function config(env = process.env) {
  if (!env.DATABASE_URL) throw new SetupError('Set DATABASE_URL in .env (or the environment) to your PostgreSQL database, then rerun.');
  try {
    const url = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) throw new Error();
  } catch { throw new SetupError('DATABASE_URL must be a valid PostgreSQL connection URL with a database name.'); }
  if (!env.API_TOKEN || env.API_TOKEN.length < 24 || env.API_TOKEN === 'replace-with-a-long-random-secret')
    throw new SetupError('Set API_TOKEN to a private random secret of at least 24 characters in .env.');
  return { databaseUrl: env.DATABASE_URL, token: env.API_TOKEN };
}
export async function initializeConfig(root: string) {
  const file = join(root, '.env');
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (e: any) { if (e.code === 'EEXIST') return false; throw new SetupError('Could not create private .env file. Check directory permissions.'); }
  try {
    await handle.writeFile(`# Configure an existing PostgreSQL database before running setup again.\nDATABASE_URL=\nAPI_TOKEN=${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}\nHOST=127.0.0.1\nPORT=3000\nBUDGET_API_URL=http://127.0.0.1:3000\n`);
  } finally { await handle.close(); }
  return true;
}
export async function preflight(root: string, upgrade = false) {
  const [major, minor] = Bun.version.split('.').map(Number);
  if (major! < 1 || (major === 1 && minor! < 4)) throw new SetupError('Bun 1.4 or newer is required.');
  for (const name of ['package.json', 'bun.lock'])
    if (!(await Bun.file(join(root, name)).exists())) throw new SetupError(`Missing ${name}; run from a complete project checkout.`);
  if (upgrade) for (const tool of ['pg_dump', 'pg_restore'])
    if (!Bun.which(tool)) throw new SetupError(`${tool} is required on PATH. Install PostgreSQL client tools matching your database server major version or newer.`);
  const settings = config();
  const sql = new SQL({url: settings.databaseUrl, connectionTimeout: 10});
  try { await sql`SELECT 1`; }
  catch { throw new SetupError('Cannot connect to PostgreSQL. Check DATABASE_URL, network access, TLS settings, and database permissions.'); }
  finally { await sql.close(); }
  return settings;
}
export async function runQuiet(command: string[], root: string, label: string, env: Record<string,string|undefined> = process.env) {
  const child = Bun.spawn(command, {cwd:root, env, stdout:'ignore', stderr:'ignore'});
  if (await child.exited !== 0) throw new SetupError(`${label} failed. Database credentials and child output are suppressed. Run the documented command directly to diagnose in your private terminal.`);
}
export async function validateCode(root: string) {
  await runQuiet([process.execPath, 'install', '--frozen-lockfile'], root, 'Locked dependency installation (bun install --frozen-lockfile)');
  await runQuiet([process.execPath, 'run', 'typecheck'], root, 'TypeScript validation (bun run typecheck)');
  const env = {...process.env};
  for (const key of ['TEST_DATABASE_URL', 'MIGRATION_TEST_DATABASE_URL', 'BUDGET_INTEGRATION_URL', 'LIFECYCLE_TEST_DATABASE_URL']) env[key] = '';
  await runQuiet([process.execPath, 'test'], root, 'Unit tests (bun test with integration variables unset)', env);
}
export async function backupDatabase(root:string, databaseUrl:string, directory:string) {
  const dir = resolve(root, directory);
  await mkdir(dir, {recursive:true, mode:0o700});
  const info = await stat(dir);
  if (!info.isDirectory() || (info.mode & 0o077)) throw new SetupError('Backup directory must be private (chmod 700), and must not be shared.');
  const final = join(dir, `budget-${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomUUID()}.dump`);
  const partial = final + '.partial';
  const handle = await open(partial, 'wx', 0o600); await handle.close();
  const env = postgresClientEnv(databaseUrl);
  const userArgs = env.PGUSER ? ['--username', env.PGUSER] : [];
  try {
    await runQuiet(['pg_dump', ...userArgs, '--format=custom', '--no-password', '--file', partial], root, 'PostgreSQL backup (pg_dump)', env);
    const info = await stat(partial);
    if (info.size < 32) throw new SetupError('Backup is empty or incomplete.');
    await runQuiet(['pg_restore', '--list', partial], root, 'Backup archive verification (pg_restore --list)', env);
    await runQuiet(['pg_restore', '--file', '/dev/null', partial], root, 'Full backup archive decoding (pg_restore)', env);
    await chmod(partial, 0o600); await rename(partial, final);
    return final;
  } catch {
    throw new SetupError(`Backup failed or could not be verified. No migrations were run. Private incomplete archive retained at ${partial}; inspect or remove it after diagnosis.`);
  }
}
export function postgresClientEnv(databaseUrl: string): Record<string,string|undefined> {
  const url = new URL(databaseUrl);
  const env: Record<string,string|undefined> = {...process.env,
    PGHOST: url.hostname.replace(/^\[|\]$/g, ''), PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username) || process.env.PGUSER,
    PGPASSWORD: decodeURIComponent(url.password),
  };
  delete env.PGHOSTADDR;
  delete env.PGSERVICE;
  delete env.PGSERVICEFILE;
  const options: Record<string,string> = {sslmode:'PGSSLMODE',sslrootcert:'PGSSLROOTCERT',sslcert:'PGSSLCERT',sslkey:'PGSSLKEY',sslcrl:'PGSSLCRL',connect_timeout:'PGCONNECT_TIMEOUT',options:'PGOPTIONS',application_name:'PGAPPNAME',target_session_attrs:'PGTARGETSESSIONATTRS',channel_binding:'PGCHANNELBINDING'};
  for (const [key,value] of url.searchParams) {
    if(!options[key]) throw new SetupError('Database URL contains a connection option unsupported by the backup script. Use documented libpq TLS options.');
    env[options[key]!] = value;
  }
  return env;
}
export function reportFailure(error: unknown) {
  console.error(error instanceof SetupError || error instanceof MigrationError ? error.message : 'Operation failed. No credentials are printed. Check configuration, permissions, and the documented recovery steps.');
  process.exitCode = 1;
}
