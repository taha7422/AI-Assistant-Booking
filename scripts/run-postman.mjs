import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import newman from 'newman';
import pg from 'pg';

const ROOT_DIR = process.cwd();
const API_DIR = path.resolve(ROOT_DIR, 'apps/api');
const POSTMAN_DIR = path.resolve(ROOT_DIR, 'postman');
const ENV_YAML_FILE = path.resolve(POSTMAN_DIR, 'environments/Local Development.environment.yaml');
const COLL_YAML_DIR = path.resolve(POSTMAN_DIR, 'collections/AI Assistant Booking API');
const DEF_YAML_FILE = path.resolve(COLL_YAML_DIR, '.resources/definition.yaml');
const COLL_EXPORT_JSON = path.resolve(POSTMAN_DIR, 'collections/AI Assistant Booking API.postman_collection.json');
const COLL_COMPAT_JSON = path.resolve(POSTMAN_DIR, 'collections/AI Assistant Booking API.json');
const DOCS_EXPORT_JSON = path.resolve(ROOT_DIR, 'docs/postman_collection.json');
const ENV_EXPORT_JSON = path.resolve(POSTMAN_DIR, 'environments/Local Development.postman_environment.json');
const ENV_COMPAT_JSON = path.resolve(POSTMAN_DIR, 'environments/Local.postman_environment.json');

export function loadAndConvertPostmanYaml() {
  if (!fs.existsSync(COLL_YAML_DIR)) throw new Error(`Collection folder not found at ${COLL_YAML_DIR}`);
  if (!fs.existsSync(ENV_YAML_FILE)) throw new Error(`Environment YAML file not found at ${ENV_YAML_FILE}`);
  const envParsed = YAML.parse(fs.readFileSync(ENV_YAML_FILE, 'utf8')) || {};
  const environment = {
    id: 'e9b251a3-2c11-47fb-9bf3-111122223333',
    name: envParsed.name || 'Local Development',
    values: (envParsed.values || []).map((value) => ({ key: value.key, value: String(value.value ?? ''), type: 'default', enabled: true })),
    _postman_variable_scope: 'environment',
  };
  let definition = {};
  if (fs.existsSync(DEF_YAML_FILE)) definition = YAML.parse(fs.readFileSync(DEF_YAML_FILE, 'utf8')) || {};
  const variables = Object.entries(definition.variables || {}).map(([key, value]) => ({ key, value: String(value ?? ''), type: 'string' }));
  const requestFiles = fs.readdirSync(COLL_YAML_DIR).filter((file) => file.endsWith('.request.yaml'));
  if (!requestFiles.length) throw new Error(`No .request.yaml files found in ${COLL_YAML_DIR}`);

  const items = requestFiles.map((file) => {
    const parsed = YAML.parse(fs.readFileSync(path.join(COLL_YAML_DIR, file), 'utf8'));
    const events = (parsed.scripts || []).map((script) => ({
      listen: script.type === 'beforeRequest' ? 'prerequest' : 'test',
      script: { type: 'text/javascript', exec: typeof script.code === 'string' ? script.code.split('\n') : script.code || [] },
    }));
    const headers = Object.entries(parsed.headers || {}).map(([key, value]) => ({ key, value: String(value) }));
    const body = parsed.body ? { mode: 'raw', raw: typeof parsed.body.content === 'string' ? parsed.body.content : JSON.stringify(parsed.body.content || {}) } : undefined;
    let url = parsed.url;
    if (typeof url === 'string') {
      const [rawBase, queryString] = url.split('?');
      const query = parsed.queryParams
        ? Object.entries(parsed.queryParams).map(([key, value]) => ({ key, value: String(value) }))
        : (queryString || '').split('&').filter(Boolean).map((pair) => {
          const [key, value] = pair.split('=');
          return { key: decodeURIComponent(key), value: decodeURIComponent(value || '') };
        });
      url = { raw: parsed.url, host: ['{{baseUrl}}'], path: rawBase.replace(/^{{baseUrl}}\/?/, '').split('/').filter(Boolean), query };
    }
    return {
      order: typeof parsed.order === 'number' ? parsed.order : 0,
      name: parsed.name || file.replace(/\.request\.yaml$/, ''), event: events,
      request: { method: parsed.method || 'GET', header: headers, ...(body ? { body } : {}), url },
    };
  }).sort((a, b) => a.order - b.order).map(({ order: _order, ...item }) => item);

  const collection = {
    info: {
      _postman_id: 'b3e0c7a4-1234-4567-89ab-cdef01234567',
      name: path.basename(COLL_YAML_DIR),
      description: definition.description || 'AI Assistant Booking API',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: variables,
    item: items,
  };
  return { collection, environment };
}

function testDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error('TEST_DATABASE_URL is required. Point it to a disposable local PostgreSQL database whose name ends in _test.');
  const url = new URL(value);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !databaseName.endsWith('_test')) {
    throw new Error('Refusing Postman tests: TEST_DATABASE_URL must use a loopback host and a database name ending in _test.');
  }
  return { value, databaseName };
}

function runDatabaseCommand(action, env) {
  execFileSync(process.execPath, ['--import', 'tsx', 'src/db-cli.ts', action], { cwd: API_DIR, env, stdio: 'inherit' });
}

function runNewman(collection, environment, baseUrl, userEmail, multiUserEmail) {
  const values = environment.values.map((value) => ({ ...value }));
  const set = (key, value) => {
    const existing = values.find((item) => item.key === key);
    if (existing) existing.value = value;
    else values.push({ key, value, type: 'default', enabled: true });
  };
  set('baseUrl', baseUrl);
  set('userEmail', userEmail);
  set('multiUserEmail', multiUserEmail);
  set('testPassword', `Postman-${randomBytes(16).toString('hex')}7A`);
  environment.values = values;
  return new Promise((resolve, reject) => {
    newman.run({ collection, environment, reporters: 'cli', reporter: { cli: { noBanner: true } } }, (error, summary) => {
      if (error) return reject(error);
      if (summary.run.failures.length) return reject(new Error(`Newman completed with ${summary.run.failures.length} failed assertion(s).`));
      resolve(summary.run.stats);
    });
  });
}

