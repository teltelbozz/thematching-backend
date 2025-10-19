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
const profile_1 = __importDefault(require("./routes/profile"));
const app = (0, express_1.default)();
app.set('trust proxy', 1);
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
// 診断: ルート一覧
app.get('/api/diag/routes', (_req, res) => {
    const routes = [];
    const stack = app?._router?.stack ?? [];
    for (const layer of stack) {
        if (layer.route?.path) {
            const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
            for (const m of methods)
                routes.push({ method: m.toUpperCase(), path: layer.route.path });
        }
        else if (layer.name === 'router' && layer.handle?.stack) {
            for (const lr of layer.handle.stack) {
                if (!lr.route?.path)
                    continue;
                const methods = Object.keys(lr.route.methods).filter((m) => lr.route.methods[m]);
                const base = (layer?.regexp?.fast_star && '*') ||
                    (layer?.regexp?.fast_slash && '/') ||
                    (layer?.regexp?.source?.includes('\\/api') ? '/api' : '');
                for (const m of methods)
                    routes.push({ method: m.toUpperCase(), path: `${base}${lr.route.path}` });
            }
        }
    }
    res.json({ routes });
});
exports.default = app;
