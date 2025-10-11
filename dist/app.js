"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const morgan_1 = __importDefault(require("morgan"));
const devAuth_1 = require("./middleware/devAuth");
// 既存のルート群（実装済みのものだけ import してください）
const auth_1 = __importDefault(require("./routes/auth"));
const profile_1 = __importDefault(require("./routes/profile"));
const prefs_1 = __importDefault(require("./routes/prefs"));
const setup_1 = __importDefault(require("./routes/setup"));
// もし他にもあればここで import
// import slotsRoutes from './routes/slots';
// import matchesRoutes from './routes/matches';
// import chatsRoutes from './routes/chats';
const app = (0, express_1.default)();
// 逆プロキシ（Vercel/Proxy）前提なら
app.set('trust proxy', 1);
// ログ
app.use((0, morgan_1.default)(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
// CORS
app.use((0, cors_1.default)({
    origin: process.env.FRONT_ORIGIN, // 例: https://thematching-frontend.vercel.app
    credentials: true,
}));
// Body
app.use(express_1.default.json({ limit: '1mb' }));
// devAuth（※必ず /api/* ルートより前に）
app.use(devAuth_1.devAuth);
// ---- ヘルスチェック ----
app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
});
app.get('/api/health/ping', (_req, res) => {
    res.type('text').send('pong');
});
// ---- 既存APIルート ----
app.use('/api/auth', auth_1.default);
app.use('/api/profile', profile_1.default);
app.use('/api/prefs', prefs_1.default);
app.use('/api/setup', setup_1.default);
// app.use('/api/slots', slotsRoutes);
// app.use('/api/matches', matchesRoutes);
// app.use('/api/chats', chatsRoutes);
// 404
app.use((req, res) => {
    res.status(404).json({ error: 'not_found', path: req.path });
});
// エラーハンドラ
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err, _req, res, _next) => {
    console.error('[app:error]', err);
    const status = err?.status || 500;
    res.status(status).json({ error: 'server_error', message: err?.message || 'internal_error' });
});
exports.default = app;
