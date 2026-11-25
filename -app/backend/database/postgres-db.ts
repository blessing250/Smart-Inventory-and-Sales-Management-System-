import { join } from 'node:path';
import { MessageChannel, receiveMessageOnPort, Worker } from 'node:worker_threads';
import type { SQLInputValue } from 'node:sqlite';
import { migrations } from './business-schema';

type QueryReply = { rows: Record<string, unknown>[] } | { error: { code?: string; position?: string } };

export function postgresQuery(sql: string) {
  let index = 0;
  return sql.replace(/date\(([a-z_.]+),\s*'\+2 hours'\)/gi,
    "to_char(($1::timestamptz AT TIME ZONE 'UTC') + interval '2 hours', 'YYYY-MM-DD')")
    .replace(/\bCOLLATE NOCASE\b/g, 'COLLATE bizflow_nocase')
    .replace(/\bGROUP_CONCAT\(/gi, 'string_agg(')
    .replace(/'(?:''|[^'])*'|"(?:[^"]|"")*"|\?/g, token => token === '?' ? `$${++index}` : token);
}

export class PostgresDatabase {
  private readonly port;
  private readonly worker;
  private closed = false;

  constructor(connectionString: string, schema: string) {
    if (!/^[a-z][a-z0-9_]{0,47}$/.test(schema) || schema.startsWith('pg_')) {
      throw new Error('Invalid BizFlow PostgreSQL schema name.');
    }
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.worker = new Worker(join(process.cwd(), 'backend/database/postgres-worker.mjs'), {
      transferList: [channel.port2],
      workerData: { port: channel.port2, connectionString, schema, version: migrations.length },
    });
    this.worker.on('error', () => this.close());
    this.worker.unref();
    this.port.unref();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.port.close();
    void this.worker.terminate();
  }

  private query(sql: string, params: SQLInputValue[]) {
    if (this.closed) throw new Error('PostgreSQL connection closed.');
    const signal = new SharedArrayBuffer(4);
    this.port.postMessage({ sql, params, signal });
    if (Atomics.wait(new Int32Array(signal), 0, 0, 15_000) === 'timed-out') {
      this.close();
      throw new Error('PostgreSQL database request timed out.');
    }
    const reply = receiveMessageOnPort(this.port)?.message as QueryReply | undefined;
    if (!reply) throw new Error('PostgreSQL response unavailable.');
    if ('error' in reply) {
      throw Object.assign(new Error('PostgreSQL database request failed.'), reply.error);
    }
    return reply.rows;
  }

  exec(sql: string) {
    this.query(postgresQuery(sql), []);
  }

  prepare(sql: string) {
    const query = postgresQuery(sql);
    return {
      all: (...params: SQLInputValue[]) => this.query(query, params),
      get: (...params: SQLInputValue[]) => this.query(query, params)[0],
      run: (...params: SQLInputValue[]) => { this.query(query, params); },
    };
  }
}
