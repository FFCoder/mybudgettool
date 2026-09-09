import {fileURLToPath} from 'node:url';
import {preflight, validateCode, backupDatabase, reportFailure, SetupError} from './lib/lifecycle';
import {migrate} from '../src/server/migrations';
const root = fileURLToPath(new URL('..', import.meta.url));
let backup: string | undefined;
try {
  const args = process.argv.slice(2);
  let maintenance = false, dir = 'backups';
  for(let i=0;i<args.length;i++) {
    if(args[i] === '--maintenance-confirmed') maintenance = true;
    else if(args[i] === '--backup-dir' && args[i+1] && !args[i+1]!.startsWith('--')) dir = args[++i]!;
    else throw new SetupError('Usage: bun run upgrade --maintenance-confirmed [--backup-dir PATH]');
  }
  if(!maintenance) throw new SetupError('Stop this app and other database writers first. Then run bun run upgrade --maintenance-confirmed [--backup-dir PATH]. This script cannot stop your process manager.');
  const settings = await preflight(root, true);
  console.log('Preflight passed. Creating and verifying a private PostgreSQL backup…');
  backup = await backupDatabase(root, settings.databaseUrl, dir);
  console.log(`Verified backup: ${backup}`);
  await validateCode(root);
  const result = await migrate(settings.databaseUrl);
  console.log(`Upgrade complete. Applied ${result.applied.length} migration(s). Restart your app with bun run start or your existing process manager, then verify it before allowing writes.`);
} catch(error) {
  reportFailure(error);
  if(backup) console.error(`Backup retained: ${backup}. Keep writers stopped. See docs/operations.md for recovery to a separate empty database. Code/dependency changes are not automatically rolled back.`);
}
