// src/auth/lineVerify.ts
import jwt from "jsonwebtoken";
import { createPublicKey } from "crypto";

const LINE_JWKS_URL = "https://api.line.me/oauth2/v2.1/certs";
/**
 * audience には「LINEチャネルID」を使います（LIFF IDではありません）
 * 例: process.env.LINE_CHANNEL_ID に設定
 */
const LINE_CHANNEL_ID = process.env.LINE_CHANNEL_ID;

/**
 * JWK(JSON Web Key) を Node.js KeyObject → PEM に変換
 * Node v16+ は JWK から直接 PublicKey を作れます。
 */
function jwkToPem(jwk: any): string {
  const keyObject = createPublicKey({ key: jwk, format: "jwk" as any });
  return keyObject.export({ format: "pem", type: "spki" }).toString();
}

/** JWKS を取得して kid に一致する鍵を返す */
async function fetchKeyByKid(kid: string) {
  const res = await fetch(LINE_JWKS_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch_jwks_failed:${res.status}`);
  const jwks = (await res.json()) as { keys: any[] };
  if (!jwks?.keys?.length) throw new Error("no_jwks_keys");

  const jwk = jwks.keys.find((k) => k.kid === kid);
  if (!jwk) throw new Error(`no_matching_kid:${kid}`);

  // x5c があれば証明書からPEMを組む。なければJWK→PEM変換。
  if (Array.isArray(jwk.x5c) && jwk.x5c[0]) {
    const cert = `-----BEGIN CERTIFICATE-----\n${jwk.x5c[0]}\n-----END CERTIFICATE-----`;
    return { jwk, pem: cert };
  }
  return { jwk, pem: jwkToPem(jwk) };
}

/**
 * LINE の ID トークンを検証して payload を返す
 * - RS256 / ES256 の両対応
 * - iss / aud / exp を検証
 */
export async function verifyLineIdToken(idToken: string) {
  if (!LINE_CHANNEL_ID) throw new Error("missing_env:LINE_CHANNEL_ID");

  // kid / alg 取得のために decode（検証なし）
  const decoded = jwt.decode(idToken, { complete: true }) as
    | { header: { kid?: string; alg?: string }; payload: any }
    | null;
  if (!decoded?.header?.kid) throw new Error("id_token_missing_kid");
  const { kid, alg } = decoded.header;

  // LINE から ES256 が来ることもあるので両方許可
  const allowedAlgs = ["RS256", "ES256"];
  if (!alg || !allowedAlgs.includes(alg)) {
    throw new Error(`invalid_algorithm:${alg}`);
  }

  // kid に対応する公開鍵を取得
  const { pem } = await fetchKeyByKid(kid);

  // 仕様値
  const verifyOptions: jwt.VerifyOptions = {
    algorithms: allowedAlgs as jwt.Algorithm[],
    audience: LINE_CHANNEL_ID,
    issuer: "https://access.line.me",
  };

  // 検証
  const payload = jwt.verify(idToken, pem, verifyOptions);
  // jsonwebtoken は payload を object/string のどちらかで返すので object を期待
  if (!payload || typeof payload !== "object") {
    throw new Error("invalid_payload_type");
  }

  return { payload };
}