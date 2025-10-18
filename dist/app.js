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
const auth_1 = __importDefault(require("./routes/auth"));
const profile_1 = __importDefault(require("./routes/profile")); // ★ これを追加
const app = (0, express_1.default)();
// 重要：Vercel/プロキシ越しでも Secure Cookie を有効にするため
app.set('trust proxy', 1);
// ログ／JSON／Cookie
app.use((0, morgan_1.default)('combined'));
app.use(express_1.default.json());
app.use((0, cookie_parser_1.default)());
// CORS 設定：オリジン固定＋Cookie許可（※ワイルドカード不可）
app.use((0, cors_1.default)({
    origin: config_1.default.frontOrigin, // 例: https://thematching-frontend.vercel.app
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
// ヘルスチェック
app.get('/api/health', (_req, res) => {
    res.json({ ok: true, env: config_1.default.env });
});
// 認証ルート
app.use('/api/auth', auth_1.default);
// ★ プロフィール系ルート（router.get('/profile', ...) を /api にマウント）
app.use('/api', profile_1.default);
exports.default = app;
