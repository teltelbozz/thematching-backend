"use strict";
// backend/src/index.ts
// 役割：DB(Pool) を初期化して app.locals.db にセット → 環境に応じて export or listen
// ESM 実行前提（package.json の "type":"module"）。import の拡張子に .js を付けること。
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/index.ts
require("dotenv/config");
const dotenv_1 = __importDefault(require("dotenv"));
const fs_1 = __importDefault(require("fs"));
// .env.local を優先して上書き（開発時のみ）
if (process.env.NODE_ENV !== 'production' && fs_1.default.existsSync('.env.local')) {
    dotenv_1.default.config({ path: '.env.local', override: true });
    console.log('[env] loaded .env.local (override)');
}
const pg_1 = require("pg");
const app_1 = __importDefault(require("./app"));
// ---- DB 初期化 -------------------------------------------------------------
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    console.warn('[boot] DATABASE_URL is not set. API routes using DB may fail.');
}
/**
 * Neon(Postgres) を想定。
 * - Vercel/Neon は SSL 必須なので rejectUnauthorized: false を付与（Neon側のCAで検証済み）
 * - 他のPostgresなら ssl オプションは環境に合わせて変更
 */
const pool = new pg_1.Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl ? { rejectUnauthorized: false } : undefined,
});
// ★ 最重要：devAuth を通る前に db を差し込む
app_1.default.locals.db = pool;
// ---- エクスポート / ローカル起動 -------------------------------------------
/**
 * Vercel(Serverless)では「デフォルトエクスポートされた Express アプリ」が実行対象。
 * そのため listen() は不要。export default だけ行う。
 */
exports.default = app_1.default;
/**
 * ローカル開発で `node dist/index.js` や `ts-node src/index.ts` を直接叩く場合は
 * PORT が与えられている時だけ listen する。
 * （Vercel 実行時は PORT は不要＆与えない）
 */
const maybePort = process.env.PORT;
if (maybePort && process.env.NODE_ENV !== 'production') {
    const port = Number(maybePort) || 3000;
    app_1.default.listen(port, () => {
        console.log(`[boot] server started on http://localhost:${port}`);
    });
}
// ---- 終了時ハンドリング（任意。接続のクリーンアップ） -----------------------
function gracefulShutdown() {
    // Serverless では自動で破棄されるが、ローカル常駐プロセスでは明示的に閉じる
    pool.end().catch((e) => console.warn('[boot] pool.end() error:', e?.message || e));
}
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
