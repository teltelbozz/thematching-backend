"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyLineIdToken = verifyLineIdToken;
// src/auth/lineVerify.ts
const axios_1 = __importDefault(require("axios"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const jwk_to_pem_1 = __importDefault(require("jwk-to-pem"));
const index_js_1 = require("../config/index.js");
/**
 * LINEのJWKsから公開鍵を取得してキャッシュします
 */
let cachedKeys = {};
let lastFetchedAt = 0;
async function getPemForKid(kid) {
    const now = Date.now();
    // 1時間キャッシュ
    if (cachedKeys[kid] && now - lastFetchedAt < 3600000) {
        return cachedKeys[kid];
    }
    const res = await axios_1.default.get('https://api.line.me/oauth2/v2.1/certs');
    const jwks = res.data.keys;
    for (const jwk of jwks) {
        const pem = (0, jwk_to_pem_1.default)(jwk);
        cachedKeys[jwk.kid] = pem;
    }
    lastFetchedAt = now;
    if (!cachedKeys[kid]) {
        throw new Error(`No matching key found for kid: ${kid}`);
    }
    return cachedKeys[kid];
}
/**
 * LINEのIDトークンを検証し、ペイロードを返す
 */
async function verifyLineIdToken(idToken) {
    // ヘッダー部分から kid を取得
    const decodedHeader = jsonwebtoken_1.default.decode(idToken, { complete: true })?.header;
    if (!decodedHeader || !decodedHeader.kid) {
        throw new Error('Invalid ID token header');
    }
    const pem = await getPemForKid(decodedHeader.kid);
    const payload = jsonwebtoken_1.default.verify(idToken, pem, {
        algorithms: ['RS256'],
        issuer: index_js_1.config.line.issuer,
        audience: index_js_1.config.line.channelId,
    });
    return payload;
}
