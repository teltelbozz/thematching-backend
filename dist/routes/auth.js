"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/auth.ts
const express_1 = __importDefault(require("express"));
const config_1 = __importDefault(require("../config"));
const tokenService_1 = require("../auth/tokenService");
const db_1 = require("../db");
const router = express_1.default.Router();
function cookieOpts() {
    return {
        httpOnly: true,
        secure: true, // Vercel/HTTPS 前提
        sameSite: 'none',
        path: '/',
        maxAge: config_1.default.jwt.refreshTtlSec * 1000,
    };
}
// POST /auth/login
router.post('/login', async (req, res) => {
    try {
        // --- DB フォールバック（app.locals.db が無い場合でも pool を使う）---
        let db = req.app?.locals?.db ?? db_1.pool;
        if (!db) {
            console.error('[auth/login] no DB pool available');
            return res.status(500).json({ error: 'server_misconfigured' });
        }
        // ここで db を使う将来拡張に備えて残しています（現状は未使用）
        // 開発モード：IDトークン検証スキップ
        if (process.env.DEV_FAKE_AUTH === '1') {
            const { line_user_id, profile } = req.body || {};
            if (!line_user_id) {
                return res.status(400).json({ error: 'Missing line_user_id' });
            }
            const claims = {
                uid: String(line_user_id),
                profile: {
                    displayName: profile?.displayName ?? 'Dev User',
                    picture: profile?.picture ?? null,
                },
            };
            const accessToken = await (0, tokenService_1.issueAccessToken)(claims);
            const refreshToken = await (0, tokenService_1.issueRefreshToken)(claims);
            res.cookie(config_1.default.jwt.refreshCookie, refreshToken, cookieOpts());
            console.log('[auth/login] devAuth OK:', line_user_id);
            return res.json({ accessToken });
        }
        // 本番：LINE ID トークン検証
        const { id_token } = req.body || {};
        if (!id_token) {
            return res.status(400).json({ error: 'Missing id_token' });
        }
        // 遅延 import（CJS/ESM 問題回避）
        const { verifyLineIdToken } = await Promise.resolve().then(() => __importStar(require('../auth/lineVerify')));
        // lineVerify は { payload } を返す契約
        const { payload } = await verifyLineIdToken(id_token);
        const verified = payload;
        const uid = verified?.sub ? String(verified.sub) : '';
        if (!uid) {
            console.error('[auth/login] invalid_sub in id_token payload:', verified);
            return res.status(400).json({ error: 'invalid_sub' });
        }
        const claims = {
            uid,
            profile: {
                displayName: verified.name ?? 'LINE User',
                picture: verified.picture ?? null,
            },
        };
        const accessToken = await (0, tokenService_1.issueAccessToken)(claims);
        const refreshToken = await (0, tokenService_1.issueRefreshToken)(claims);
        res.cookie(config_1.default.jwt.refreshCookie, refreshToken, cookieOpts());
        console.log('[auth/login] LINE verified:', uid);
        return res.json({ accessToken });
    }
    catch (e) {
        console.error('[auth/login]', e);
        return res.status(500).json({ error: 'login_failed' });
    }
});
// POST /auth/refresh
router.post('/refresh', async (req, res) => {
    try {
        const token = req.cookies?.[config_1.default.jwt.refreshCookie];
        if (!token)
            return res.status(401).json({ error: 'no_refresh_token' });
        // tokenService.verifyRefresh は { payload } でなく “payload本体” を返す契約
        const payload = await (0, tokenService_1.verifyRefresh)(token);
        // サーバ生成トークンには exp/iAT は含めない（jsonwebtoken のエラー回避）
        const { exp, iat, nbf, ...claims } = (payload || {});
        const accessToken = await (0, tokenService_1.issueAccessToken)(claims);
        const refreshToken = await (0, tokenService_1.issueRefreshToken)(claims);
        res.cookie(config_1.default.jwt.refreshCookie, refreshToken, cookieOpts());
        return res.json({ accessToken });
    }
    catch (e) {
        console.error('[auth/refresh]', e);
        return res.status(401).json({ error: 'refresh_failed' });
    }
});
// POST /auth/logout
router.post('/logout', async (_req, res) => {
    try {
        res.clearCookie(config_1.default.jwt.refreshCookie, {
            httpOnly: true,
            secure: true,
            sameSite: 'none',
            path: '/',
        });
        return res.json({ ok: true });
    }
    catch (e) {
        console.error('[auth/logout]', e);
        return res.status(500).json({ error: 'logout_failed' });
    }
});
exports.default = router;
