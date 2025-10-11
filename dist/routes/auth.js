"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/auth.ts
const express_1 = __importDefault(require("express"));
const config_1 = __importDefault(require("../config"));
const tokenService_1 = require("../auth/tokenService");
const router = express_1.default.Router();
/** /api/auth/login */
router.post('/login', async (req, res) => {
    try {
        const { line_user_id, profile } = req.body || {};
        if (!line_user_id) {
            return res.status(400).json({ error: 'Missing line_user_id' });
        }
        const payload = { uid: String(line_user_id), profile };
        const accessToken = await (0, tokenService_1.issueAccessToken)(payload);
        const refreshToken = await (0, tokenService_1.issueRefreshToken)(payload);
        res.cookie(config_1.default.jwt.refreshCookie, refreshToken, {
            httpOnly: true,
            secure: config_1.default.env === 'production',
            sameSite: 'lax',
            maxAge: config_1.default.jwt.refreshTtlSec * 1000,
        });
        return res.json({ accessToken });
    }
    catch (err) {
        console.error('[auth/login]', err);
        return res.status(500).json({ error: 'login_failed' });
    }
});
/** /api/auth/refresh */
router.post('/refresh', async (req, res) => {
    try {
        const rt = req.cookies?.[config_1.default.jwt.refreshCookie];
        if (!rt)
            return res.status(401).json({ error: 'no_refresh_token' });
        const { payload } = await (0, tokenService_1.verifyRefreshToken)(rt);
        const newAccess = await (0, tokenService_1.issueAccessToken)(payload);
        return res.json({ accessToken: newAccess });
    }
    catch (err) {
        console.error('[auth/refresh]', err);
        return res.status(401).json({ error: 'invalid_refresh_token' });
    }
});
/** /api/auth/logout */
router.post('/logout', (req, res) => {
    res.clearCookie(config_1.default.jwt.refreshCookie);
    return res.json({ ok: true });
});
exports.default = router;
