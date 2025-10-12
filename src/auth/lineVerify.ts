// src/auth/lineVerify.ts
// CJS ビルドでも jose(ESM専用)を安全に動的 import する決定版。
// ポイント：eval('import(...)') を使い、TSが require に変換できない形にする。

export type LineIdPayload = {
  iss: string;
  sub: string;      // LINE user id
  aud: string;      // Channel ID
  exp: number;
  iat: number;
  name?: string;
  picture?: string;
};

// RemoteJWKSet のキャッシュ
let jwks: any | null = null;

// TS のトランスパイルで require に書き換えられないよう eval を使う
async function loadJose() {
  // 型付けのため as any
  return (await (eval('import("jose")') as any)) as typeof import('jose');
}

export async function verifyLineIdToken(idToken: string): Promise<LineIdPayload> {
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('Missing id_token');
  }

  const { createRemoteJWKSet, jwtVerify } = await loadJose();

  if (!jwks) {
    jwks = createRemoteJWKSet(new URL('https://api.line.me/oauth2/v2.1/certs'));
  }

  // 起動時クラッシュを避けるため、env は関数内で参照
  const issuer = process.env.LINE_ISSUER || 'https://access.line.me';
  const audience = process.env.LINE_CHANNEL_ID; // 例) "2008150959"
  if (!audience) {
    throw new Error('LINE_CHANNEL_ID not set');
  }

  const { payload, protectedHeader } = await jwtVerify(idToken, jwks, {
    algorithms: ['RS256'],
    issuer,
    audience,
    clockTolerance: 300,
  });

  if (protectedHeader?.alg && protectedHeader.alg !== 'RS256') {
    throw new Error(`Unexpected alg: ${protectedHeader.alg}`);
  }

  return payload as unknown as LineIdPayload;
}

export default verifyLineIdToken;