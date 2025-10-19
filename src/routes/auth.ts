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

/** 共通の Cookie オプション（Secure / SameSite=None / Path=/） */
function cookieOpts() {
  return {
    httpOnly: true,
    secure: true,                 // Vercel/HTTPS 前提
    sameSite: 'none' as const,    // クロスサイトで Cookie を送るために必須
    path: '/',
    maxAge: config.jwt.refreshTtlSec * 1000,
  };
}

/** 互換のため id_token をいろいろな置き場から拾う */
function extractIdToken(req: express.Request): string | null {
  // 1) JSON ボディ（id_token / idToken）
  const b: any = req.body || {};
  if (typeof b.id_token === 'string' && b.id_token.trim()) return b.id_token.trim();
  if (typeof b.idToken === 'string' && b.idToken.trim()) return b.idToken.trim();

  // 2) クエリ
  const q: any = req.query || {};
  if (typeof q.id_token === 'string' && q.id_token.trim()) return q.id_token.trim();
  if (typeof q.idToken === 'string' && q.idToken.trim()) return q.idToken.trim();

  // 3) ヘッダ（x-id-token）
  const hid = req.header('x-id-token');
  if (typeof hid === 'string' && hid.trim()) return hid.trim();

  // 4) Authorization（Bearer/LIFF）
  const auth = req.header('authorization') || '';
  const m = auth.match(/^(?:Bearer|LIFF)\s+(.+)$/i);
  if (m && m[1]?.trim()) return m[1].trim();

  return null;
}

/** Cookie が無い環境のフォールバック（互換用） */
function extractRefreshToken(req: express.Request): string | null {
  // 通常は Cookie 優先（/auth/refresh は Cookie を想定）
  const c = req.cookies?.[config.jwt.refreshCookie];
  if (typeof c === 'string' && c.trim()) return c.trim();

  // フォールバック 1: Authorization: Bearer <refreshToken>
  const auth = req.header('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m && m[1]?.trim()) return m[1].trim();

  // フォールバック 2: x-refresh-token
  const hdr = req.header('x-refresh-token');
  if (typeof hdr === 'string' && hdr.trim()) return hdr.trim();

  return null;
}

// ------------------------------------------------------------------
// POST /auth/login
// ------------------------------------------------------------------
router.post('/login', async (req, res) => {
  try {
    // ① 開発モード：ダミー認証を許可
    if (process.env.DEV_FAKE_AUTH === '1') {
      const { line_user_id, profile } = (req.body || {}) as {
        line_user_id?: string;
        profile?: { displayName?: string; picture?: string | null };
      };
      if (!line_user_id) {
        console.warn('[auth/login] devAuth: Missing line_user_id');
        return res.status(400).json({ error: 'Missing line_user_id' });
      }

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

    // ② 本番：LINE の id_token を多様な場所から受理（後方互換）
    const idToken = extractIdToken(req);
    if (!idToken) {
      console.warn('[auth/login] Missing id_token (body/query/header/authorization not found). hdr[content-type]=', req.header('content-type'));
      return res.status(400).json({ error: 'Missing id_token' });
    }

    // CJS/ESM の兼ね合いで遅延 import
    const { verifyLineIdToken } = await import('../auth/lineVerify');
    const verified = (await verifyLineIdToken(idToken)) as LineJWTPayload;

    const uid = verified.sub ? String(verified.sub) : '';
    if (!uid) {
      console.warn('[auth/login] invalid_sub in id_token payload');
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
    console.error('[auth/login] ERROR:', e);
    return res.status(500).json({ error: 'login_failed' });
  }
});

// ------------------------------------------------------------------
// POST /auth/refresh
// ------------------------------------------------------------------
router.post('/refresh', async (req, res) => {
  try {
    const token = extractRefreshToken(req);
    if (!token) {
      console.warn('[auth/refresh] no_refresh_token (cookie/header both missing)');
      return res.status(401).json({ error: 'no_refresh_token' });
    }

    const payload = await verifyRefresh(token); // payload は { uid, profile, ... }
    const accessToken = await issueAccessToken(payload as any);
    const refreshToken = await issueRefreshToken(payload as any);

    res.cookie(config.jwt.refreshCookie, refreshToken, cookieOpts());
    return res.json({ accessToken });
  } catch (e) {
    console.error('[auth/refresh] ERROR:', e);
    return res.status(401).json({ error: 'refresh_failed' });
  }
});

// ------------------------------------------------------------------
// POST /auth/logout
// ------------------------------------------------------------------
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
    console.error('[auth/logout] ERROR:', e);
    return res.status(500).json({ error: 'logout_failed' });
  }
});

export default router;