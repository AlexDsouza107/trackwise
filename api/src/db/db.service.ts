import { Global, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow, types } from 'pg';
import { config } from '../config';
import { SCHEMA_SQL } from './schema';

// Parse DATE columns as UTC midnight so month periods and expiry maths are timezone-independent.
types.setTypeParser(1082, (v: string) => new Date(`${v}T00:00:00Z`));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Db');
  readonly pool = new Pool({ connectionString: config.databaseUrl });

  async onModuleInit(): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.pool.query(SCHEMA_SQL);
        this.log.log('Schema ready');
        return;
      } catch (err) {
        if (attempt >= 30) throw err;
        this.log.warn(`Postgres not ready (attempt ${attempt}), retrying...`);
        await sleep(2000);
      }
    }
  }

  onModuleDestroy(): Promise<void> {
    return this.pool.end();
  }

  async query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pool.query<T>(sql, params)).rows;
  }

  async one<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (await this.query<T>(sql, params))[0] ?? null;
  }

  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const out = await fn(client);
      await client.query('commit');
      return out;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }
}

@Global()
@Module({ providers: [DbService], exports: [DbService] })
export class DbModule {}
