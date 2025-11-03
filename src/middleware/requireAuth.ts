// src/middleware/requireAuth.ts
import type { Request, Response, NextFunction } from 'express';
import { readBearer, verifyAccess } from '../auth/tokenService';

/** Authorization: Bearer xxx または sid クッキーからトークンを取得 */
function extractToken(req: Request): string | undefined {
  const t = readBearer(req);
  if (t && t.toLowerCase() !== 'null' && t.toLowerCase() !== 'undefined') return t;

  const raw = req.headers.cookie;
  const cookieName = process.env.SESSION_COOKIE_NAME || 'sid';
  if (raw) {
    for (const p of raw.split(';')) {
      const [k, v] = p.trim().split('=');
      if (k === cookieName && v) return decodeURIComponent(v);
    }
  }
  return undefined;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'unauthenticated' });

    // ★ 発行側と同一の検証ロジック・鍵（JWT_ACCESS_SECRET, HS256）で検証
    const verified = await verifyAccess(token);
    const claims = (verified as any)?.payload ?? verified;
    const uid = claims?.uid || claims?.userId || claims?.sub;
    if (!uid) return res.status(401).json({ error: 'invalid_token' });

    (req as any).userId = typeof uid === 'string' ? parseInt(uid, 10) || uid : uid;
    return next();
  } catch (e: any) {
    console.error('[requireAuth] verify error:', e?.message || e);
    return res.status(401).json({ error: 'unauthenticated' });
  }
}

export function requireAuthUserId(req: Request, res: Response, next: NextFunction) {
  if ((req as any).userId == null) return res.status(401).json({ error: 'unauthorized' });
  return next();
}

export default requireAuth;