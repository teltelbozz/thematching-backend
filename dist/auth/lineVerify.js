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
 * LINE の JWK を PEM に変換して kid ごとにキャッシュ
 */
let cachedPems = {};
let lastFetchedAt = 0;
async function getPemForKid(kid) {
    const now = Date.now();
    if (cachedPems[kid] && now - lastFetchedAt < 3600000) {
        return cachedPems[kid];
    }
    const res = await axios_1.default.get('https://api.line.me/oauth2/v2.1/certs', {
        timeout: 5000,
    });
    if (res.status !== 200 || !res.data?.keys) {
        throw new Error(`failed_to_fetch_jwks: ${res.status}`);
    }
    const keys = res.data.keys;
    const next = {};
    for (const jwk of keys) {
        try {
            const pem = (0, jwk_to_pem_1.default)(jwk);
            if (jwk.kid)
                next[jwk.kid] = pem;
        }
        catch (e) {
            console.warn('jwkToPem failed for kid:', jwk.kid, e);
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
 * LINE の ID トークンを検証してペイロードを返す（RS256 固定）
 */
async function verifyLineIdToken(idToken) {
    const decodedHeader = jsonwebtoken_1.default.decode(idToken, { complete: true })?.header;
    if (!decodedHeader?.kid) {
        throw new Error('invalid_id_token_header');
    }
    // RS256 以外なら拒否（セキュリティ対策）
    if (decodedHeader.alg !== 'RS256') {
        throw new Error(`invalid_algorithm:${decodedHeader.alg}`);
    }
    const pem = await getPemForKid(decodedHeader.kid);
    const payload = jsonwebtoken_1.default.verify(idToken, pem, {
        algorithms: ['RS256'],
        issuer: index_js_1.config.line.issuer,
        audience: index_js_1.config.line.channelId,
        clockTolerance: 300, // 5分の時刻ズレ許容
    });
    return payload;
}
