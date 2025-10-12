// src/auth/lineVerify.ts
// CommonJSビルドでもESM専用ライブラリ jose を安全に扱うバージョン

export type LineIdPayload = {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  name?: string;
  picture?: string;
};

// キャッシュ用（RemoteJWKSetを再利用）
let jwks: any | null = null;

export async function verifyLineIdToken(idToken: string): Promise<LineIdPayload> {
  if (!idToken) throw new Error('Missing id_token');

  // ✅ joseは動的import（requireを避ける）
  const { createRemoteJWKSet, jwtVerify } = await import('jose');

  // ✅ 初回だけJWKSを作成
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL('https://api.line.me/oauth2/v2.1/certs'));
  }

  // ✅ envをここで読む（configをトップでimportしない）
  const issuer = process.env.LINE_ISSUER || 'https://access.line.me';
  const audience = process.env.LINE_CHANNEL_ID;
  if (!audience) throw new Error('LINE_CHANNEL_ID not set');

  // ✅ 検証実行（RS256固定）
  const { payload, protectedHeader } = await jwtVerify(idToken, jwks, {
    algorithms: ['RS256'],
    issuer,
    audience,
    clockTolerance: 300,
  });

  if (protectedHeader.alg !== 'RS256') {
    throw new Error(`Unexpected alg: ${protectedHeader.alg}`);
  }

  return payload as LineIdPayload;
}

export default verifyLineIdToken;