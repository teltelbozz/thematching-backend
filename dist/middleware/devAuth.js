"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.devAuth = devAuth;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../db"); // pg Pool を使っている前提（既存と同じ）
const DEV_ON = process.env.DEV_FAKE_AUTH === '1';
const DEV_KEY = process.env.DEV_FAKE_AUTH_KEY || '';
async function devAuth(req, res, next) {
    if (!DEV_ON)
        return next(); // 本番などOFF時は素通し
    try {
        // 誤用防止（オリジンと鍵）
        const origin = String(req.headers.origin || '');
        const allowed = process.env.FRONT_ORIGIN || '';
        if (!allowed || !origin.startsWith(allowed))
            return next();
        if (DEV_KEY) {
            const clientKey = req.header('x-dev-auth-key') || '';
            if (clientKey !== DEV_KEY)
                return next();
        }
        // 擬似ユーザID（例: "dev:aki"）を受け取った時だけ発動
        const fakeLineUserId = req.header('x-dev-line-user-id');
        if (!fakeLineUserId)
            return next();
        const line_uid = String(fakeLineUserId);
        const email = `${crypto_1.default.createHash('sha1').update(line_uid).digest('hex')}@dev.local`;
        // users に upsert（line_user_id は一意の想定）
        const u = await db_1.pool.query(`insert into users(line_user_id, email)
       values($1, $2)
       on conflict (line_user_id) do update set email = excluded.email
       returning id, line_user_id`, [line_uid, email]);
        // 認証済みユーザとして注入（下流ルートで利用）
        req.user = {
            id: u.rows[0].id,
            line_user_id: u.rows[0].line_user_id,
            is_dev: true,
        };
        res.setHeader('X-Dev-Auth', '1'); // 視覚化
        return next();
    }
    catch (e) {
        console.error('[devAuth] failed', e);
        return next(); // 失敗しても通常フローに影響させない
    }
}
