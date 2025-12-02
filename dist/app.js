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
const me_1 = __importDefault(require("./routes/me"));
const matchPrefs_1 = __importDefault(require("./routes/matchPrefs"));
const setup_1 = __importDefault(require("./routes/setup"));
const requireAuth_1 = __importDefault(require("./middleware/requireAuth")); // 既存
const groups_1 = __importDefault(require("./routes/groups"));
const matchCron_1 = __importDefault(require("./cron/matchCron"));
const cron_1 = __importDefault(require("./routes/cron"));
// ★ 追加
const db_1 = require("./db");
const auth_1 = __importDefault(require("./routes/auth"));
const profile_1 = __importDefault(require("./routes/profile"));
const app = (0, express_1.default)();
// Vercel/プロキシ越しでも Secure Cookie を有効化
app.set('trust proxy', 1);
// ★ 追加：ここで必ず DB を差し込む（保険）
app.locals.db = db_1.pool;
app.use((0, morgan_1.default)('combined'));
app.use(express_1.default.json());
app.use((0, cookie_parser_1.default)());
app.use((0, cors_1.default)({
    origin: config_1.default.frontOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.get('/api/health', (_req, res) => {
    res.json({ ok: true, env: config_1.default.env });
});
app.use('/api/auth', auth_1.default);
app.use('/api/profile', profile_1.default);
app.use('/api/me', me_1.default);
app.use('/api/match-prefs', matchPrefs_1.default);
app.use('/api/setup', requireAuth_1.default, setup_1.default);
app.use("/groups", groups_1.default); //参加URL生成
app.use("/cron", matchCron_1.default); // マッチング定期実行
app.use('/cron', cron_1.default);
exports.default = app;
