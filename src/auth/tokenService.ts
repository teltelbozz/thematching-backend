// src/auth/tokenService.ts
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config';

const ALG: jwt.Algorithm = 'HS256';

const accessSecret = config.jwt.accessSecret;
const refreshSecret = config.jwt.refreshSecret;

function stripJwtReserved(p: Record<string, unknown>) {
  const { exp, iat, nbf, ...rest } = p;
  return rest;
}

export async function issueAccessToken(payload: Record<string, unknown>) {
  const clean = stripJwtReserved(payload);
  return jwt.sign(clean, accessSecret, {
    algorithm: ALG,
    expiresIn: config.jwt.accessTtlSec,
  });
}

export async function issueRefreshToken(payload: Record<string, unknown>) {
  const clean = stripJwtReserved(payload);
  return jwt.sign(clean, refreshSecret, {
    algorithm: ALG,
    expiresIn: config.jwt.refreshTtlSec,
  });
}

/** 署名検証（payload をそのまま返す） */
export async function verifyAccess(token: string): Promise<Record<string, unknown>> {
  return jwt.verify(token, accessSecret, { algorithms: [ALG] }) as any;
}
export async function verifyRefresh(token: string): Promise<Record<string, unknown>> {
  return jwt.verify(token, refreshSecret, { algorithms: [ALG] }) as any;
}

/** Authorization: Bearer xxx 抜き出し */
export function readBearer(req: Request): string | null {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/.exec(h);
  return m ? m[1] : null;
}