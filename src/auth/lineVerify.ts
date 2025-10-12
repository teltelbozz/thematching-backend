// src/auth/lineVerify.ts
import axios from 'axios';
import jwt from 'jsonwebtoken';
import jwkToPem from 'jwk-to-pem';
import { config } from '../config/index.js';

/**
 * LINEのJWKsから公開鍵を取得してキャッシュします
 */
let cachedKeys: Record<string, string> = {};
let lastFetchedAt = 0;

async function getPemForKid(kid: string): Promise<string> {
  const now = Date.now();
  // 1時間キャッシュ
  if (cachedKeys[kid] && now - lastFetchedAt < 3600_000) {
    return cachedKeys[kid];
  }

  const res = await axios.get('https://api.line.me/oauth2/v2.1/certs');
  const jwks = res.data.keys;

  for (const jwk of jwks) {
    const pem = jwkToPem(jwk);
    cachedKeys[jwk.kid] = pem;
  }

  lastFetchedAt = now;

  if (!cachedKeys[kid]) {
    throw new Error(`No matching key found for kid: ${kid}`);
  }

  return cachedKeys[kid];
}

/**
 * LINEのIDトークンを検証し、ペイロードを返す
 */
export async function verifyLineIdToken(idToken: string) {
  // ヘッダー部分から kid を取得
  const decodedHeader = jwt.decode(idToken, { complete: true })?.header;
  if (!decodedHeader || !decodedHeader.kid) {
    throw new Error('Invalid ID token header');
  }

  const pem = await getPemForKid(decodedHeader.kid);

  const payload = jwt.verify(idToken, pem, {
    algorithms: ['RS256'],
    issuer: config.line.issuer,
    audience: config.line.channelId,
  });

  return payload;
}