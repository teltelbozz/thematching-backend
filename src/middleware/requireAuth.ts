// src/middleware/requireAuth.ts
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret';
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'sid';

function readCookie(req: any, name: string): string | undefined {
  const raw = req.headers?.cookie;
  if (!raw) return;
  const target = raw
    .split(';')
    .map((s: string) => s.trim())
    .find((s: string) => s.startsWith(name + '='));
  return target ? decodeURIComponent(target.split('=')[1]) : undefined;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const bearer = String(req.headers['authorization'] || '');
    const tokenFromBearer = bearer.startsWith('Bearer ') ? bearer.slice(7) : undefined;
    const token = tokenFromBearer || readCookie(req, SESSION_COOKIE_NAME);
    if (!token) return res.status(401).json({ error: 'unauthenticated' });

    const decoded = jwt.verify(token, SESSION_SECRET, { algorithms: ['HS256'] }) as any;
    (req as any).userId = decoded?.uid;
    return next();
  } catch (e) {
    console.error('[requireAuth]', e);
    return res.status(401).json({ error: 'unauthenticated' });
  }
}

export default requireAuth;