import { config } from '../config/index.js';

// joseはESM専用なので、動的importで呼び出す
const loadJose = () => import('jose');

export async function verifyLineIdToken(idToken: string) {
  const { createRemoteJWKSet, jwtVerify } = await loadJose();

  const LINE_JWKS = createRemoteJWKSet(new URL('https://api.line.me/oauth2/v2.1/certs'));

  const { payload } = await jwtVerify(idToken, LINE_JWKS, {
    issuer: config.line.issuer,
    audience: config.line.channelId,
    clockTolerance: 300,
  });

  return payload;
}