
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config/index.js';

const LINE_JWKS = createRemoteJWKSet(new URL('https://api.line.me/oauth2/v2.1/certs'));

export async function verifyLineIdToken(idToken: string) {
  return await jwtVerify(idToken, LINE_JWKS, {
    issuer: config.line.issuer,
    audience: config.line.channelId,
    clockTolerance: 300,
  });
}
