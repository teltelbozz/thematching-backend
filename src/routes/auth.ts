// src/routes/auth.ts
import express from 'express';
import type { Pool } from 'pg';
import config from '../config';
import {
  issueAccessToken,
  issueRefreshToken,
  verifyRefresh,
} from '../auth/tokenService';

type LineJWTPayload = {
  sub?: string;       // LINE user id (e.g. Uxxxx)
  name?: string;
  picture?: string;
  [k: string]: unknown;
};

const router = express.Router();

function cookieOpts() {
  return {
    httpOnly: true,
    secure: true,                // Vercel/HTTPS 前提
    sameSite: 'none' as const,
    path: '/',
    maxAge: config.jwt.refreshTtlSec * 1000,
  };
}

// --- users を line_user_id で upsert し、数値 id を返す ------------------
async function ensureUserIdByLineId(db: Pool, lineUserId: string): Promise<number> {
  // 1 クエリで済ませたい場合（updated_at を触る例）
  const upsertSql = `
    INSERT INTO users (line_user_id)
    VALUES ($1)
    ON CONFLICT (line_user_id) DO UPDATE SET updated_at = NOW()
    RETURNING id
  `;
  const r = await db.query(upsertSql, [lineUserId]);
  return r.rows[0].id as number;
}

// --- 共通: トークン発行とクッキー設定 ----------------------------------
async function issueAllTokens(res: express.Response, claims: Record<string, unknown>) {
  const accessToken = await issueAccessToken(claims);
  const refreshToken = await issueRefreshToken(claims);
  res.cookie(config.jwt.refreshCookie, refreshToken, cookieOpts());
  return accessToken;
}

// ==============================
// POST /auth/login
// ==============================
router.post('/login', async (req, res) => {
  try {
    const db = req.app.locals.db as Pool | undefined;
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
      const claims: Record<string, unknown> = {
        uid,                         // ★ 数値の内部ID
        line_user_id,                // 探索用の補助情報（将来デバッグに便利）
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
    if (!id_token) return res.status(400).json({ error: 'Missing id_token' });

    const { verifyLineIdToken } = await import('../auth/lineVerify');
    const v = await verifyLineIdToken(id_token);       // { payload }
    const p = (v as any)?.payload as LineJWTPayload;

    const lineUserId = p?.sub ? String(p.sub) : '';
    if (!lineUserId) {
      console.error('[auth/login] invalid_sub in id_token payload');
      return res.status(400).json({ error: 'invalid_sub' });
    }

    const uid = await ensureUserIdByLineId(db, lineUserId);

    const claims: Record<string, unknown> = {
      uid,                         // ★ 数値の内部ID（ここが最重要）
      line_user_id: lineUserId,
      profile: {
        displayName: p?.name ?? 'LINE User',
        picture: p?.picture ?? null,
      },
    };

    const accessToken = await issueAllTokens(res, claims);
    console.log('[auth/login] LINE verified:', lineUserId, '→ uid=', uid);
    return res.json({ accessToken });
  } catch (e) {
    console.error('[auth/login]', e);
    return res.status(500).json({ error: 'login_failed' });
  }
});

// ==============================
// POST /auth/refresh
// ==============================
router.post('/refresh', async (req, res) => {
  try {
    const token = req.cookies?.[config.jwt.refreshCookie];
    if (!token) return res.status(401).json({ error: 'no_refresh_token' });

    // payload には { uid: number, line_user_id?: string, profile?: {...} } を想定
    const payload = await verifyRefresh(token);

    const accessToken = await issueAccessToken(payload as any);
    const refreshToken = await issueRefreshToken(payload as any);
    res.cookie(config.jwt.refreshCookie, refreshToken, cookieOpts());

    return res.json({ accessToken });
  } catch (e) {
    console.error('[auth/refresh]', e);
    return res.status(401).json({ error: 'refresh_failed' });
  }
});

// ==============================
// POST /auth/logout
// ==============================
router.post('/logout', async (_req, res) => {
  try {
    res.clearCookie(config.jwt.refreshCookie, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[auth/logout]', e);
    return res.status(500).json({ error: 'logout_failed' });
  }
});

export default router;