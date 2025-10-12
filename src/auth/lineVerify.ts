// src/auth/lineVerify.ts
// すべて関数内で遅延ロード。トップレベル副作用ゼロにする。
export type LineIdPayload = {
  iss: string;
  sub: string;      // LINE user id
  aud: string;      // Channel ID
  exp: number;
  iat: number;
  name?: string;
  picture?: string;
};

// モジュールスコープには「状態」だけ（副作用なし）
let jwks: any | null = null;

/** LINEのIDトークンを公式JWKSで検証（RS256） */
export async function verifyLineIdToken(idToken: string): Promise<LineIdPayload> {
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('Missing id_token');
  }

  // jose は関数内で動的 import（CJS/ESMどちらでもOK）
  const { createRemoteJWKSet, jwtVerify } = await import('jose');

  // JWKS は初回だけ作成（以後キャッシュ）
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL('https://api.line.me/oauth2/v2.1/certs'));
  }

  // issuer/audience はここで読む（起動時に落ちないように）
  const issuer = process.env.LINE_ISSUER || 'https://access.line.me';
  const audience = process.env.LINE_CHANNEL_ID; // 例: "2008150959"
  if (!audience) {
    throw new Error('LINE_CHANNEL_ID is not set');
  }

  const { payload, protectedHeader } = await jwtVerify(idToken, jwks, {
    issuer,
    audience,
    algorithms: ['RS256'],
    clockTolerance: 300,
  });

  if (protectedHeader?.alg && protectedHeader.alg !== 'RS256') {
    throw new Error(`Unexpected alg: ${protectedHeader.alg}`);
  }

  return payload as unknown as LineIdPayload;
}

export default verifyLineIdToken;