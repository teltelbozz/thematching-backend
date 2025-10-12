// src/auth/tokenService.ts
// jsonwebtoken 版（CJS 互換）— HS256 で access/refresh を発行・検証
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config';

const ALG = 'HS256' as const;

const accessSecret = config.jwt.accessSecret;
const refreshSecret = config.jwt.refreshSecret;

/** アクセストークン発行 */
export async function issueAccessToken(payload: Record<string, unknown>) {
  return jwt.sign(payload, accessSecret, {
    algorithm: ALG,
    expiresIn: config.jwt.accessTtlSec, // 秒
  });
}

/** リフレッシュトークン発行 */
export async function issueRefreshToken(payload: Record<string, unknown>) {
  return jwt.sign(payload, refreshSecret, {
    algorithm: ALG,
    expiresIn: config.jwt.refreshTtlSec, // 秒
  });
}

/** アクセストークン検証（既存互換で { payload } を返す） */
export async function verifyAccess(token: string) {
  const decoded = jwt.verify(token, accessSecret, { algorithms: [ALG] }) as Record<string, unknown>;
  return { payload: decoded };
}

/** リフレッシュトークン検証（既存互換で { payload } を返す） */
export async function verifyRefreshToken(token: string) {
  const decoded = jwt.verify(token, refreshSecret, { algorithms: [ALG] }) as Record<string, unknown>;
  return { payload: decoded };
}

/** Authorization: Bearer xxx 抜き出し */
export function readBearer(req: Request): string | null {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/.exec(h);
  return m ? m[1] : null;
}