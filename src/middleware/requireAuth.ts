// src/middleware/requireAuth.ts
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret';
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'sid';

/** Authorization: Bearer xxx または sid クッキーからトークンを取り出す */
function extractToken(req: Request): string | undefined {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const t = auth.slice(7).trim();
    if (t && t.toLowerCase() !== 'null' && t.toLowerCase() !== 'undefined') return t;
  }
  // cookie-parser を使わない前提の手動パース
  const raw = req.headers.cookie;
  if (raw) {
    for (const part of raw.split(';')) {
      const [k, v] = part.trim().split('=');
      if (k === SESSION_COOKIE_NAME && v) return decodeURIComponent(v);
    }
  }
  return undefined;
}

/** 共通：認証 & req.userId を付与 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'unauthenticated' });

    // /auth/login で発行したJWTと同じアルゴリズム/secretを使うこと
    const decoded = jwt.verify(token, SESSION_SECRET, { algorithms: ['HS256'] }) as any;
    const uid = decoded?.uid || decoded?.userId || decoded?.sub; // 発行側のペイロードキーに合わせる
    if (!uid) return res.status(401).json({ error: 'invalid_token' });

    (req as any).userId = typeof uid === 'string' ? parseInt(uid, 10) || uid : uid;
    return next();
  } catch (e) {
    // 期限切れや署名不一致もここに来る
    console.error('[requireAuth] verify error:', (e as Error)?.message);
    return res.status(401).json({ error: 'unauthenticated' });
  }
}

/** ルーター内で userId の存在を保証したいときの補助（任意） */
export function requireAuthUserId(req: Request, res: Response, next: NextFunction) {
  const uid = (req as any).userId;
  if (uid == null) return res.status(401).json({ error: 'unauthorized' });
  return next();
}

export default requireAuth;