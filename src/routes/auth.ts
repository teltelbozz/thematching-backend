// src/routes/auth.ts
import express from 'express';
import config from '../config';
import {
  issueAccessToken,
  issueRefreshToken,
  verifyRefresh,
} from '../auth/tokenService';

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
    secure: true,                 // Vercel/HTTPS 前提
    sameSite: 'none' as const,    // クロスサイトでクッキーを返すために必須
    path: '/',
    maxAge: config.jwt.refreshTtlSec * 1000,
  };
}

// どの実装でも “payload本体” を取り出すユーティリティ
function pickPayload<T extends object = Record<string, unknown>>(r: unknown): T {
  if (r && typeof r === 'object') {
    const o = r as any;
    if (o.payload && typeof o.payload === 'object') return o.payload as T; // { payload } 形（元仕様）
    return o as T; // payload そのものが返ってきた場合にも耐性
  }
  throw new Error('invalid_id_token_payload');
}

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    // 開発用スキップ
    if (process.env.DEV_FAKE_AUTH === '1') {
      const { line_user_id, profile } = req.body || {};
      if (!line_user_id) return res.status(400).json({ error: 'Missing line_user_id' });

      const claims = {
        uid: String(line_user_id),
        profile: {
          displayName: profile?.displayName ?? 'Dev User',
          picture: profile?.picture ?? null,
        },
      };
      const accessToken = await issueAccessToken(claims);
      const refreshToken = await issueRefreshToken(claims);
      res.cookie(config.jwt.refreshCookie, refreshToken, cookieOpts());
      console.log('[auth/login] devAuth OK:', line_user_id);
      return res.json({ accessToken });
    }

    const { id_token } = req.body || {};
    if (!id_token) return res.status(400).json({ error: 'Missing id_token' });

    // CJS/ESM 問題回避のため遅延 import
    const { verifyLineIdToken } = await import('../auth/lineVerify');
    const verifiedRaw = await verifyLineIdToken(id_token);
    const verified = pickPayload<LineJWTPayload>(verifiedRaw);

    // デバッグ（形食い違い検出用）
    console.log('[auth/login] keys(verified)=', Object.keys(verified || {}));

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

    const accessToken = await issueAccessToken(claims);
    const refreshToken = await issueRefreshToken(claims);
    res.cookie(config.jwt.refreshCookie, refreshToken, cookieOpts());

    console.log('[auth/login] LINE verified:', uid);
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

    // verifyRefresh の戻りも { payload } or 直接payload の両対応
    const raw = await verifyRefresh(token);
    const payload = pickPayload<Record<string, unknown>>(raw);

    const accessToken = await issueAccessToken(payload);
    const refreshToken = await issueRefreshToken(payload);
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