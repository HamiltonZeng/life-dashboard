import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
export function createPool() {
  return new pg.Pool({host: process.env.DATABASE_HOST ?? 'postgres', port: 5432,
    database: process.env.DATABASE_NAME ?? 'life_dashboard', user: process.env.DATABASE_USER ?? 'life_dashboard',
    password: process.env.POSTGRES_PASSWORD, max: 8});
}
export function createDb(pool: pg.Pool) { return drizzle(pool); }
export type Client = pg.PoolClient;
