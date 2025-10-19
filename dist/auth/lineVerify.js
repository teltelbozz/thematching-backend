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
const config_1 = __importDefault(require("../config"));
let cachedPems = {};
let lastFetchedAt = 0;
async function getPemForKid(kid) {
    const now = Date.now();
    if (cachedPems[kid] && now - lastFetchedAt < 3600000) {
        return cachedPems[kid];
    }
    const res = await axios_1.default.get('https://api.line.me/oauth2/v2.1/certs', { timeout: 5000 });
    const jwks = res.data?.keys || [];
    const next = {};
    for (const jwk of jwks) {
        if (!jwk.kid)
            continue;
        next[jwk.kid] = (0, jwk_to_pem_1.default)(jwk);
    }
    cachedPems = next;
    lastFetchedAt = now;
    if (!cachedPems[kid])
        throw new Error(`No matching key found for kid: ${kid}`);
    return cachedPems[kid];
}
async function verifyLineIdToken(idToken) {
    const decodedHeader = jsonwebtoken_1.default.decode(idToken, { complete: true })?.header;
    if (!decodedHeader?.kid)
        throw new Error('Invalid ID token header');
    const pem = await getPemForKid(decodedHeader.kid);
    const payload = jsonwebtoken_1.default.verify(idToken, pem, {
        algorithms: ['RS256'],
        issuer: config_1.default.line.issuer,
        audience: config_1.default.line.channelId,
    });
    // 多少の時刻ズレに寛容（デバッグ用ログ）
    const now = Math.floor(Date.now() / 1000);
    const iat = payload?.iat;
    const exp = payload?.exp;
    console.log('[lineVerify] iat, exp, now =', iat, exp, now);
    return payload;
}
