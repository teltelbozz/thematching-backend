// src/routes/auth.ts
import express from 'express';
import config from '../config';
import {
  issueAccessToken,
  issueRefreshToken,
  verifyRefreshToken,
} from '../auth/tokenService';

const router = express.Router();

/** /api/auth/login */
router.post('/login', async (req, res) => {
  try {
    const { line_user_id, profile } = req.body || {};
    if (!line_user_id) {
      return res.status(400).json({ error: 'Missing line_user_id' });
    }

    const payload = { uid: String(line_user_id), profile };
    const accessToken = await issueAccessToken(payload);
    const refreshToken = await issueRefreshToken(payload);

    res.cookie(config.jwt.refreshCookie, refreshToken, {
      httpOnly: true,
      secure: config.env === 'production',
      sameSite: 'lax',
      maxAge: config.jwt.refreshTtlSec * 1000,
    });

    return res.json({ accessToken });
  } catch (err) {
    console.error('[auth/login]', err);
    return res.status(500).json({ error: 'login_failed' });
  }
});

/** /api/auth/refresh */
router.post('/refresh', async (req, res) => {
  try {
    const rt = req.cookies?.[config.jwt.refreshCookie];
    if (!rt) return res.status(401).json({ error: 'no_refresh_token' });

    const { payload } = await verifyRefreshToken(rt);
    const newAccess = await issueAccessToken(payload);
    return res.json({ accessToken: newAccess });
  } catch (err) {
    console.error('[auth/refresh]', err);
    return res.status(401).json({ error: 'invalid_refresh_token' });
  }
});

/** /api/auth/logout */
router.post('/logout', (req, res) => {
  res.clearCookie(config.jwt.refreshCookie);
  return res.json({ ok: true });
});

export default router;