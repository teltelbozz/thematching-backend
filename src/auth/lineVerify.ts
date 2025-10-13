// src/auth/lineVerify.ts
import axios from 'axios';
import jwt from 'jsonwebtoken';
import jwkToPem from 'jwk-to-pem';
import { config } from '../config/index.js';

/**
 * LINE の JWK を PEM に変換して kid ごとにキャッシュ
 */
let cachedPems: Record<string, string> = {};
let lastFetchedAt = 0;

async function getPemForKid(kid: string): Promise<string> {
  const now = Date.now();
  if (cachedPems[kid] && now - lastFetchedAt < 3600_000) {
    return cachedPems[kid];
  }

  const res = await axios.get('https://api.line.me/oauth2/v2.1/certs', {
    timeout: 5000,
  });

  if (res.status !== 200 || !res.data?.keys) {
    throw new Error(`failed_to_fetch_jwks: ${res.status}`);
  }

  const keys = res.data.keys as Array<any>;
  const next: Record<string, string> = {};

  for (const jwk of keys) {
    try {
      const pem = jwkToPem(jwk);
      if (jwk.kid) next[jwk.kid] = pem;
    } catch (e) {
      console.warn('jwkToPem failed for kid:', jwk.kid, e);
    }
  }

  cachedPems = next;
  lastFetchedAt = now;

  if (!cachedPems[kid]) {
    throw new Error(`no_matching_jwk_for_kid:${kid}`);
  }

  return cachedPems[kid];
}

/**
 * LINE の ID トークンを検証してペイロードを返す（RS256 固定）
 */
export async function verifyLineIdToken(idToken: string) {
  const decodedHeader = jwt.decode(idToken, { complete: true })?.header as
    | { kid?: string; alg?: string }
    | undefined;

  if (!decodedHeader?.kid) {
    throw new Error('invalid_id_token_header');
  }

  // RS256 以外なら拒否（セキュリティ対策）
  if (decodedHeader.alg !== 'RS256') {
    throw new Error(`invalid_algorithm:${decodedHeader.alg}`);
  }

  const pem = await getPemForKid(decodedHeader.kid);

  const payload = jwt.verify(idToken, pem, {
    algorithms: ['RS256'],
    issuer: config.line.issuer,
    audience: config.line.channelId,
    clockTolerance: 300, // 5分の時刻ズレ許容
  });

  return payload;
}