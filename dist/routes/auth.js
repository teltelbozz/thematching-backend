"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const index_js_1 = require("../config/index.js");
const tokenService_js_1 = require("../auth/tokenService.js");
const lineVerify_js_1 = require("../auth/lineVerify.js");
const router = express_1.default.Router();
// ==============================
// POST /auth/login
// ==============================
router.post('/login', async (req, res) => {
    try {
        // --------------------------------------------------------
        // ① 開発モード（DEV_FAKE_AUTH=1）の場合：LINE検証をスキップ
        // --------------------------------------------------------
        if (index_js_1.config.devAuth) {
            const { line_user_id, profile } = req.body || {};
            if (!line_user_id) {
                return res.status(400).json({ error: 'Missing line_user_id' });
            }
            const payload = { uid: String(line_user_id), profile };
            const accessToken = (0, tokenService_js_1.issueAccessToken)(payload);
            const refreshToken = (0, tokenService_js_1.issueRefreshToken)(payload);
            res.cookie(index_js_1.config.jwt.refreshCookie, refreshToken, {
                httpOnly: true,
                secure: index_js_1.config.env === 'production',
                sameSite: 'lax',
                maxAge: index_js_1.config.jwt.refreshTtlSec * 1000,
            });
            console.log('[auth/login] devAuth mode OK:', line_user_id);
            return res.json({ accessToken });
        }
        // --------------------------------------------------------
        // ② 本番モード：LINEのIDトークンを検証
        // --------------------------------------------------------
        const { id_token } = req.body || {};
        if (!id_token) {
            return res.status(400).json({ error: 'Missing id_token' });
        }
        const payload = await (0, lineVerify_js_1.verifyLineIdToken)(id_token);
        const uid = String(payload.sub);
        const profile = {
            displayName: payload.name,
            picture: payload.picture,
        };
        const accessToken = (0, tokenService_js_1.issueAccessToken)({ uid, profile });
        const refreshToken = (0, tokenService_js_1.issueRefreshToken)({ uid, profile });
        res.cookie(index_js_1.config.jwt.refreshCookie, refreshToken, {
            httpOnly: true,
            secure: index_js_1.config.env === 'production',
            sameSite: 'lax',
            maxAge: index_js_1.config.jwt.refreshTtlSec * 1000,
        });
        console.log('[auth/login] LINE verified:', uid);
        return res.json({ accessToken });
    }
    catch (err) {
        console.error('[auth/login]', err);
        return res.status(500).json({ error: 'login_failed' });
    }
});
// ==============================
// POST /auth/refresh
// ==============================
router.post('/refresh', async (req, res) => {
    try {
        const token = req.cookies?.[index_js_1.config.jwt.refreshCookie];
        if (!token)
            return res.status(401).json({ error: 'no_refresh_token' });
        const payload = (0, tokenService_js_1.verifyRefreshToken)(token);
        const accessToken = (0, tokenService_js_1.issueAccessToken)(payload);
        const refreshToken = (0, tokenService_js_1.issueRefreshToken)(payload);
        res.cookie(index_js_1.config.jwt.refreshCookie, refreshToken, {
            httpOnly: true,
            secure: index_js_1.config.env === 'production',
            sameSite: 'lax',
            maxAge: index_js_1.config.jwt.refreshTtlSec * 1000,
        });
        return res.json({ accessToken });
    }
    catch (err) {
        console.error('[auth/refresh]', err);
        return res.status(401).json({ error: 'refresh_failed' });
    }
});
// ==============================
// POST /auth/logout
// ==============================
router.post('/logout', async (req, res) => {
    try {
        res.clearCookie(index_js_1.config.jwt.refreshCookie);
        return res.json({ ok: true });
    }
    catch (err) {
        console.error('[auth/logout]', err);
        return res.status(500).json({ error: 'logout_failed' });
    }
});
exports.default = router;
