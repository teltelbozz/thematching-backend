// src/routes/auth.ts
import express from 'express';
import { config } from '../config/index.js';
import {
  issueAccessToken,
  issueRefreshToken,
  verifyRefreshToken,
} from '../auth/tokenService.js';

type JWTPayloadLike = Record<string, unknown> & {
  sub?: string;
  name?: string;
  picture?: string;
};

type LineJWTPayload = JWTPayloadLike;

const router = express.Router();

function normalizeVerifiedResult(result: unknown): LineJWTPayload {
  const maybe =
    result && typeof result === 'object' && 'payload' in (result as any)
      ? (result as any).payload
      : result;

  if (!maybe || typeof maybe === 'string' || typeof maybe !== 'object') {
    throw new Error('invalid_id_token_payload');
  }
  return maybe as LineJWTPayload;
}

// ==============================
// POST /auth/login
// ==============================
router.post('/login', async (req, res) => {
  try {
    // --------------------------------------------------------
    // ① 開発モード（DEV_FAKE_AUTH=1）：LINE検証スキップ
    // --------------------------------------------------------
    if (config.devAuth) {
      const { line_user_id, profile } = req.body || {};
      if (!line_user_id) {
        return res.status(400).json({ error: 'Missing line_user_id' });
      }

      const uid = String(line_user_id);
      const claims: Record<string, unknown> = {
        uid,
        profile: {
          displayName: profile?.displayName ?? 'Dev User',
          picture: profile?.picture,
        },
      };

      const accessToken = await issueAccessToken(claims);
      const refreshToken = await issueRefreshToken(claims);

      res.cookie(config.jwt.refreshCookie, refreshToken, {
        httpOnly: true,
        secure: true,       // ← 常に true（Vercel は https）
        sameSite: 'none',   // ← クロスドメイン許可
        path: '/',          // ← 明示
        maxAge: config.jwt.refreshTtlSec * 1000,
      });

      console.log('[auth/login] devAuth mode OK:', uid);
      return res.json({ accessToken });
    }

    // --------------------------------------------------------
    // ② 本番モード：LINE IDトークン検証
    // --------------------------------------------------------
    const { id_token } = req.body || {};
    if (!id_token) {
      return res.status(400).json({ error: 'Missing id_token' });
    }

    const { verifyLineIdToken } = await import('../auth/lineVerify.js');
    const verified = await verifyLineIdToken(id_token);
    const payload = normalizeVerifiedResult(verified);

    const uid = payload.sub ? String(payload.sub) : '';
    if (!uid) {
      return res.status(400).json({ error: 'invalid_sub' });
    }

    const claims: Record<string, unknown> = {
      uid,
      profile: {
        displayName: payload.name ?? 'LINE User',
        picture: payload.picture,
      },
    };

    const accessToken = await issueAccessToken(claims);
    const refreshToken = await issueRefreshToken(claims);

    res.cookie(config.jwt.refreshCookie, refreshToken, {
      httpOnly: true,
      secure: true,       // ← production でも常に true
      sameSite: 'none',   // ← Lax → None に変更
      path: '/',          // ← 明示
      maxAge: config.jwt.refreshTtlSec * 1000,
    });

    console.log('[auth/login] LINE verified:', uid);
    return res.json({ accessToken });
  } catch (err) {
    console.error('[auth/login]', err);
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

    const verified = await verifyRefreshToken(token);
    const payload = normalizeVerifiedResult(verified);

    const accessToken = await issueAccessToken(payload);
    const refreshToken = await issueRefreshToken(payload);

    res.cookie(config.jwt.refreshCookie, refreshToken, {
      httpOnly: true,
      secure: true,       // ← 常に true
      sameSite: 'none',   // ← クロスサイト対応
      path: '/',          // ← 明示
      maxAge: config.jwt.refreshTtlSec * 1000,
    });

    return res.json({ accessToken });
  } catch (err) {
    console.error('[auth/refresh]', err);
    return res.status(401).json({ error: 'refresh_failed' });
  }
});

// ==============================
// POST /auth/logout
// ==============================
router.post('/logout', async (_req, res) => {
  try {
    res.clearCookie(config.jwt.refreshCookie, {
      path: '/',
      sameSite: 'none',
      secure: true,
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[auth/logout]', err);
    return res.status(500).json({ error: 'logout_failed' });
  }
});

export default router;