import {fileURLToPath} from 'node:url';
import {initializeConfig, preflight, validateCode, reportFailure, SetupError} from './lib/lifecycle';
import {migrate} from '../src/server/migrations';
const root = fileURLToPath(new URL('..', import.meta.url));
try {
  if (process.argv.length > 2) throw new SetupError('Usage: bun run setup');
  if (!process.env.DATABASE_URL && await initializeConfig(root))
    throw new SetupError('Created a private .env with a generated API_TOKEN. Set DATABASE_URL to your existing PostgreSQL database, then rerun bun run setup. No secret was printed.');
  await preflight(root);
  console.log('Configuration validated. Installing locked dependencies and checking code…');
  await validateCode(root);
  const result = await migrate(process.env.DATABASE_URL!);
  console.log(`Setup complete. Applied ${result.applied.length} migration(s). Start with bun run start. Use the configured HOST and PORT (defaults: http://127.0.0.1:3000). Enter API_TOKEN from your private configuration to sign in.`);
} catch (error) { reportFailure(error); }
