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
function cookieOpts() {
    return {
        httpOnly: true,
        secure: true, // Vercel/HTTPS 前提
        sameSite: 'none',
        path: '/',
        maxAge: config_1.default.jwt.refreshTtlSec * 1000,
    };
}
// --- users を line_user_id で upsert し、数値 id を返す ------------------
async function ensureUserIdByLineId(db, lineUserId) {
    // 1 クエリで済ませたい場合（updated_at を触る例）
    const upsertSql = `
    INSERT INTO users (line_user_id)
    VALUES ($1)
    ON CONFLICT (line_user_id) DO UPDATE SET updated_at = NOW()
    RETURNING id
  `;
    const r = await db.query(upsertSql, [lineUserId]);
    return r.rows[0].id;
}
// --- 共通: トークン発行とクッキー設定 ----------------------------------
async function issueAllTokens(res, claims) {
    const accessToken = await (0, tokenService_1.issueAccessToken)(claims);
    const refreshToken = await (0, tokenService_1.issueRefreshToken)(claims);
    res.cookie(config_1.default.jwt.refreshCookie, refreshToken, cookieOpts());
    return accessToken;
}
// ==============================
// POST /auth/login
// ==============================
router.post('/login', async (req, res) => {
    try {
        const db = req.app.locals.db;
        if (!db) {
            console.error('[auth/login] db missing on app.locals');
            return res.status(500).json({ error: 'server_misconfigured' });
        }
        // ----------------------------
        // ① 開発モード（DEV_FAKE_AUTH=1）
        // ----------------------------
        if (process.env.DEV_FAKE_AUTH === '1') {
            const { line_user_id, profile } = req.body || {};
            if (!line_user_id || typeof line_user_id !== 'string') {
                return res.status(400).json({ error: 'Missing line_user_id' });
            }
            const uid = await ensureUserIdByLineId(db, line_user_id);
            const claims = {
                uid, // ★ 数値の内部ID
                line_user_id, // 探索用の補助情報（将来デバッグに便利）
                profile: {
                    displayName: profile?.displayName ?? 'Dev User',
                    picture: profile?.picture ?? null,
                },
            };
            const accessToken = await issueAllTokens(res, claims);
            console.log('[auth/login] devAuth OK:', line_user_id, '→ uid=', uid);
            return res.json({ accessToken });
        }
        // ----------------------------
        // ② 本番：LINE IDトークン検証
        // ----------------------------
        const { id_token } = req.body || {};
        if (!id_token)
            return res.status(400).json({ error: 'Missing id_token' });
        const { verifyLineIdToken } = await Promise.resolve().then(() => __importStar(require('../auth/lineVerify')));
        const v = await verifyLineIdToken(id_token); // { payload }
        const p = v?.payload;
        const lineUserId = p?.sub ? String(p.sub) : '';
        if (!lineUserId) {
            console.error('[auth/login] invalid_sub in id_token payload');
            return res.status(400).json({ error: 'invalid_sub' });
        }
        const uid = await ensureUserIdByLineId(db, lineUserId);
        const claims = {
            uid, // ★ 数値の内部ID（ここが最重要）
            line_user_id: lineUserId,
            profile: {
                displayName: p?.name ?? 'LINE User',
                picture: p?.picture ?? null,
            },
        };
        const accessToken = await issueAllTokens(res, claims);
        console.log('[auth/login] LINE verified:', lineUserId, '→ uid=', uid);
        return res.json({ accessToken });
    }
    catch (e) {
        console.error('[auth/login]', e);
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
        // payload には { uid: number, line_user_id?: string, profile?: {...} } を想定
        const payload = await (0, tokenService_1.verifyRefresh)(token);
        const accessToken = await (0, tokenService_1.issueAccessToken)(payload);
        const refreshToken = await (0, tokenService_1.issueRefreshToken)(payload);
        res.cookie(config_1.default.jwt.refreshCookie, refreshToken, cookieOpts());
        return res.json({ accessToken });
    }
    catch (e) {
        console.error('[auth/refresh]', e);
        return res.status(401).json({ error: 'refresh_failed' });
    }
});
// ==============================
// POST /auth/logout
// ==============================
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
