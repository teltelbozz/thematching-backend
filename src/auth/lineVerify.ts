// src/auth/lineVerify.ts
import { config } from '../config/index.js';

// jose は ESM 専用のため、CJS/TS からは動的 import で呼び出す
const joseP = import('jose');

export type LineIdPayload = {
  iss: string;
  sub: string;      // LINE ユーザーID
  aud: string;      // あなたの Channel ID
  exp: number;
  iat: number;
  name?: string;
  picture?: string;
};

/**
 * LINEのIDトークンを公式JWKSでRS256検証し、ペイロードを返す
 */
export async function verifyLineIdToken(idToken: string): Promise<LineIdPayload> {
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('Missing id_token');
  }

  const { createRemoteJWKSet, jwtVerify } = await joseP;

  // LINE 公式 JWKS（公開鍵）
  const JWKS = createRemoteJWKSet(new URL('https://api.line.me/oauth2/v2.1/certs'));

  const { payload, protectedHeader } = await jwtVerify(idToken, JWKS, {
    issuer: config.line.issuer || 'https://access.line.me',
    audience: config.line.channelId,  // 例: "2008150959"
    algorithms: ['RS256'],            // RS256 を明示
    clockTolerance: 300,              // ±5分許容（端末時間ズレ対策）
  });

  // 念のため alg の健全性チェック（想定外を早期検知）
  if (protectedHeader?.alg && protectedHeader.alg !== 'RS256') {
    throw new Error(`Unexpected alg: ${protectedHeader.alg}`);
  }

  return payload as unknown as LineIdPayload;
}

export default verifyLineIdToken;