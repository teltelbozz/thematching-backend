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
const index_js_1 = require("../config/index.js");
const tokenService_js_1 = require("../auth/tokenService.js");
const router = express_1.default.Router();
function normalizeVerifiedResult(result) {
    // jwtVerify の戻りが { payload } でも payload そのものでも両対応
    const maybe = result && typeof result === 'object' && 'payload' in result
        ? result.payload
        : result;
    if (!maybe || typeof maybe === 'string' || typeof maybe !== 'object') {
        throw new Error('invalid_id_token_payload');
    }
    return maybe;
}
// ==============================
// POST /auth/login
// ==============================
router.post('/login', async (req, res) => {
    try {
        // --------------------------------------------------------
        // ① 開発モード（DEV_FAKE_AUTH=1）：LINE検証スキップ
        // --------------------------------------------------------
        if (index_js_1.config.devAuth) {
            const { line_user_id, profile } = req.body || {};
            if (!line_user_id) {
                return res.status(400).json({ error: 'Missing line_user_id' });
            }
            const uid = String(line_user_id);
            const claims = {
                uid,
                profile: {
                    displayName: profile?.displayName ?? 'Dev User',
                    picture: profile?.picture,
                },
            };
            const accessToken = await (0, tokenService_js_1.issueAccessToken)(claims);
            const refreshToken = await (0, tokenService_js_1.issueRefreshToken)(claims);
            res.cookie(index_js_1.config.jwt.refreshCookie, refreshToken, {
                httpOnly: true,
                secure: index_js_1.config.env === 'production',
                sameSite: 'lax',
                maxAge: index_js_1.config.jwt.refreshTtlSec * 1000,
            });
            console.log('[auth/login] devAuth mode OK:', uid);
            return res.json({ accessToken });
        }
        // --------------------------------------------------------
        // ② 本番モード：LINE IDトークンを RS256/JWKS で検証（動的 import）
        // --------------------------------------------------------
        const { id_token } = req.body || {};
        if (!id_token) {
            return res.status(400).json({ error: 'Missing id_token' });
        }
        // 必要になったときだけ読み込み（CJS 環境で j ose を避けるため、検証ロジックは lineVerify.ts で CJS 互換に実装）
        const { verifyLineIdToken } = await Promise.resolve().then(() => __importStar(require('../auth/lineVerify.js')));
        const verified = await verifyLineIdToken(id_token);
        const payload = normalizeVerifiedResult(verified);
        const uid = payload.sub ? String(payload.sub) : '';
        if (!uid) {
            return res.status(400).json({ error: 'invalid_sub' });
        }
        const claims = {
            uid,
            profile: {
                displayName: payload.name ?? 'LINE User', // name/picture はオプショナル
                picture: payload.picture,
            },
        };
        const accessToken = await (0, tokenService_js_1.issueAccessToken)(claims);
        const refreshToken = await (0, tokenService_js_1.issueRefreshToken)(claims);
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
        const verified = await (0, tokenService_js_1.verifyRefreshToken)(token);
        const payload = normalizeVerifiedResult(verified);
        const accessToken = await (0, tokenService_js_1.issueAccessToken)(payload);
        const refreshToken = await (0, tokenService_js_1.issueRefreshToken)(payload);
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
router.post('/logout', async (_req, res) => {
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
