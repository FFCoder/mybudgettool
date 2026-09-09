import {test, expect} from 'bun:test';
import {mkdtemp, readFile, stat, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config, initializeConfig} from '../scripts/lib/lifecycle';
test('setup creates private config once and preserves existing bytes and secret', async () => {
 const dir=await mkdtemp(join(tmpdir(),'budget-config-'));
 try {
  expect(await initializeConfig(dir)).toBe(true);
  const first=await readFile(join(dir,'.env'),'utf8');
  expect(first).toMatch(/API_TOKEN=[a-f0-9]{64}/);
  expect(first).toContain('DATABASE_URL=\n');
  expect((await stat(join(dir,'.env'))).mode & 0o777).toBe(0o600);
  expect(await initializeConfig(dir)).toBe(false);
  expect(await readFile(join(dir,'.env'),'utf8')).toBe(first);
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('config rejects missing or malformed connection and token without echoing secrets', () => {
 for(const env of [{}, {DATABASE_URL:'postgres://secret:sentinel_password_9381@localhost/db'}, {DATABASE_URL:'https://secret:sentinel_password_9381@host/db',API_TOKEN:'x'.repeat(32)}]) {
  try {config(env); throw new Error('expected failure');} catch(e) {expect(String(e)).not.toContain('sentinel_password_9381');}
 }
 expect(config({DATABASE_URL:'postgres://user:password@localhost/db',API_TOKEN:'x'.repeat(32)}).databaseUrl).toContain('localhost/db');
});

test('backup tools receive discrete libpq fields and preserve TLS options without URI arguments', async () => {
 const {postgresClientEnv}=await import('../scripts/lib/lifecycle');
 const env=postgresClientEnv('postgres://budget:p%40ss@db:5432/plans?sslmode=verify-full&sslrootcert=%2Fcerts%2Fca.pem');
 expect(env.PGHOST).toBe('db');
 expect(env.PGPORT).toBe('5432');
 expect(env.PGDATABASE).toBe('plans');
 expect(env.PGUSER).toBe('budget');
 expect(env.PGPASSWORD).toBe('p@ss');
 expect(env.PGSSLMODE).toBe('verify-full');
 expect(env.PGSSLROOTCERT).toBe('/certs/ca.pem');
 expect(() => postgresClientEnv('postgres://budget@db/plans?unknown=value')).toThrow();
});
