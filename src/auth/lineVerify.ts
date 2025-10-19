// src/auth/lineVerify.ts
import axios from 'axios';
import jwt from 'jsonwebtoken';
import jwkToPem from 'jwk-to-pem';
import config from '../config';

let pemCache: Record<string, string> = {};
let lastFetch = 0;

async function getPem(kid: string): Promise<string> {
  const now = Date.now();
  if (pemCache[kid] && now - lastFetch < 3600_000) return pemCache[kid];

  const { data } = await axios.get('https://api.line.me/oauth2/v2.1/certs');
  for (const jwk of data.keys) {
    pemCache[jwk.kid] = jwkToPem(jwk);
  }
  lastFetch = now;

  const pem = pemCache[kid];
  if (!pem) throw new Error(`no_jwk_for_kid:${kid}`);
  return pem;
}

export async function verifyLineIdToken(idToken: string) {
  // kid を読む
  const decodedHeader = jwt.decode(idToken, { complete: true })?.header as { kid?: string } | undefined;
  if (!decodedHeader?.kid) throw new Error('invalid_id_token_header');

  const pem = await getPem(decodedHeader.kid);

  // 署名と aud/iss を検証
  const payload = jwt.verify(idToken, pem, {
    algorithms: ['RS256'],
    issuer: 'https://access.line.me',
    audience: config.line.channelId, // 例: "2008150959"
  }) as Record<string, unknown>;

  // デバッグ（今回のような食い違い検出用）
  console.log('[lineVerify] decoded payload =', payload);

  // ★重要：{ payload: ... } ではなく、payload そのものを返す
  return payload; 
}