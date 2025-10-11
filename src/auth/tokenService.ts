import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config/index.js';

const encoder = new TextEncoder();

/**
 * アクセストークンを発行
 */
export async function issueAccessToken(payload: Record<string, any>) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(`${config.jwt.accessTtlSec}s`)
    .sign(encoder.encode(config.jwt.accessSecret));
}

/**
 * リフレッシュトークンを発行
 */
export async function issueRefreshToken(payload: Record<string, any>) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(`${config.jwt.refreshTtlSec}s`)
    .sign(encoder.encode(config.jwt.refreshSecret));
}

/**
 * リフレッシュトークンを検証
 */
export async function verifyRefreshToken(token: string) {
  const { payload } = await jwtVerify(
    token,
    encoder.encode(config.jwt.refreshSecret)
  );
  return payload;
}

/**
 * アクセストークンを検証
 */
export async function verifyAccess(token: string) {
  const { payload } = await jwtVerify(
    token,
    encoder.encode(config.jwt.accessSecret)
  );
  return payload;
}

/**
 * Authorizationヘッダーから Bearerトークンを抽出
 */
export function readBearer(header?: string | null): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}