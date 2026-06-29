import { Database as BunDatabase } from "bun:sqlite";

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface SqliteStatement {
  run(...params: unknown[]): RunResult;
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}

function normalizeParams(params: unknown[]): unknown[] {
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

class StatementAdapter implements SqliteStatement {
  constructor(private readonly statement: ReturnType<BunDatabase["prepare"]>) {}

  run(...params: unknown[]): RunResult {
    return this.statement.run(...(normalizeParams(params) as any[])) as RunResult;
  }

  all(...params: unknown[]): unknown[] {
    return this.statement.all(...(normalizeParams(params) as any[]));
  }

  get(...params: unknown[]): unknown {
    return this.statement.get(...(normalizeParams(params) as any[]));
  }
}

export class SqliteAdapter {
  readonly raw: BunDatabase;

  constructor(path: string) {
    this.raw = new BunDatabase(path);
    this.raw.exec("PRAGMA busy_timeout = 5000");
    this.raw.exec("PRAGMA foreign_keys = ON");
    this.raw.exec("PRAGMA journal_mode = WAL");
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  prepare(sql: string): SqliteStatement {
    return new StatementAdapter(this.raw.prepare(sql));
  }

  query(sql: string): SqliteStatement {
    return this.prepare(sql);
  }

  run(sql: string, ...params: unknown[]): RunResult {
    return this.raw.prepare(sql).run(...(normalizeParams(params) as any[])) as RunResult;
  }

  all(sql: string, ...params: unknown[]): unknown[] {
    return this.raw.prepare(sql).all(...(normalizeParams(params) as any[]));
  }

  get(sql: string, ...params: unknown[]): unknown {
    return this.raw.prepare(sql).get(...(normalizeParams(params) as any[]));
  }

  transaction<T>(fn: () => T): T {
    return this.raw.transaction(fn)();
  }

  close(): void {
    this.raw.close();
  }
}
