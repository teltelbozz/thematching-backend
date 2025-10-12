import express from 'express';
import { config } from '../config/index.js';
import {
  issueAccessToken,
  issueRefreshToken,
  verifyRefreshToken,
} from '../auth/tokenService.js';
import { verifyLineIdToken } from '../auth/lineVerify.js';

const router = express.Router();

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

      const payload = { uid: String(line_user_id), profile };
      const accessToken = issueAccessToken(payload);
      const refreshToken = issueRefreshToken(payload);

      res.cookie(config.jwt.refreshCookie, refreshToken, {
        httpOnly: true,
        secure: config.env === 'production',
        sameSite: 'lax',
        maxAge: config.jwt.refreshTtlSec * 1000,
      });

      console.log('[auth/login] devAuth mode OK:', line_user_id);
      return res.json({ accessToken });
    }

    // --------------------------------------------------------
    // ② 本番モード：LINEのIDトークンを検証
    // --------------------------------------------------------
    const { id_token } = req.body || {};
    if (!id_token) {
      return res.status(400).json({ error: 'Missing id_token' });
    }

    const payload = await verifyLineIdToken(id_token);

    const uid = String(payload.sub);
    const profile = {
      displayName: payload.name,
      picture: payload.picture,
    };

    const accessToken = issueAccessToken({ uid, profile });
    const refreshToken = issueRefreshToken({ uid, profile });

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
router.post('/logout', async (req, res) => {
  try {
    res.clearCookie(config.jwt.refreshCookie);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[auth/logout]', err);
    return res.status(500).json({ error: 'logout_failed' });
  }
});

export default router;