// src/index.ts
import 'dotenv/config';
import { Pool } from 'pg';
import app from './app';

const databaseUrl = process.env.DATABASE_URL;

const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false },
    })
  : undefined;

if (pool) {
  app.locals.db = pool;
} else {
  console.warn('[boot] DATABASE_URL is not set. DB routes will fail.');
}

export default app;

const maybePort = process.env.PORT;
if (maybePort && process.env.NODE_ENV !== 'production') {
  const port = Number(maybePort) || 3000;
  app.listen(port, () => console.log(`[boot] http://localhost:${port}`));
}