async function waitForApi(baseUrl, child, runId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Test API exited during startup with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1000) });
      const body = await response.json();
      if (response.ok && body.status === 'ok' && body.database === 'connected' && body.testRunId === runId) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The isolated test API did not become healthy within 10 seconds.');
}

async function main() {
  console.log('--- Isolated Postman Test Runner ---');
  const { collection, environment } = loadAndConvertPostmanYaml();
  const collectionText = JSON.stringify(collection, null, 2);
  const environmentText = JSON.stringify(environment, null, 2);
  fs.writeFileSync(COLL_EXPORT_JSON, collectionText);
  fs.writeFileSync(COLL_COMPAT_JSON, collectionText);
  fs.writeFileSync(DOCS_EXPORT_JSON, collectionText);
  fs.writeFileSync(ENV_EXPORT_JSON, environmentText);
  fs.writeFileSync(ENV_COMPAT_JSON, environmentText);
  console.log(`Converted ${collection.item.length} requests. Newman will run; no skip mode exists.`);
  if (process.argv.includes('--export-only')) {
    console.log('Export-only mode requested; Newman was not run.');
    return;
  }

  const { value: databaseUrl, databaseName } = testDatabaseUrl();
  const runId = randomUUID();
  const userEmail = `postman-${runId}@example.test`;
  const multiUserEmail = `postman-multi-${runId}@example.test`;
  const port = Number(process.env.POSTMAN_API_PORT || 4199);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('POSTMAN_API_PORT must be a valid unprivileged TCP port.');
  const baseUrl = `http://127.0.0.1:${port}`;
  const testEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    PORT: String(port),
    JWT_SECRET: randomBytes(32).toString('hex'),
    AI_PROVIDER: 'mock',
    GROQ_API_KEY: '',
    NODE_ENV: 'test',
    TEST_RUN_ID: runId,
    FRONTEND_ORIGIN: 'http://127.0.0.1:3000',
  };
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5000 });
  let api;
  let originalError;
  try {
    const identity = await pool.query('SELECT current_database() AS name, inet_server_addr() AS address');
    if (identity.rows[0]?.name !== databaseName || !identity.rows[0]?.address) throw new Error('TEST_DATABASE_URL did not connect to the expected local PostgreSQL database.');
    const existingTables = await pool.query(`
      SELECT to_regclass('public.users') IS NOT NULL AS users_exists,
             to_regclass('public.appointments') IS NOT NULL AS appointments_exists
    `);
    const { users_exists: usersExist, appointments_exists: appointmentsExist } = existingTables.rows[0];
    if (usersExist !== appointmentsExist) throw new Error('Refusing to migrate a partially initialized test database. Use an empty disposable database.');
    if (usersExist) {
      const preflight = await pool.query('SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM appointments) AS appointments');
      if (Number(preflight.rows[0].users) || Number(preflight.rows[0].appointments)) {
        throw new Error('Refusing to migrate a non-empty test database. Use a fresh disposable *_test database.');
      }
    }
    runDatabaseCommand('migrate', testEnv);
    runDatabaseCommand('seed', testEnv);
    const counts = await pool.query('SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM appointments) AS appointments');
    if (Number(counts.rows[0].users) || Number(counts.rows[0].appointments)) {
      throw new Error('Refusing to run against a non-empty test database. Use a fresh disposable *_test database.');
    }

    api = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { cwd: API_DIR, env: testEnv, stdio: 'inherit' });
    await waitForApi(baseUrl, api, runId);
    console.log(`Test API is healthy against local database ${databaseName}; assistant mode is mock and makes no external provider calls.`);
    if (process.argv.includes('--integration')) {
      const result = spawnSync(process.execPath, ['scripts/full-integration-test.mjs'], {
        cwd: ROOT_DIR,
        env: { ...testEnv, AI_BOOKING_API_URL: baseUrl, AI_BOOKING_TEST_HARNESS: 'isolated' },
        stdio: 'inherit',
      });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`Full integration suite failed with exit code ${result.status}.`);
      console.log('Full isolated integration suite passed.');
    } else {
      const stats = await runNewman(collection, environment, baseUrl, userEmail, multiUserEmail);
      console.log(`Postman passed: ${stats.requests.total} requests, ${stats.assertions.total} assertions, 0 failures.`);
    }
  } catch (error) {
    originalError = error;
    throw error;
  } finally {
    if (api && api.exitCode === null) {
      api.kill('SIGTERM');
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 3000);
        api.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
    try {
      if (process.argv.includes('--integration')) await pool.query('DELETE FROM users');
      else await pool.query('DELETE FROM users WHERE email = ANY($1::text[])', [[userEmail, multiUserEmail]]);
      const remaining = process.argv.includes('--integration')
        ? await pool.query('SELECT count(*)::int AS count FROM users')
        : await pool.query('SELECT count(*)::int AS count FROM users WHERE email = ANY($1::text[])', [[userEmail, multiUserEmail]]);
      if (remaining.rows[0]?.count) throw new Error('Isolated test data cleanup did not complete.');
    } catch (cleanupError) {
      if (!originalError) throw cleanupError;
      console.error('Test data cleanup failed; the data remains only in the disposable *_test database.');
    } finally {
      await pool.end();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Postman test run failed: ${error.message}`);
    process.exitCode = 1;
  });
}
