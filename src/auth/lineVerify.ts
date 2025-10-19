// src/auth/lineVerify.ts
import axios from 'axios';
import jwt, { JwtHeader } from 'jsonwebtoken';
import jwkToPem from 'jwk-to-pem';
import config from '../config';

let cachedPems: Record<string, string> = {};
let lastFetchedAt = 0;

async function getPemForKid(kid: string): Promise<string> {
  const now = Date.now();
  if (cachedPems[kid] && now - lastFetchedAt < 3600_000) {
    return cachedPems[kid];
  }
  const res = await axios.get('https://api.line.me/oauth2/v2.1/certs', { timeout: 5000 });
  const jwks = res.data?.keys || [];
  const next: Record<string, string> = {};
  for (const jwk of jwks) {
    if (!jwk.kid) continue;
    next[jwk.kid] = jwkToPem(jwk);
  }
  cachedPems = next;
  lastFetchedAt = now;
  if (!cachedPems[kid]) throw new Error(`No matching key found for kid: ${kid}`);
  return cachedPems[kid];
}

export async function verifyLineIdToken(idToken: string) {
  const decodedHeader = jwt.decode(idToken, { complete: true })?.header as JwtHeader | undefined;
  if (!decodedHeader?.kid) throw new Error('Invalid ID token header');

  const pem = await getPemForKid(decodedHeader.kid);

  const payload = jwt.verify(idToken, pem, {
    algorithms: ['RS256'],
    issuer: config.line.issuer,
    audience: config.line.channelId,
  });

  // 多少の時刻ズレに寛容（デバッグ用ログ）
  const now = Math.floor(Date.now() / 1000);
  const iat = (payload as any)?.iat;
  const exp = (payload as any)?.exp;
  console.log('[lineVerify] iat, exp, now =', iat, exp, now);

  return payload;
}