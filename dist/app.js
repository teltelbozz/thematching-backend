"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/app.ts
const express_1 = __importDefault(require("express"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const cors_1 = __importDefault(require("cors"));
const morgan_1 = __importDefault(require("morgan"));
const config_1 = __importDefault(require("./config"));
// ★ 追加: DB プールをここで必ず注入
const db_1 = require("./db");
// ★ ルータ
const auth_1 = __importDefault(require("./routes/auth"));
const profile_1 = __importDefault(require("./routes/profile"));
const app = (0, express_1.default)();
// Vercel/プロキシ越しでも Secure Cookie を有効化
app.set('trust proxy', 1);
// ★ ここで必ず DB を差し込む（どの実行パスでも有効）
app.locals.db = db_1.pool;
// ログ／JSON／Cookie
app.use((0, morgan_1.default)('combined'));
app.use(express_1.default.json());
app.use((0, cookie_parser_1.default)());
// CORS（オリジン固定＋Cookie許可）
app.use((0, cors_1.default)({
    origin: config_1.default.frontOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
// ヘルスチェック
app.get('/api/health', (_req, res) => {
    res.json({ ok: true, env: config_1.default.env });
});
// ルータのマウント
app.use('/api/auth', auth_1.default);
app.use('/api/profile', profile_1.default);
// ------- 診断用（任意） -------
app.get('/api/diag/db', (req, res) => {
    res.json({
        hasDb: !!req.app.locals?.db,
        nodeEnv: process.env.NODE_ENV,
        hasEnv: !!process.env.DATABASE_URL,
    });
});
app.get('/api/diag/routes', (_req, res) => {
    const routes = [];
    const stack = app?._router?.stack ?? [];
    for (const layer of stack) {
        if (layer.route?.path) {
            const methods = Object.keys(layer.route.methods)
                .filter((m) => layer.route.methods[m])
                .map((m) => m.toUpperCase());
            methods.forEach((m) => routes.push({ method: m, path: layer.route.path }));
        }
        else if (layer.name === 'router' && layer.handle?.stack) {
            for (const lr of layer.handle.stack) {
                if (!lr.route?.path)
                    continue;
                const methods = Object.keys(lr.route.methods)
                    .filter((m) => lr.route.methods[m])
                    .map((m) => m.toUpperCase());
                // ベースパスの推測は控えめに
                methods.forEach((m) => routes.push({ method: m, path: lr.route.path }));
            }
        }
    }
    res.json({ routes });
});
// -----------------------------
exports.default = app;
