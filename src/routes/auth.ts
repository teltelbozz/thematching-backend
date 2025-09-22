import { Router } from 'express';
import type { Pool } from 'pg';
import { JWTPayload } from 'jose';

import { config } from '../config/index.js';
import {
  signAccess,
  signRefresh,
  verifyAccess,
  verifyRefresh,
  readBearer,
  readCookie,
} from '../auth/tokenService.js';
import { verifyLineIdToken } from '../auth/lineVerify.js';

const router = Router();
const DEBUG_AUTH = config.debugAuth;
const REFRESH_COOKIE = config.jwt.refreshCookie;
const COOKIE_BASE = `Path=/; HttpOnly; Secure; SameSite=None`;

// 型（アクセストークン／リフレッシュのuidは数値 or 文字列の可能性）
type AccessClaims = JWTPayload & { uid: number | string };
type RefreshClaims = JWTPayload & { uid: number | string; rot?: number };

// 文字列/数値どちらでも入ってきうる uid を number に正規化
function normalizeUid(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

// ===== /auth/login =====
// Body: { id_token: string } (LIFF の ID トークン)
router.post('/login', async (req, res) => {
  try {
    const { id_token } = req.body || {};
    if (!id_token) return res.status(400).json({ error: 'missing_id_token' });

    // 署名検証前に payload を覗いてデバッグ（署名は未検証なので参考表示）
    if (DEBUG_AUTH) {
      try {
        const [h64, p64] = String(id_token).split('.');
        const headerStr = Buffer.from(h64, 'base64url').toString('utf8');
        const payloadStr = Buffer.from(p64, 'base64url').toString('utf8');
        const headerObj = JSON.parse(headerStr);
        const payloadObj = JSON.parse(payloadStr);
        const now = Math.floor(Date.now() / 1000);
        console.log('[auth/login expect]', {
          issuer: config.line.issuer,
          audience: config.line.channelId,
        });
        console.log('[auth/login incoming]', {
          alg: headerObj?.alg,
          iss: payloadObj?.iss,
          aud: payloadObj?.aud,
          sub: payloadObj?.sub,
          iat: payloadObj?.iat,
          exp: payloadObj?.exp,
          now,
          exp_minus_now: (payloadObj?.exp ?? 0) - now,
        });
      } catch {}
    }

    // LINE id_token の署名・クレーム検証（内部で issuer/audience/clockTolerance を適用）
    const { payload } = await verifyLineIdToken(id_token);

    // DB upsert
    const db = req.app.locals.db as Pool;
    const lineUserId = String(payload.sub);
    const displayName = (payload as any).name || 'LINE User';
    const picture = (payload as any).picture || null;

    const userSql = `
      WITH ins AS (
        INSERT INTO users (line_user_id, email)
        VALUES ($1, NULL)
        ON CONFLICT (line_user_id) DO NOTHING
        RETURNING id
      )
      SELECT id FROM ins
      UNION ALL
      SELECT id FROM users WHERE line_user_id = $1
      LIMIT 1
    `;
    const u = await db.query(userSql, [lineUserId]);

    // DBから返る id を number に正規化（文字列の可能性があるため）
    const userIdRaw = u.rows[0]?.id;
    const userId = normalizeUid(userIdRaw);
    if (userId == null) {
      console.error('[auth/login] invalid user id from DB:', userIdRaw);
      return res.status(500).json({ error: 'server_user_id_invalid' });
    }

    const profSql = `
      INSERT INTO user_profiles (user_id, nickname, photo_url)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id) DO UPDATE
        SET nickname = COALESCE(EXCLUDED.nickname, user_profiles.nickname),
            photo_url = COALESCE(EXCLUDED.photo_url, user_profiles.photo_url),
            updated_at = NOW()
      RETURNING user_id, nickname, photo_url
    `;
    const p = await db.query(profSql, [userId, displayName, picture]);

    // アクセス/リフレッシュ発行（uid は number）
    const access = await signAccess(userId);
    const refresh = await signRefresh(userId, 0);

    // HttpOnly Refresh Cookie (クロスサイト運用)
    res.setHeader('Set-Cookie', [
      `${REFRESH_COOKIE}=${encodeURIComponent(refresh)}; ${COOKIE_BASE}; Max-Age=${config.jwt.refreshTtlSec}`,
    ]);

    return res.status(200).json({
      ok: true,
      access_token: access,
      token_type: 'Bearer',
      expires_in: config.jwt.accessTtlSec,
      user: { id: userId, line_user_id: lineUserId },
      profile: p.rows[0],
    });
  } catch (e: any) {
    console.error('[auth/login failed]', e?.code || '', e?.name || '', e?.message || e);
    return res.status(401).json({ error: 'invalid_id_token' });
  }
});

// ===== /auth/refresh =====
// Cookie の Refresh から新しい Access を返す（JSON）
router.post('/refresh', async (req, res) => {
  try {
    const rt = readCookie(req, REFRESH_COOKIE);
    if (!rt) return res.status(401).json({ error: 'no_refresh_token' });

    const { payload } = await verifyRefresh(rt);
    const uidNorm = normalizeUid((payload as RefreshClaims).uid);
    if (uidNorm == null) return res.status(401).json({ error: 'invalid_refresh_uid' });

    // （必要ならここでリフレッシュの失効/回転チェック）

    const access = await signAccess(uidNorm);
    return res.json({
      ok: true,
      access_token: access,
      token_type: 'Bearer',
      expires_in: config.jwt.accessTtlSec,
    });
  } catch (e: any) {
    console.error('[auth/refresh failed]', e?.code || '', e?.name || '', e?.message || e);
    return res.status(401).json({ error: 'refresh_failed' });
  }
});

// ===== /auth/logout =====
router.post('/logout', async (_req, res) => {
  res.setHeader('Set-Cookie', [
    `${REFRESH_COOKIE}=; ${COOKIE_BASE}; Max-Age=0`,
  ]);
  return res.json({ ok: true });
});

// ===== /auth/me =====
// Bearer アクセストークンでユーザー情報を返す
router.get('/me', async (req, res) => {
  try {
    const token = readBearer(req);
    if (!token) {
      console.warn('[auth/me] no Authorization header');
      return res.status(401).json({ error: 'unauthenticated' });
    }
    const { payload } = await verifyAccess(token);
    const uidNorm = normalizeUid((payload as AccessClaims).uid);
    if (uidNorm == null) {
      console.warn('[auth/me] invalid uid in access token:', (payload as any).uid);
      return res.status(401).json({ error: 'unauthenticated' });
    }

    console.log('[auth/me] uid=', uidNorm);

    const db = req.app.locals.db as Pool;
    const r = await db.query(
      `SELECT u.id, u.line_user_id,
              p.nickname, p.age, p.gender, p.occupation, p.photo_url, p.photo_masked_url, p.verified_age
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE u.id = $1`,
      [uidNorm]
    );

    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
    return res.json({ user: r.rows[0] });
  } catch (e: any) {
    console.warn('[auth/me] verify failed:', e?.code || '', e?.message || e);
    return res.status(401).json({ error: 'unauthenticated' });
  }
});

export default router;