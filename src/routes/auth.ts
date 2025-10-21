// src/routes/auth.ts
import express from 'express';
import config from '../config';
import {
  issueAccessToken,
  issueRefreshToken,
  verifyRefresh,
} from '../auth/tokenService';
import { pool as defaultPool } from '../db';

type LineJWTPayload = {
  sub?: string;
  name?: string;
  picture?: string;
  [k: string]: unknown;
};

const router = express.Router();

function cookieOpts() {
  return {
    httpOnly: true,
    secure: true as const,   // Vercel/HTTPS 前提
    sameSite: 'none' as const,
    path: '/',
    maxAge: config.jwt.refreshTtlSec * 1000,
  };
}

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    // DB フォールバック（app.locals.db が無い場合でも pool を使う）
    const db = (req.app?.locals?.db ?? defaultPool);
    if (!db) {
      console.error('[auth/login] no DB pool available');
      return res.status(500).json({ error: 'server_misconfigured' });
    }

    // 開発モード：IDトークン検証スキップ
    if (process.env.DEV_FAKE_AUTH === '1') {
      const { line_user_id, profile } = req.body || {};
      if (!line_user_id) return res.status(400).json({ error: 'Missing line_user_id' });

      // ここでも内部IDに解決しておく
      let userId: number | null = null;
      const sel = await db.query('SELECT id FROM users WHERE line_user_id = $1', [String(line_user_id)]);
      if (sel.rows[0]?.id) {
        userId = sel.rows[0].id;
      } else {
        const ins = await db.query(
          'INSERT INTO users (line_user_id) VALUES ($1) RETURNING id',
          [String(line_user_id)],
        );
        userId = ins.rows[0].id;
      }

      const claims = {
        uid: userId, // ← 数値IDを格納
        profile: {
          displayName: profile?.displayName ?? 'Dev User',
          picture: profile?.picture ?? null,
        },
      };
      const accessToken = await issueAccessToken(claims);
      const refreshToken = await issueRefreshToken(claims);
      res.cookie(config.jwt.refreshCookie, refreshToken, cookieOpts());
      console.log('[auth/login] devAuth OK:', line_user_id, '-> uid:', userId);
      return res.json({ accessToken });
    }

    // 本番：LINE ID トークン検証
    const { id_token } = req.body || {};
    if (!id_token) return res.status(400).json({ error: 'Missing id_token' });

    const { verifyLineIdToken } = await import('../auth/lineVerify');
    const { payload } = await verifyLineIdToken(id_token);
    const verified = payload as LineJWTPayload;

    const lineSub = verified?.sub ? String(verified.sub) : '';
    if (!lineSub) {
      console.error('[auth/login] invalid_sub in id_token payload:', verified);
      return res.status(400).json({ error: 'invalid_sub' });
    }

    // ★ sub -> users.id（数値）に解決（なければ INSERT）
    let userId: number | null = null;
    const r1 = await db.query('SELECT id FROM users WHERE line_user_id = $1', [lineSub]);
    if (r1.rows[0]?.id) {
      userId = r1.rows[0].id;
    } else {
      const r2 = await db.query(
        'INSERT INTO users (line_user_id) VALUES ($1) RETURNING id',
        [lineSub],
      );
      userId = r2.rows[0].id;
    }

    const claims = {
      uid: userId, // ← 数値ID
      profile: {
        displayName: verified.name ?? 'LINE User',
        picture: verified.picture ?? null,
      },
    };

    const accessToken = await issueAccessToken(claims);
    const refreshToken = await issueRefreshToken(claims);
    res.cookie(config.jwt.refreshCookie, refreshToken, cookieOpts());

    console.log('[auth/login] LINE verified:', lineSub, '-> uid:', userId);
    return res.json({ accessToken });
  } catch (e) {
    console.error('[auth/login]', e);
    return res.status(500).json({ error: 'login_failed' });
  }
});

// POST /auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    const token = req.cookies?.[config.jwt.refreshCookie];
    if (!token) return res.status(401).json({ error: 'no_refresh_token' });

    // tokenService.verifyRefresh は { payload } でなく “payload本体” を返す契約
    const payload = await verifyRefresh(token);

    // サーバ生成トークンには exp/iAT は含めない（jsonwebtoken のエラー回避）
    const { exp, iat, nbf, ...claims } = (payload || {}) as Record<string, unknown>;

    const accessToken = await issueAccessToken(claims);
    const refreshToken = await issueRefreshToken(claims);
    res.cookie(config.jwt.refreshCookie, refreshToken, cookieOpts());
    return res.json({ accessToken });
  } catch (e) {
    console.error('[auth/refresh]', e);
    return res.status(401).json({ error: 'refresh_failed' });
  }
});

// POST /auth/logout
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