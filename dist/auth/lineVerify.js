"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyLineIdToken = verifyLineIdToken;
// src/auth/lineVerify.ts
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = require("crypto");
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
function jwkToPem(jwk) {
    const keyObject = (0, crypto_1.createPublicKey)({ key: jwk, format: "jwk" });
    return keyObject.export({ format: "pem", type: "spki" }).toString();
}
/** JWKS を取得して kid に一致する鍵を返す */
async function fetchKeyByKid(kid) {
    const res = await fetch(LINE_JWKS_URL, { cache: "no-store" });
    if (!res.ok)
        throw new Error(`fetch_jwks_failed:${res.status}`);
    const jwks = (await res.json());
    if (!jwks?.keys?.length)
        throw new Error("no_jwks_keys");
    const jwk = jwks.keys.find((k) => k.kid === kid);
    if (!jwk)
        throw new Error(`no_matching_kid:${kid}`);
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
async function verifyLineIdToken(idToken) {
    if (!LINE_CHANNEL_ID)
        throw new Error("missing_env:LINE_CHANNEL_ID");
    // kid / alg 取得のために decode（検証なし）
    const decoded = jsonwebtoken_1.default.decode(idToken, { complete: true });
    if (!decoded?.header?.kid)
        throw new Error("id_token_missing_kid");
    const { kid, alg } = decoded.header;
    // LINE から ES256 が来ることもあるので両方許可
    const allowedAlgs = ["RS256", "ES256"];
    if (!alg || !allowedAlgs.includes(alg)) {
        throw new Error(`invalid_algorithm:${alg}`);
    }
    // kid に対応する公開鍵を取得
    const { pem } = await fetchKeyByKid(kid);
    // 仕様値
    const verifyOptions = {
        algorithms: allowedAlgs,
        audience: LINE_CHANNEL_ID,
        issuer: "https://access.line.me",
    };
    // 検証
    const payload = jsonwebtoken_1.default.verify(idToken, pem, verifyOptions);
    console.log('[lineVerify] decoded payload =', payload); // for debug
    // jsonwebtoken は payload を object/string のどちらかで返すので object を期待
    if (!payload || typeof payload !== "object") {
        throw new Error("invalid_payload_type");
    }
    return { payload };
}
