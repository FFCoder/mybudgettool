import web from './src/web/index.html';
import { createApiHandler } from './src/server/api';
import { postgresStore } from './src/server/store';

const databaseUrl = process.env.DATABASE_URL;
const token = process.env.API_TOKEN;
if (!databaseUrl || !token) {
  throw new Error('DATABASE_URL and API_TOKEN are required. Copy .env.example to .env and follow README.md.');
}
const store = postgresStore(databaseUrl);
const api = createApiHandler(store, token);
const server = Bun.serve({
  hostname: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 3000),
  routes: { '/': web },
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/')) return api(request);
    if (path === '/health') return Response.json({ status: 'ok' });
    return new Response('Not found', { status: 404 });
  },
  development: process.env.NODE_ENV !== 'production',
});
console.log(`My Budget App: ${server.url}`);
async function shutdown() {
  await server.stop(true);
  await store.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
