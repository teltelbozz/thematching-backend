// src/auth/tokenService.ts
// jsonwebtoken 版（CommonJS 互換）— HS256 で access / refresh を発行・検証

import type { Request } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { config } from '../config/index.js';

const ALG = 'HS256' as const;

const accessSecret = config.jwt.accessSecret;
const refreshSecret = config.jwt.refreshSecret;

/** アクセストークン発行（同期） */
export function issueAccessToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, accessSecret, {
    algorithm: ALG,
    expiresIn: config.jwt.accessTtlSec, // 秒
  });
}

/** リフレッシュトークン発行（同期） */
export function issueRefreshToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, refreshSecret, {
    algorithm: ALG,
    expiresIn: config.jwt.refreshTtlSec, // 秒
  });
}

/** アクセストークン検証（既存互換で { payload } を返す・同期） */
export function verifyAccess(token: string): { payload: JwtPayload | string } {
  const decoded = jwt.verify(token, accessSecret, { algorithms: [ALG] });
  return { payload: decoded as JwtPayload | string };
}

/** リフレッシュトークン検証（既存互換で { payload } を返す・同期） */
export function verifyRefreshToken(token: string): { payload: JwtPayload | string } {
  const decoded = jwt.verify(token, refreshSecret, { algorithms: [ALG] });
  return { payload: decoded as JwtPayload | string };
}

/** Authorization: Bearer xxx 抜き出し（同期） */
export function readBearer(req: Request): string | null {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/.exec(h);
  return m ? m[1] : null;
}