// src/routes/auth.ts
import express from 'express';
import config from '../config';
import {
  issueAccessToken,
  issueRefreshToken,
  verifyRefreshToken,
} from '../auth/tokenService';

// jose 型に依存しない軽量な payload 型
type JWTPayloadLike = Record<string, unknown> & {
  sub?: string;
  name?: string;
  picture?: string;
};
type LineJWTPayload = JWTPayloadLike;

const router = express.Router();

// Cookie オプションを一元化
const COOKIE_OPTS = {
  httpOnly: true,
  secure: true, // SameSite=None の場合は true 必須
  sameSite: 'none' as const,
  path: config.cookie.path || '/',
  // domain は必要なときのみ（誤設定は破棄の原因）
  ...(config.cookie.domain ? { domain: config.cookie.domain } : {}),
  maxAge: config.jwt.refreshTtlSec * 1000,
};

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

function buildClaimsFromPayload(payload: any): Record<string, unknown> {
  // JWT の標準クレーム（exp, iat, nbf, iss, aud など）はコピーしない
  // アプリで使うものだけをホワイトリストで取り出す
  const uid = payload?.uid ?? payload?.sub ?? null;
  const profile = payload?.profile ?? undefined;
  const claims: Record<string, unknown> = {};
  if (uid != null) claims.uid = uid;
  if (profile != null) claims.profile = profile;
  return claims;
}


// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    // dev: フェイクログイン（id_token 不要）
    if (config.devAuth) {
      const { line_user_id, profile } = (req.body || {}) as {
        line_user_id?: string;
        profile?: { displayName?: string; picture?: string };
      };
      if (!line_user_id) {
        return res.status(400).json({ error: 'Missing line_user_id' });
      }
      const uid = String(line_user_id);
      const claims = {
        uid,
        profile: {
          displayName: profile?.displayName ?? 'Dev User',
          picture: profile?.picture,
        },
      };
      const accessToken = await issueAccessToken(claims);
      const refreshToken = await issueRefreshToken(claims);

      res.cookie(config.jwt.refreshCookie, refreshToken, COOKIE_OPTS);
      return res.json({ access_token: accessToken, accessToken }); // 両表記対応
    }

    // prod: LINE IDトークン検証（RS256/JWKS）
    const { id_token } = req.body || {};
    if (!id_token) {
      return res.status(400).json({ error: 'Missing id_token' });
    }

    const { verifyLineIdToken } = await import('../auth/lineVerify'); // 動的 import
    const verified = await verifyLineIdToken(id_token);
    const payload = normalizeVerifiedResult(verified);

    const uid = payload.sub ? String(payload.sub) : '';
    if (!uid) return res.status(400).json({ error: 'invalid_sub' });

    const claims = {
      uid,
      profile: {
        displayName: payload.name ?? 'LINE User',
        picture: payload.picture,
      },
    };

    const accessToken = await issueAccessToken(claims);
    const refreshToken = await issueRefreshToken(claims);

    res.cookie(config.jwt.refreshCookie, refreshToken, COOKIE_OPTS);
    return res.json({ access_token: accessToken, accessToken });
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

    // ★ ここが重要：exp/iat 等を含む元 payload は使わず、アプリ用クレームだけで再発行
    const claims = buildClaimsFromPayload(payload);

    const accessToken = await issueAccessToken(claims);
    const refreshToken = await issueRefreshToken(claims);

    res.cookie(config.jwt.refreshCookie, refreshToken, {
      httpOnly: true,
      secure: true,            // ← 全経路で統一
      sameSite: 'none',        // ← 全経路で統一（クロスオリジン前提）
      path: '/',               // ← 明示
      maxAge: config.jwt.refreshTtlSec * 1000,
    });

    return res.json({ accessToken });
  } catch (err) {
    console.error('[auth/refresh]', err);
    return res.status(401).json({ error: 'refresh_failed' });
  }
});

// POST /auth/logout
router.post('/logout', async (_req, res) => {
  try {
    // 消すときも同一オプションで（path/samesite/secure/domain が一致しないと消えない）
    res.clearCookie(config.jwt.refreshCookie, {
      ...COOKIE_OPTS,
      maxAge: undefined,
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[auth/logout]', err);
    return res.status(500).json({ error: 'logout_failed' });
  }
});

export default router;