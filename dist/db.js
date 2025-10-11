"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
// src/db.ts
const pg_1 = require("pg");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('Missing env: DATABASE_URL');
}
exports.pool = new pg_1.Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }, // Neon等のマネージドPG向け
});
