"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/index.ts
require("dotenv/config");
const pg_1 = require("pg");
const app_1 = __importDefault(require("./app"));
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
    ? new pg_1.Pool({
        connectionString: databaseUrl,
        ssl: { rejectUnauthorized: false },
    })
    : undefined;
if (pool) {
    app_1.default.locals.db = pool;
}
else {
    console.warn('[boot] DATABASE_URL is not set. DB routes will fail.');
}
exports.default = app_1.default;
const maybePort = process.env.PORT;
if (maybePort && process.env.NODE_ENV !== 'production') {
    const port = Number(maybePort) || 3000;
    app_1.default.listen(port, () => console.log(`[boot] http://localhost:${port}`));
}
