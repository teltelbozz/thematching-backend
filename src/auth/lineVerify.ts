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

  const res = await axios.get('https://api.line.me/oauth2/v2.1/certs', { timeout: 5000 });
  const jwks = res.data?.keys ?? [];

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

/** デバッグ用に exp/iat をログ出し（安全のため署名検証前はペイロードを信用しない前提で閲覧のみ） */
function safeDecode(idToken: string) {
  try {
    const decoded = jwt.decode(idToken, { json: true }) as { iat?: number; exp?: number } | null;
    return decoded || {};
  } catch {
    return {};
  }
}

/**
 * LINEのIDトークンを検証し、ペイロードを返す
 * - 時刻ズレに寛容にするため、clockTimestampを「現在時刻 - 300秒」に設定
 *   → “最大5分古い”トークンまでは許容（検証環境の安定化目的）
 */
export async function verifyLineIdToken(idToken: string) {
  const header = jwt.decode(idToken, { complete: true })?.header as { kid?: string } | undefined;
  if (!header?.kid) {
    throw new Error('Invalid ID token header (no kid)');
  }

  // 署名検証前に exp/iat をログ（時刻ズレ解析用）
  const { iat, exp } = safeDecode(idToken);
  const now = Math.floor(Date.now() / 1000);
  console.log('[lineVerify] iat, exp, now =', iat, exp, now, 'skew= -300s');

  const pem = await getPemForKid(header.kid);

  try {
    // “現在時刻 - 300秒” を検証時計として渡すことで、最大5分の時刻ズレを許容
    const payload = jwt.verify(idToken, pem, {
      algorithms: ['RS256', 'ES256'], // 実運用は RS256 で十分 / エラーのES256にも念のため対応
      issuer: config.line.issuer,
      audience: config.line.channelId,
      clockTimestamp: now - 300, // ← スキュー許容（重要）
    }) as Record<string, unknown>;

    return payload;
  } catch (e: any) {
    // 追加ログ（期限切れの詳細など）
    console.error('[lineVerify] verify failed:', e?.name, e?.message, { iat, exp, now });
    throw e;
  }
}