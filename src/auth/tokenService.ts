import { SignJWT, jwtVerify, JWTPayload } from 'jose';
import { config } from '../config/index.js';
import { Request } from 'express';

// ===== util =====

// Bearer ヘッダから JWT を取り出す
export function readBearer(req: Request): string | null {
  const h = req.headers['authorization'];
  if (!h) return null;
  const m = /^Bearer (.+)$/i.exec(h);
  return m ? m[1] : null;
}

// Cookie から値を取り出す
export function readCookie(req: Request, name: string): string | null {
  const h = req.headers['cookie'];
  if (!h) return null;
  const m = new RegExp(`${name}=([^;]+)`).exec(h);
  return m ? decodeURIComponent(m[1]) : null;
}

// ===== token service =====

// access token (短期)
export async function signAccess(uid: number | string): Promise<string> {
  return await new SignJWT({ uid })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${config.jwt.accessTtlSec}s`)
    .sign(new TextEncoder().encode(config.jwt.accessSecret));
}

export async function verifyAccess(token: string) {
  return await jwtVerify(token, new TextEncoder().encode(config.jwt.accessSecret), {
    algorithms: ['HS256'],
  });
}

// refresh token (長期)
export async function signRefresh(uid: number | string, rot: number): Promise<string> {
  return await new SignJWT({ uid, rot })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${config.jwt.refreshTtlSec}s`)
    .sign(new TextEncoder().encode(config.jwt.refreshSecret));
}

export async function verifyRefresh(token: string) {
  return await jwtVerify(token, new TextEncoder().encode(config.jwt.refreshSecret), {
    algorithms: ['HS256'],
  });
}

// ===== helper =====

// base64url encode（必要に応じて利用）
export function base64url(input: string): string {
  return Buffer.from(input, 'base64')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
    .split('')
    .map((s: string) => s.charCodeAt(0).toString(16)) // ★型を追加
    .join('');
}