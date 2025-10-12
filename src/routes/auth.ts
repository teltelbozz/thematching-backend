import express from 'express';
import { config } from '../config/index.js';
import {
  issueAccessToken,
  issueRefreshToken,
  verifyRefreshToken,
} from '../auth/tokenService.js';
import { verifyLineIdToken } from '../auth/lineVerify.js';
import type { JWTPayload } from 'jose';

const router = express.Router();

type LineJWTPayload = JWTPayload & {
  sub?: string;
  name?: string;
  picture?: string;
};

function normalizeVerifiedResult(result: unknown): LineJWTPayload {
  // joseのjwtVerify結果が { payload } か、payloadそのものかの両方を許容
  const maybe =
    result && typeof result === 'object' && 'payload' in result
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
    // ① 開発モード（DEV_FAKE_AUTH=1）の場合：LINE検証をスキップ
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

      const accessToken = issueAccessToken(claims);
      const refreshToken = issueRefreshToken(claims);

      res.cookie(config.jwt.refreshCookie, refreshToken, {
        httpOnly: true,
        secure: config.env === 'production',
        sameSite: 'lax',
        maxAge: config.jwt.refreshTtlSec * 1000,
      });

      console.log('[auth/login] devAuth mode OK:', uid);
      return res.json({ accessToken });
    }

    // --------------------------------------------------------
    // ② 本番モード：LINEのIDトークンを検証
    // --------------------------------------------------------
    const { id_token } = req.body || {};
    if (!id_token) {
      return res.status(400).json({ error: 'Missing id_token' });
    }

    // ← ここは必ず await（ビルドエラーの主因だった箇所）
    const verified = await verifyLineIdToken(id_token);
    const payload = normalizeVerifiedResult(verified);

    const uid = payload.sub ? String(payload.sub) : '';
    if (!uid) {
      return res.status(400).json({ error: 'invalid_sub' });
    }

    const claims: Record<string, unknown> = {
      uid,
      profile: {
        // name/picture はオプショナルのためフォールバックを用意
        displayName: payload.name ?? 'LINE User',
        picture: payload.picture,
      },
    };

    const accessToken = issueAccessToken(claims);
    const refreshToken = issueRefreshToken(claims);

    res.cookie(config.jwt.refreshCookie, refreshToken, {
      httpOnly: true,
      secure: config.env === 'production',
      sameSite: 'lax',
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

    const payload = verifyRefreshToken(token);
    const accessToken = issueAccessToken(payload);
    const refreshToken = issueRefreshToken(payload);

    res.cookie(config.jwt.refreshCookie, refreshToken, {
      httpOnly: true,
      secure: config.env === 'production',
      sameSite: 'lax',
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
    res.clearCookie(config.jwt.refreshCookie);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[auth/logout]', err);
    return res.status(500).json({ error: 'logout_failed' });
  }
});

export default router;