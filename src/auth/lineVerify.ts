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
  // 1時間キャッシュ
  if (cachedPems[kid] && now - lastFetchedAt < 3600_000) {
    return cachedPems[kid];
  }

  const res = await axios.get('https://api.line.me/oauth2/v2.1/certs', {
    timeout: 5000,
    validateStatus: () => true,
  });

  if (res.status !== 200 || !res.data?.keys) {
    throw new Error(`failed_to_fetch_jwks: status=${res.status}`);
  }

  const keys = res.data.keys as Array<any>;
  const next: Record<string, string> = {};
  for (const jwk of keys) {
    try {
      const pem = jwkToPem(jwk);
      if (jwk.kid) next[jwk.kid] = pem;
    } catch {
      // 変換できない key はスキップ
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
 * LINE の ID トークンを検証してペイロードを返す（CJS 互換）
 * - 署名: RS256
 * - iss/aud もチェック
 */
export async function verifyLineIdToken(idToken: string) {
  // kid をヘッダから取得
  const decodedHeader = jwt.decode(idToken, { complete: true })?.header as
    | { kid?: string; alg?: string }
    | undefined;

  if (!decodedHeader?.kid) {
    throw new Error('invalid_id_token_header');
  }

  // LINE の公開鍵（該当 kid）を取得
  const pem = await getPemForKid(decodedHeader.kid);

  // 署名・クレーム検証（RS256 固定）
  const payload = jwt.verify(idToken, pem, {
    algorithms: ['RS256'],
    issuer: config.line.issuer,      // https://access.line.me
    audience: config.line.channelId, // LINE Channel ID
    clockTolerance: 300,             // 多少の時刻ズレを許容（秒）
  });

  // 返り値はそのまま payload（object）を返す
  return payload;
}