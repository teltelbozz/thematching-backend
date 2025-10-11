// src/auth/tokenService.ts
import type { Request } from 'express';
import config from '../config';

// ESM専用の jose を CJS でも使えるように関数内で動的 import
const loadJose = () => import('jose');

const enc = new TextEncoder();
const accessKey = enc.encode(config.jwt.accessSecret);
const refreshKey = enc.encode(config.jwt.refreshSecret);

/** アクセストークン発行 */
export async function issueAccessToken(payload: Record<string, unknown>) {
  const { SignJWT } = await loadJose();
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${config.jwt.accessTtlSec}s`)
    .sign(accessKey);
}

/** リフレッシュトークン発行 */
export async function issueRefreshToken(payload: Record<string, unknown>) {
  const { SignJWT } = await loadJose();
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${config.jwt.refreshTtlSec}s`)
    .sign(refreshKey);
}

/** アクセストークン検証（既存互換で { payload } 返却） */
export async function verifyAccess(token: string) {
  const { jwtVerify } = await loadJose();
  const res = await jwtVerify(token, accessKey, { algorithms: ['HS256'] });
  return { payload: res.payload as Record<string, unknown> };
}

/** リフレッシュトークン検証（既存互換で { payload } 返却） */
export async function verifyRefreshToken(token: string) {
  const { jwtVerify } = await loadJose();
  const res = await jwtVerify(token, refreshKey, { algorithms: ['HS256'] });
  return { payload: res.payload as Record<string, unknown> };
}

/** Authorization: Bearer xxx 抜き出し */
export function readBearer(req: Request): string | null {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/.exec(h);
  return m ? m[1] : null;
}