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
const router = express_1.default.Router();
// Cookie オプションを一元化
const COOKIE_OPTS = {
    httpOnly: true,
    secure: true, // SameSite=None の場合は true 必須
    sameSite: 'none',
    path: config_1.default.cookie.path || '/',
    // domain は必要なときのみ（誤設定は破棄の原因）
    ...(config_1.default.cookie.domain ? { domain: config_1.default.cookie.domain } : {}),
    maxAge: config_1.default.jwt.refreshTtlSec * 1000,
};
function normalizeVerifiedResult(result) {
    const maybe = result && typeof result === 'object' && 'payload' in result
        ? result.payload
        : result;
    if (!maybe || typeof maybe === 'string' || typeof maybe !== 'object') {
        throw new Error('invalid_id_token_payload');
    }
    return maybe;
}
function buildClaimsFromPayload(payload) {
    // JWT の標準クレーム（exp, iat, nbf, iss, aud など）はコピーしない
    // アプリで使うものだけをホワイトリストで取り出す
    const uid = payload?.uid ?? payload?.sub ?? null;
    const profile = payload?.profile ?? undefined;
    const claims = {};
    if (uid != null)
        claims.uid = uid;
    if (profile != null)
        claims.profile = profile;
    return claims;
}
// POST /auth/login
router.post('/login', async (req, res) => {
    try {
        // dev: フェイクログイン（id_token 不要）
        if (config_1.default.devAuth) {
            const { line_user_id, profile } = (req.body || {});
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
            const accessToken = await (0, tokenService_1.issueAccessToken)(claims);
            const refreshToken = await (0, tokenService_1.issueRefreshToken)(claims);
            res.cookie(config_1.default.jwt.refreshCookie, refreshToken, COOKIE_OPTS);
            return res.json({ access_token: accessToken, accessToken }); // 両表記対応
        }
        // prod: LINE IDトークン検証（RS256/JWKS）
        const { id_token } = req.body || {};
        if (!id_token) {
            return res.status(400).json({ error: 'Missing id_token' });
        }
        const { verifyLineIdToken } = await Promise.resolve().then(() => __importStar(require('../auth/lineVerify'))); // 動的 import
        const verified = await verifyLineIdToken(id_token);
        const payload = normalizeVerifiedResult(verified);
        const uid = payload.sub ? String(payload.sub) : '';
        if (!uid)
            return res.status(400).json({ error: 'invalid_sub' });
        const claims = {
            uid,
            profile: {
                displayName: payload.name ?? 'LINE User',
                picture: payload.picture,
            },
        };
        const accessToken = await (0, tokenService_1.issueAccessToken)(claims);
        const refreshToken = await (0, tokenService_1.issueRefreshToken)(claims);
        res.cookie(config_1.default.jwt.refreshCookie, refreshToken, COOKIE_OPTS);
        return res.json({ access_token: accessToken, accessToken });
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
        const token = req.cookies?.[config_1.default.jwt.refreshCookie];
        if (!token)
            return res.status(401).json({ error: 'no_refresh_token' });
        const verified = await (0, tokenService_1.verifyRefreshToken)(token);
        const payload = normalizeVerifiedResult(verified);
        // ★ ここが重要：exp/iat 等を含む元 payload は使わず、アプリ用クレームだけで再発行
        const claims = buildClaimsFromPayload(payload);
        const accessToken = await (0, tokenService_1.issueAccessToken)(claims);
        const refreshToken = await (0, tokenService_1.issueRefreshToken)(claims);
        res.cookie(config_1.default.jwt.refreshCookie, refreshToken, {
            httpOnly: true,
            secure: true, // ← 全経路で統一
            sameSite: 'none', // ← 全経路で統一（クロスオリジン前提）
            path: '/', // ← 明示
            maxAge: config_1.default.jwt.refreshTtlSec * 1000,
        });
        return res.json({ accessToken });
    }
    catch (err) {
        console.error('[auth/refresh]', err);
        return res.status(401).json({ error: 'refresh_failed' });
    }
});
// POST /auth/logout
router.post('/logout', async (_req, res) => {
    try {
        // 消すときも同一オプションで（path/samesite/secure/domain が一致しないと消えない）
        res.clearCookie(config_1.default.jwt.refreshCookie, {
            ...COOKIE_OPTS,
            maxAge: undefined,
        });
        return res.json({ ok: true });
    }
    catch (err) {
        console.error('[auth/logout]', err);
        return res.status(500).json({ error: 'logout_failed' });
    }
});
exports.default = router;
