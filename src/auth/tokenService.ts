
import { SignJWT, jwtVerify, JWTPayload } from 'jose';
import { config } from '../config/index.js';

type AccessClaims = JWTPayload & { uid: number };
type RefreshClaims = JWTPayload & { uid: number; rot?: number };

const ACCESS_SECRET = new TextEncoder().encode(config.jwt.accessSecret);
const REFRESH_SECRET = new TextEncoder().encode(config.jwt.refreshSecret);

export async function signAccess(uid: number) {
  const now = Math.floor(Date.now()/1000);
  return await new SignJWT({ uid } as AccessClaims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(now + config.jwt.accessTtlSec)
    .sign(ACCESS_SECRET);
}

export async function signRefresh(uid: number, rot=0) {
  const now = Math.floor(Date.now()/1000);
  return await new SignJWT({ uid, rot } as RefreshClaims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(now + config.jwt.refreshTtlSec)
    .sign(REFRESH_SECRET);
}

export async function verifyAccess(token: string) {
  return await jwtVerify(token, ACCESS_SECRET, { algorithms:['HS256'], clockTolerance: 60 });
}

export async function verifyRefresh(token: string) {
  return await jwtVerify(token, REFRESH_SECRET, { algorithms:['HS256'], clockTolerance: 300 });
}

export function readBearer(req: any): string | undefined {
  const b = String(req.headers?.authorization || '');
  return b.startsWith('Bearer ') ? b.slice(7) : undefined;
}

export function readCookie(req: any, name: string): string | undefined {
  const raw = req.headers?.cookie;
  if (!raw) return;
  const target = raw.split(';').map((s: string)=>s.trim()).find((s)=>s.startsWith(name+'='));
  return target ? decodeURIComponent(target.split('=')[1]) : undefined;
}
