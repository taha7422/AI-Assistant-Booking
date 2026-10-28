import pg from 'pg';
import { env } from './config.js';
export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
export const query = <T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) => pool.query<T>(text, values);
