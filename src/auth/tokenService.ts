// src/auth/tokenService.ts
import type { Request } from 'express';
import config from '../config';

// jose は ESM 専用なので動的 import を使う（CJSビルドでもOK）
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

/** アクセストークン検証（既存コード互換で { payload } を返す） */
export async function verifyAccess(token: string) {
  const { jwtVerify } = await loadJose();
  const result = await jwtVerify(token, accessKey);
  return { payload: result.payload as Record<string, unknown> };
}

/** リフレッシュトークン検証（既存コード互換で { payload } を返す） */
export async function verifyRefreshToken(token: string) {
  const { jwtVerify } = await loadJose();
  const result = await jwtVerify(token, refreshKey);
  return { payload: result.payload as Record<string, unknown> };
}

/** Authorization: Bearer xxx からトークンを取り出す */
export function readBearer(req: Request): string | null {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/.exec(h);
  return m ? m[1] : null;
}