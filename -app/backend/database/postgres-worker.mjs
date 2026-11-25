import { workerData } from 'node:worker_threads';
import { Client, types } from 'pg';

const { port, connectionString, schema, version } = workerData;
const exactInteger = value => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || BigInt(parsed) !== BigInt(value)) {
    throw new Error('Database integer is outside the supported range.');
  }
  return parsed;
};
types.setTypeParser(20, exactInteger);
types.setTypeParser(1700, exactInteger);
const client = new Client({
  connectionString,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
  lock_timeout: 5000,
  idle_in_transaction_session_timeout: 15000,
});
let connection;
let connectionError;
client.on('error', error => { connectionError = error; });

async function connect() {
  await client.connect();
  await client.query(`SET search_path TO pg_catalog, "${schema}"; SET TIME ZONE 'UTC'`);
  const { rows } = await client.query('SELECT version FROM bizflow_schema_version');
  if (rows.length !== 1 || rows[0].version !== version) {
    const error = new Error('PostgreSQL schema version does not match this release.');
    error.code = 'BIZFLOW_SCHEMA';
    throw error;
  }
}

port.on('message', async ({ sql, params, signal }) => {
  try {
    await (connection ??= connect());
    if (connectionError) throw connectionError;
    if (sql === 'BEGIN IMMEDIATE') {
      await client.query('BEGIN');
      try {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1), 0)', [schema]);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
      port.postMessage({ rows: [] });
    } else {
      const query = sql === 'BEGIN DEFERRED' ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : sql;
      const args = params.map(value => value instanceof Uint8Array ? Buffer.from(value) : value);
      const result = await client.query(query, args);
      const { rows } = Array.isArray(result) ? result.at(-1) : result;
      port.postMessage({ rows: rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'rowid')
        .map(([key, value]) => [key, typeof value === 'boolean' ? Number(value) : value]))) });
    }
  } catch (error) {
    port.postMessage({ error: { code: error.code, position: error.position } });
  } finally {
    const completed = new Int32Array(signal);
    Atomics.store(completed, 0, 1);
    Atomics.notify(completed, 0);
  }
});
