// src/db.ts
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('Missing env: DATABASE_URL');
}

export const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }, // Neon等のマネージドPG向け
});